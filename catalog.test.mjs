import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {Orders} from './domain.mjs';
import {MemoryOperations} from './operations.mjs';
import {browseCatalog} from './catalog.mjs';
import {createHandler} from './test-support.mjs';
const merchant={id:'merchant-1',role:'merchant',storeId:'store-1'},customer={id:'customer-1',role:'customer'};
const input=()=>({requestId:randomUUID(),name:'منتج اختبار نابل',nameFr:'Produit test Nabeul',priceMilli:12000,available:true});
function setup(){const orders=new Orders();return {orders,ops:new MemoryOperations(orders.state)};}

test('catalog search handles French accents and Arabic diacritics, with category filtering',()=>{
 const {ops}=setup(),search=(q,category='')=>browseCatalog(ops.catalog(),new URLSearchParams({q,category}));
 assert.equal(search('LEGUMES')[0].id,'store-1');assert.equal(search('سَلاطة')[0].id,'store-1');assert.equal(search('marche')[0].id,'store-2');
 assert.equal(search('couscous','groceries').length,0);assert.equal(search('','groceries').length,1);assert.equal(search('<script>').length,0);
 assert.throws(()=>search('x'.repeat(81)),{status:400});assert.throws(()=>search('','unsupported'),{status:400});
});
test('hidden products and suspended stores are never searchable',()=>{
 const {ops}=setup();ops.product(merchant,'p1',{available:false,version:1});
 assert.equal(browseCatalog(ops.catalog(),new URLSearchParams({q:'couscous'})).length,0);
 ops.store({id:'admin',role:'admin'},'store-1',{enabled:false,version:1});
 assert.equal(browseCatalog(ops.catalog(),new URLSearchParams({q:'nabeul'})).length,0);
});
test('product creation retry creates one product and one audit record, with content conflict',()=>{
 const {ops}=setup(),body=input(),first=ops.createProduct(merchant,body),second=ops.createProduct(merchant,{...body,name:' '+body.name+' '});
 assert.equal(first.id,second.id);assert.equal(ops.merchantStore(merchant).products.length,3);assert.equal(ops.state.audit.length,1);
 assert.throws(()=>ops.createProduct(merchant,{...body,priceMilli:1}),{status:409});
 const changed=ops.product(merchant,first.id,{name:'اسم جديد',nameFr:'Nouveau nom',version:1});assert.equal(changed.version,2);
 assert.equal(ops.createProduct(merchant,body).version,2);
});
test('creation validates both languages, ownership, request IDs and monetary types',()=>{
 const {ops}=setup();assert.throws(()=>ops.createProduct(customer,input()),{status:403});
 for(const patch of [{name:''},{nameFr:' '},{name:'a'.repeat(121)},{nameFr:'bad\nname'},{priceMilli:'12000'},{priceMilli:-1},{available:'true'},{requestId:'invalid'},{storeId:'store-2'}])assert.throws(()=>ops.createProduct(merchant,{...input(),...patch}),{status:400});
 assert.equal(ops.state.audit.length,0);const body=input(),first=ops.createProduct(merchant,body),second=ops.createProduct({...merchant,storeId:'store-2'},body);assert.notEqual(first.id,second.id);assert.equal(second.storeId,'store-2');
});
test('new product is orderable and name/price snapshots survive bilingual rename',()=>{
 const {orders,ops}=setup(),product=ops.createProduct(merchant,input());
 const order=orders.create(customer,{storeId:'store-1',addressId:'address-1',addressVersion:1,quoteTotalMilli:15000,items:[{productId:product.id,quantity:1}]},'new-product-order');
 ops.product(merchant,product.id,{name:'اسم أحدث',nameFr:'Nom modifié',priceMilli:13000,version:1});
 assert.equal(order.items[0].nameFr,'Produit test Nabeul');assert.equal(order.items[0].name,'منتج اختبار نابل');assert.equal(order.totalMilli,15000);
});
test('1000-product limit blocks new entries but still permits a previous retry',()=>{
 const {ops}=setup(),body=input(),first=ops.createProduct(merchant,body),store=ops.state.stores[0];
 while(store.products.length<1000)store.products.push({id:randomUUID(),name:'test',priceMilli:1,available:false,version:1});
 assert.equal(ops.createProduct(merchant,body).id,first.id);assert.throws(()=>ops.createProduct(merchant,input()),{status:409});
});
test('HTTP product creation, search, detail and closed-store protection work together',async()=>{
 const handler=createHandler();
 async function request(path,body,token='demo-merchant'){
  const req=Readable.from(body?[JSON.stringify(body)]:[]);Object.assign(req,{method:body?'POST':'GET',url:'/v1'+path,headers:{'content-type':'application/json',authorization:'Bearer '+token}});
  const res={writeHead(status){this.status=status;},end(value){this.data=JSON.parse(value);}};await handler(req,res);return res;
 }
 const body=input();assert.equal((await request('/merchant/products',body,'demo-customer')).status,403);
 const created=await request('/merchant/products',body);assert.equal(created.status,201);assert.equal((await request('/merchant/products',body)).data.data.id,created.data.data.id);
 assert.equal((await request('/stores?q=Produit%20test')).data.data[0].id,'store-1');
 assert.ok((await request('/stores/store-1')).data.data.products.some(p=>p.id===created.data.data.id));
 await request('/merchant/store/status',{isOpen:false,version:1});assert.equal((await request('/stores/store-1')).status,404);assert.equal((await request('/stores?q=Nabeul')).data.data.length,0);
 assert.equal((await request('/stores?category=parcels')).status,400);
});
