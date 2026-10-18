import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {Orders} from './domain.mjs';
import {MemoryOperations} from './operations.mjs';
import {createHandler} from './server.mjs';
const customer={id:'customer-1',role:'customer'},merchant={id:'merchant-1',role:'merchant',storeId:'store-1'},admin={id:'admin-1',role:'admin'},courier={id:'courier-1',role:'courier'};
const body={storeId:'store-1',address:'تونس شارع الاختبار',items:[{productId:'p1',quantity:2}]};
function setup(){const orders=new Orders();return {orders,ops:new MemoryOperations(orders.state)};}

test('merchant price changes affect new orders, never prior snapshots; stale edit fails',()=>{
 const {orders,ops}=setup(),old=orders.create(customer,body,'ops-order-01');
 ops.product(merchant,'p1',{priceMilli:20000,version:1});
 assert.equal(orders.create(customer,body,'ops-order-02').totalMilli,43000);assert.equal(old.totalMilli,32000);assert.equal(old.items[0].priceMilli,14500);
 assert.throws(()=>ops.product(merchant,'p1',{priceMilli:1,version:1}),{status:409});
 assert.equal(ops.overview(admin).recentAudit.length,1);
});
test('unavailable products and closed stores cannot be ordered; retries remain stable',()=>{
 const {orders,ops}=setup(),existing=orders.create(customer,body,'ops-order-01');
 ops.product(merchant,'p1',{available:false,version:1});
 assert.equal(ops.catalog()[0].products.some(p=>p.id==='p1'),false);
 assert.throws(()=>orders.create(customer,body,'ops-order-02'),{status:400});
 ops.storeStatus(merchant,{isOpen:false,version:1});
 assert.equal(ops.catalog().some(s=>s.id==='store-1'),false);
 assert.equal(orders.create(customer,body,'ops-order-01').id,existing.id);
 assert.throws(()=>orders.create(customer,body,'ops-order-03'),{status:400});
});
test('admin suspension cannot be undone by a merchant opening the store',()=>{
 const {orders,ops}=setup();ops.store(admin,'store-1',{enabled:false,version:1});
 ops.storeStatus(merchant,{isOpen:true,version:2});
 assert.equal(ops.catalog().some(s=>s.id==='store-1'),false);
 assert.throws(()=>orders.create(customer,body,'ops-order-01'),{status:400});
 assert.throws(()=>ops.storeStatus(merchant,{enabled:true,version:3}),{status:400});
});
test('ownership, field allowlists, strict integer prices and audit isolation',()=>{
 const {ops}=setup();
 assert.throws(()=>ops.product({...merchant,storeId:'store-2'},'p1',{priceMilli:1000,version:1}),{status:404});
 assert.throws(()=>ops.overview(customer),{status:403});
 for(const fields of [{priceMilli:-1},{priceMilli:1.5},{priceMilli:'12000'},{available:'true'},{storeId:'store-2'},{},JSON.parse('{"__proto__":{},"available":false}')])assert.throws(()=>ops.product(merchant,'p1',{...fields,version:1}),{status:400});
 ops.product(merchant,'p1',{priceMilli:15000,version:1});
 const snapshot=ops.overview(admin);snapshot.recentAudit[0].before.priceMilli=0;snapshot.stores[0].products[0].priceMilli=0;
 assert.equal(ops.overview(admin).recentAudit[0].before.priceMilli,14500);assert.equal(ops.merchantStore(merchant).products[0].priceMilli,15000);
});
test('suspension blocks new courier claims but preserves completion of an active delivery',()=>{
 const {orders,ops}=setup();let order=orders.create(customer,body,'ops-order-01');
 for(const status of ['accepted','preparing','ready'])orders.transition(merchant,order.id,status,order.version);
 orders.transition(courier,order.id,'assigned',order.version);
 let second=orders.create(customer,body,'ops-order-02');for(const status of ['accepted','preparing','ready'])orders.transition(merchant,second.id,status,second.version);
 assert.throws(()=>orders.transition(courier,second.id,'assigned',second.version),{status:409});
 ops.courier(admin,courier.id,{verified:false,version:1});
 assert.deepEqual(orders.list(courier).map(o=>o.id),[order.id]);
 assert.throws(()=>orders.transition(courier,second.id,'assigned',second.version),{status:403});
 orders.transition(courier,order.id,'picked_up',order.version);orders.transition(courier,order.id,'delivered',order.version);
 assert.equal(order.status,'delivered');
});
test('fresh handlers isolate catalog edits instead of mutating shared seed data',()=>{
 const first=setup(),second=setup();first.ops.product(merchant,'p1',{priceMilli:1,version:1});
 assert.equal(second.orders.create(customer,body,'isolated-01').totalMilli,32000);
});
test('price or delivery fee changes require a new confirmation of the displayed total',()=>{
 const {orders,ops}=setup();ops.product(merchant,'p1',{priceMilli:20000,version:1});
 assert.throws(()=>orders.create(customer,{...body,quoteTotalMilli:32000},'quote-0001'),{status:409});
 assert.equal(orders.rows.size,0);
 const confirmed=orders.create(customer,{...body,quoteTotalMilli:43000},'quote-0001');assert.equal(confirmed.totalMilli,43000);
 ops.store(admin,'store-1',{deliveryMilli:4000,version:1});
 assert.throws(()=>orders.create(customer,{...body,quoteTotalMilli:43000},'quote-0002'),{status:409});
 assert.equal(orders.create(customer,{...body,quoteTotalMilli:43000},'quote-0001').id,confirmed.id);
});
test('session-authenticated operations enforce roles and persist edits within the handler',async()=>{
 const handler=createHandler();
 async function request(url,{token,body}={}){
  const req=Readable.from(body?[JSON.stringify(body)]:[]);Object.assign(req,{method:body?'POST':'GET',url:'/v1'+url,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})}});
  const res={writeHead(status){this.status=status;},end(value){this.data=JSON.parse(value);}};await handler(req,res);return res;
 }
 async function login(phone,role){const challenge=(await request('/auth/challenges',{body:{phone,role}})).data.data;return (await request('/auth/verify',{body:{challengeId:challenge.challengeId,code:challenge.demoCode}})).data.data.accessToken;}
 const merchantToken=await login('+21600000002','merchant'),customerToken=await login('+21600000001','customer'),adminToken=await login('+21600000004','admin');
 assert.equal((await request('/merchant/store',{token:customerToken})).status,403);
 assert.equal((await request('/admin/overview',{token:merchantToken})).status,403);
 const edit=await request('/merchant/products/p1',{token:merchantToken,body:{priceMilli:18000,version:1}});assert.equal(edit.status,200);assert.equal(edit.data.data.version,2);
 assert.equal((await request('/merchant/products/p3',{token:merchantToken,body:{available:false,version:1}})).status,404);
 const overview=(await request('/admin/overview',{token:adminToken})).data.data;assert.equal(overview.recentAudit[0].action,'merchant.product.update');
 assert.equal((await request('/admin/stores/store-1',{token:adminToken,body:{enabled:false,version:1}})).status,200);
 const catalog=(await request('/stores')).data.data;assert.equal(catalog.some(s=>s.id==='store-1'),false);
});
