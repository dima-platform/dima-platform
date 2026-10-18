import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createHandler,deploymentSettings} from './server.mjs';
const password='test-only-password-1234';
async function request(handler,url,body,headers={}){
 const req=Readable.from(body===undefined?[]:[JSON.stringify(body)]);
 Object.assign(req,{url,method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...headers},socket:{remoteAddress:'test'}});
 const res={writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=body;}};
 await handler(req,res);return res;
}
test('hosted mode fails closed without PostgreSQL and strong shared password',()=>{
 assert.throws(()=>deploymentSettings({DIMA_HOSTED_DEMO:'true'}));
 assert.throws(()=>deploymentSettings({DIMA_HOSTED_DEMO:'true',DATABASE_URL:'db',DEMO_PASSWORD:'short'}));
 assert.equal(deploymentSettings({DIMA_HOSTED_DEMO:'true',DATABASE_URL:'db',DEMO_PASSWORD:password}).host,'0.0.0.0');
 assert.equal(deploymentSettings({}).host,'127.0.0.1');
});
test('hosted pages and synthetic login require the shared test password',async()=>{
 const handler=createHandler({demoPassword:password});
 for(const path of ['/','/app/','/merchant/','/courier/','/app.js'])assert.equal((await request(handler,path)).status,401);
 assert.equal((await request(handler,'/health')).status,200);
 const basic={authorization:'Basic '+Buffer.from('demo:'+password).toString('base64')};
 for(const path of ['/','/app/','/merchant/','/courier/'])assert.equal((await request(handler,path,undefined,basic)).status,200);
 assert.match((await request(handler,'/app.js',undefined,basic)).body,/DIMA_HOSTED_DEMO=true/);
 const login={phone:'+21600000001',role:'customer'};
 const denied=await request(handler,'/v1/auth/challenges',login);
 assert.equal(denied.status,401);assert.ok(JSON.parse(denied.body).error);
 const allowed=await request(handler,'/v1/auth/challenges',login,{'x-dima-demo-password':password});
 assert.equal(allowed.status,201);assert.match(JSON.parse(allowed.body).data.demoCode,/^\d{6}$/);
});
test('independent authenticated clients observe the same order through the server',async()=>{
 const handler=createHandler({demoPassword:password});
 async function signIn(phone,role){
  const headers={'x-dima-demo-password':password};
  const challenge=JSON.parse((await request(handler,'/v1/auth/challenges',{phone,role},headers)).body).data;
  const verified=await request(handler,'/v1/auth/verify',{challengeId:challenge.challengeId,code:challenge.demoCode},headers);
  assert.equal(verified.status,200);return {authorization:'Bearer '+JSON.parse(verified.body).data.accessToken};
 }
 const customer=await signIn('+21600000001','customer'),merchant=await signIn('+21600000002','merchant'),courier=await signIn('+21600000003','courier');
 const created=await request(handler,'/v1/orders',{storeId:'store-1',addressId:'address-1',addressVersion:1,quoteTotalMilli:32000,items:[{productId:'p1',quantity:2}]},{...customer,'idempotency-key':'hosted-journey-01'});
 assert.equal(created.status,201);let order=JSON.parse(created.body).data;
 for(const [headers,status]of [[merchant,'accepted'],[merchant,'preparing'],[merchant,'ready'],[courier,'assigned'],[courier,'picked_up'],[courier,'delivered']]){
  const changed=await request(handler,`/v1/orders/${order.id}/status`,{status,version:order.version},headers);
  assert.equal(changed.status,200);order=JSON.parse(changed.body).data;
  const observed=await request(handler,'/v1/orders/'+order.id,undefined,customer);
  assert.equal(JSON.parse(observed.body).data.status,status);
 }
});
