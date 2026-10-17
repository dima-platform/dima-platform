import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Orders} from './domain.mjs';
import {createServer} from './test-support.mjs';
const customer={id:'c1',role:'customer'},merchant={id:'m1',role:'merchant',storeId:'store-1'};
const body={storeId:'store-1',address:'تونس شارع الاختبار',items:[{productId:'p1',quantity:1},{productId:'p2',quantity:2}]};

test('null items, duplicates and invalid versions produce domain errors',()=>{
 const orders=new Orders();
 for(const items of [[null],[{productId:'p1',quantity:1},{productId:'p1',quantity:1}]])assert.throws(()=>orders.create(customer,{...body,items},'safety-01'),{status:400});
 const order=orders.create(customer,body,'safety-02');
 for(const version of [null,'1',-1,1.5])assert.throws(()=>orders.transition(merchant,order.id,'accepted',version),{status:400});
});

test('idempotency ignores object key order, item order and client price',()=>{
 const orders=new Orders(),first=orders.create(customer,body,'safety-03');
 const replay=orders.create(customer,{items:[...body.items].reverse(),address:body.address,storeId:body.storeId,totalMilli:0},'safety-03');
 assert.equal(first.id,replay.id);assert.equal(first.totalMilli,30500);
});

test('only owning merchant can move an order; cancellation is terminal',()=>{
 const orders=new Orders(),order=orders.create(customer,body,'safety-04');
 assert.throws(()=>orders.transition({...merchant,storeId:'store-2'},order.id,'accepted',1),{status:404});
 assert.throws(()=>orders.transition({id:'a',role:'admin'},order.id,'accepted',1),{status:403});
 orders.transition(customer,order.id,'cancelled',1);
 assert.throws(()=>orders.transition(merchant,order.id,'accepted',2),{status:403});
 assert.equal(order.events.length,2);
});

test('HTTP awaits repository, rejects prototype tokens, and hides internal failures',{skip:!process.env.DIMA_NETWORK_TESTS},async()=>{
 const actors=Object.assign(Object.create(null),{'test-token':customer});
 const server=createServer({actors,mode:'test',catalog:async()=>[{id:'async-store'}],orders:{list:async()=>[{id:'async-order'}],create:async()=>{throw Error('database password secret');}}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const token of ['__proto__','constructor','test-token extra'])assert.equal((await fetch(base+'/v1/orders',{headers:{Authorization:`Bearer ${token}`}})).status,401);
  assert.deepEqual((await (await fetch(base+'/v1/orders',{headers:{Authorization:'Bearer test-token'}})).json()).data,[{id:'async-order'}]);
  assert.deepEqual((await (await fetch(base+'/v1/stores')).json()).data,[{id:'async-store'}]);
  const response=await fetch(base+'/v1/orders',{method:'POST',headers:{Authorization:'Bearer test-token','Content-Type':'application/json'},body:JSON.stringify({addressId:'address-1',addressVersion:1,quoteTotalMilli:0})});
  assert.equal(response.status,500);assert.equal((await response.json()).error.message,'Internal error');
 }finally{await new Promise(r=>server.close(r));}
});
