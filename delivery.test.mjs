import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {Orders} from './domain.mjs';
import {MemoryAddresses,demoZones,coverage} from './delivery.mjs';
import {createHandler} from './test-support.mjs';
const customer={id:'customer-1',role:'customer'},other={id:'another',role:'customer'},courier={id:'courier-1',role:'courier'},merchant={id:'m',role:'merchant',storeId:'store-1'};
const input={label:'المنزل التجريبي',text:'عنوان وهمي للاختبار فقط',latitude:36.46,longitude:10.73};
const checkout={storeId:'store-1',addressId:'address-1',addressVersion:1,quoteTotalMilli:32000,items:[{productId:'p1',quantity:2}]};
function setup(){const orders=new Orders();return {orders,addresses:new MemoryAddresses(orders.state)};}

test('address validation rejects non-numeric, non-finite and out-of-world coordinates',()=>{
 const {addresses}=setup();
 for(const patch of [{latitude:'36.8'},{latitude:NaN},{longitude:Infinity},{latitude:91},{longitude:-181},{label:' '},{text:'x'},{userId:'another'}])assert.throws(()=>addresses.create(customer,{...input,...patch}),{status:400});
 assert.equal(addresses.create(customer,{...input,latitude:36.46000012}).latitude,36.46);
});
test('address ownership, optimistic editing and archiving preserve order snapshot',()=>{
 const {orders,addresses}=setup(),old=orders.create(customer,checkout,'delivery-01');
 assert.throws(()=>addresses.edit(other,'address-1',{...input,version:1}),{status:404});
 const edited=addresses.edit(customer,'address-1',{...input,text:'عنوان اختبار مختلف',version:1});
 assert.equal(edited.version,2);assert.throws(()=>addresses.edit(customer,'address-1',{...input,version:1}),{status:409});
 assert.equal(old.address,'عنوان وهمي لاختبار التوصيل في نابل');
 addresses.archive(customer,'address-1',{version:2});assert.equal(addresses.list(customer).length,0);
 assert.equal(orders.create(customer,checkout,'delivery-01').id,old.id);
 assert.throws(()=>orders.create(customer,{...checkout,addressVersion:3},'delivery-02'),{status:404});
 assert.equal(orders.get(customer,old.id).addressSnapshot.version,1);
});
test('zone boundaries include edges and reject disabled or unlinked coverage',()=>{
 const z=demoZones[0],vertex=z.geometry.coordinates[0][0];assert.equal(coverage({latitude:vertex[1],longitude:vertex[0]},demoZones).length,1);
 assert.equal(coverage({latitude:z.south-.000001,longitude:z.west},demoZones).length,0);
 const {orders}=setup();orders.state.stores[0].zoneIds=[];
 assert.throws(()=>orders.create(customer,checkout,'delivery-01'),{status:422});assert.equal(orders.rows.size,0);
 orders.state.stores[0].zoneIds=['nabeul'];orders.state.zones[0].enabled=false;
 assert.throws(()=>orders.create(customer,checkout,'delivery-02'),{status:422});
});
test('outside address can be saved but cannot create an order; foreign and stale addresses fail',()=>{
 const {orders,addresses}=setup(),outside=addresses.create(customer,{...input,latitude:0,longitude:0});assert.equal(outside.serviceable,false);
 assert.throws(()=>orders.create(customer,{...checkout,addressId:outside.id},'delivery-01'),{status:422});
 assert.throws(()=>orders.create(other,checkout,'delivery-02'),{status:404});
 addresses.edit(customer,'address-1',{...input,version:1});assert.throws(()=>orders.create(customer,checkout,'delivery-03'),{status:409});
 assert.equal(orders.rows.size,0);
});
test('courier detail hides address, items and events before assignment',()=>{
 const {orders}=setup();const row=orders.create(customer,checkout,'delivery-01');
 assert.throws(()=>orders.get(other,row.id),{status:404});assert.throws(()=>orders.get(courier,row.id),{status:404});
 for(const status of ['accepted','preparing','ready'])orders.transition(merchant,row.id,status,row.version);
 const offer=orders.get(courier,row.id);assert.deepEqual(Object.keys(offer).sort(),['id','status','storeId','version']);
 orders.transition(courier,row.id,'assigned',row.version);assert.equal(orders.get(courier,row.id).addressSnapshot.latitude,36.46);
});
test('saved address limit, role permissions and returned object isolation',()=>{
 const {addresses}=setup();assert.throws(()=>addresses.list(courier),{status:403});
 for(let i=0;i<19;i++)addresses.create(customer,input);
 assert.throws(()=>addresses.create(customer,input),{status:409});
 const list=addresses.list(customer);list[0].latitude=0;assert.equal(addresses.list(customer)[0].latitude,36.46);
 addresses.archive(customer,list[0].id,{version:1});addresses.create(customer,input);assert.equal(addresses.list(customer).length,20);
});
test('HTTP cannot bypass coverage using free-text address; saved address flows into detail',async()=>{
 const handler=createHandler();
 async function req(path,body,token='demo-customer'){
  const r=Readable.from(body?[JSON.stringify(body)]:[]);Object.assign(r,{method:body?'POST':'GET',url:'/v1'+path,headers:{'content-type':'application/json',authorization:'Bearer '+token,'idempotency-key':'delivery-http-01'}});
  const res={writeHead(status){this.status=status;},end(data){this.data=JSON.parse(data);}};await handler(r,res);return res;
 }
 assert.equal((await req('/orders',{storeId:'store-1',address:input.text,items:checkout.items,quoteTotalMilli:32000})).status,400);
 assert.equal((await req('/addresses',null,'demo-merchant')).status,403);
 const outside=(await req('/addresses',{...input,latitude:0,longitude:0})).data.data;
 assert.equal((await req('/orders',{...checkout,addressId:outside.id,address:input.text})).status,422);
 const created=await req('/orders',{...checkout,address:'forged address ignored',latitude:0});assert.equal(created.status,201);
 const detail=await req('/orders/'+created.data.data.id);assert.equal(detail.status,200);assert.equal(detail.data.data.addressSnapshot.latitude,36.46);assert.equal(detail.data.data.events[0].status,'placed');
});
