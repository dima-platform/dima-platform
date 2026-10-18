import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createHandler} from './test-support.mjs';

async function request(handler,{method='GET',url='/v1/orders',token='demo-customer',body,headers={}}={}){
 const req=Readable.from(body===undefined?[]:[Buffer.from(typeof body==='string'?body:JSON.stringify(body))]);
 Object.assign(req,{method,url,headers:{...(token?{authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'content-type':'application/json'}),...headers}});
 const response={writeHead(status,headers){this.status=status;this.headers=headers;},end(value){this.body=value;}};
 await handler(req,response);
 return {...response,json:response.headers['Content-Type'].startsWith('application/json')?JSON.parse(response.body):null};
}
const order={storeId:'store-1',addressId:'address-1',addressVersion:1,quoteTotalMilli:32000,items:[{productId:'p1',quantity:2}]};

test('handler checks exact tokens including prototype names',async()=>{
 const handler=createHandler();
 for(const token of [null,'__proto__','constructor','demo-customer extra'])assert.equal((await request(handler,{token})).status,401);
 assert.equal((await request(handler)).status,200);
});
test('handler completes customer, merchant and courier journey',async()=>{
 const handler=createHandler();
 let result=await request(handler,{method:'POST',body:order,headers:{'idempotency-key':'handler-0001'}});
 assert.equal(result.status,201);let row=result.json.data;assert.equal(row.totalMilli,32000);
 const replay=await request(handler,{method:'POST',body:order,headers:{'idempotency-key':'handler-0001'}});assert.equal(replay.json.data.id,row.id);
 for(const [token,status]of [['demo-merchant','accepted'],['demo-merchant','preparing'],['demo-merchant','ready'],['demo-courier','assigned'],['demo-courier','picked_up'],['demo-courier','delivered']]){
  result=await request(handler,{method:'POST',url:`/v1/orders/${row.id}/status`,token,body:{status,version:row.version}});
  assert.equal(result.status,200);row=result.json.data;
 }
 assert.equal(row.events.length,7);assert.equal(row.version,7);
});
test('handler rejects malformed, oversized and non-JSON bodies',async()=>{
 const handler=createHandler();
 assert.equal((await request(handler,{method:'POST',body:'{'})).status,400);
 assert.equal((await request(handler,{method:'POST',body:'null'})).status,400);
 assert.equal((await request(handler,{method:'POST',body:order,headers:{'content-type':'text/plain'}})).status,415);
 assert.equal((await request(handler,{method:'POST',body:'x'.repeat(17000)})).status,413);
 assert.equal((await request(handler,{method:'POST',body:{...order,items:[null]},headers:{'idempotency-key':'handler-0002'}})).status,400);
});
test('handler awaits async repository and never exposes exception contents',async()=>{
 const handler=createHandler({catalog:async()=>[{id:'async-store'}],orders:{list:async()=>[{id:'async-order'}],create:async()=>{throw Error('secret connection details');}}});
 assert.deepEqual((await request(handler)).json.data,[{id:'async-order'}]);
 assert.deepEqual((await request(handler,{url:'/v1/stores',token:null})).json.data,[{id:'async-store'}]);
 const failed=await request(handler,{method:'POST',body:order});assert.equal(failed.status,500);assert.equal(failed.json.error.message,'Internal error');
});
test('dashboard routes serve original UI and health reports backend mode',async()=>{
 const handler=createHandler({mode:'demo-postgres',health:async()=>{}});
 for(const url of ['/','/merchant','/admin','/courier']){
  const res=await request(handler,{url,token:null});assert.equal(res.status,200);assert.match(String(res.body),/DIMA/);
 }
 assert.equal((await request(handler,{url:'/health',token:null})).json.mode,'demo-postgres');
 const script=await request(handler,{url:'/app.js',token:null});assert.equal(script.status,200);assert.match(String(script.body),/auth\/verify/);
});
