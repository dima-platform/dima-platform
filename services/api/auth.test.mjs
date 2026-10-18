import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {DemoAuth,memoryAccounts} from './auth.mjs';
import {createHandler} from './server.mjs';
const customer={phone:'+21600000001',role:'customer'};
async function login(auth,body=customer){const challenge=await auth.challenge(body);return auth.verify({challengeId:challenge.challengeId,code:challenge.demoCode});}

test('OTP creates random sessions; fixed demo tokens no longer authenticate',async()=>{
 const auth=new DemoAuth();const session=await login(auth);
 assert.ok(session.accessToken.length>=40);assert.notEqual(session.accessToken,session.refreshToken);
 assert.deepEqual(await auth.authenticate(session.accessToken),memoryAccounts[0].actor);
 await assert.rejects(auth.authenticate('demo-customer'),{status:401});
 assert.equal(JSON.stringify([...auth.access]).includes(session.accessToken),false);
 assert.equal(JSON.stringify([...auth.refreshTokens]).includes(session.refreshToken),false);
});
test('phone cannot grant itself a merchant or admin role',async()=>{
 const auth=new DemoAuth();
 for(const role of ['merchant','admin'])await assert.rejects(auth.challenge({...customer,role}),{status:400});
 await assert.rejects(auth.challenge({phone:'+21612345678',role:'customer'}),{status:400});
});
test('OTP expiry, single use and maximum wrong attempts',async()=>{
 let now=0;const auth=new DemoAuth({now:()=>now,otp:()=> '654321'});
 const first=await auth.challenge(customer);
 for(let i=0;i<5;i++)await assert.rejects(auth.verify({challengeId:first.challengeId,code:'111111'}),{status:401});
 await assert.rejects(auth.verify({challengeId:first.challengeId,code:first.demoCode}),{status:429});
 now+=31_000;const second=await auth.challenge(customer);
 await auth.verify({challengeId:second.challengeId,code:second.demoCode});
 await assert.rejects(auth.verify({challengeId:second.challengeId,code:second.demoCode}),{status:401});
 now+=31_000;const third=await auth.challenge(customer);now+=301_000;
 await assert.rejects(auth.verify({challengeId:third.challengeId,code:third.demoCode}),{status:401});
});
test('resending consumes rate budget, cooldown applies and old code is invalidated',async()=>{
 let now=0;const auth=new DemoAuth({now:()=>now});const first=await auth.challenge(customer);
 await assert.rejects(auth.challenge(customer),{status:429});
 now=31_000;await auth.challenge(customer);
 await assert.rejects(auth.verify({challengeId:first.challengeId,code:first.demoCode}),{status:401});
 now=62_000;await assert.rejects(auth.challenge(customer),{status:429});
 now=901_000;await auth.challenge(customer);
});
test('access expires, refresh rotates and replay revokes the family',async()=>{
 let now=0;const auth=new DemoAuth({now:()=>now,accessMs:1000});const first=await login(auth);
 now=1001;await assert.rejects(auth.authenticate(first.accessToken),{status:401});
 const next=await auth.refresh({refreshToken:first.refreshToken});
 assert.notEqual(next.accessToken,first.accessToken);await auth.authenticate(next.accessToken);
 await assert.rejects(auth.refresh({refreshToken:first.refreshToken}),{status:401});
 await assert.rejects(auth.authenticate(next.accessToken),{status:401});
 await assert.rejects(auth.refresh({refreshToken:next.refreshToken}),{status:401});
});
test('logout, absolute lifetime and role removal invalidate sessions',async()=>{
 let now=0,enabled=true;const auth=new DemoAuth({now:()=>now,refreshMs:5000,resolveAccount:()=>enabled?memoryAccounts[0].actor:null});
 const first=await login(auth);await auth.logout(first.accessToken);
 await assert.rejects(auth.refresh({refreshToken:first.refreshToken}),{status:401});
 now=31_000;const second=await login(auth);now+=4000;const third=await auth.refresh({refreshToken:second.refreshToken});
 assert.equal(third.refreshExpiresIn,1);now+=1001;await assert.rejects(auth.authenticate(third.accessToken),{status:401});
 now=62_000;const fourth=await login(auth);enabled=false;await assert.rejects(auth.authenticate(fourth.accessToken),{status:401});
});
test('concurrent OTP verification issues at most one session',async()=>{
 const auth=new DemoAuth();const challenge=await auth.challenge(customer);const body={challengeId:challenge.challengeId,code:challenge.demoCode};
 const results=await Promise.allSettled([auth.verify(body),auth.verify(body)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});
test('concurrent refresh replay cannot resurrect a revoked family',async()=>{
 const auth=new DemoAuth();const first=await login(auth);
 const results=await Promise.allSettled([auth.refresh({refreshToken:first.refreshToken}),auth.refresh({refreshToken:first.refreshToken})]);
 for(const result of results)if(result.status==='fulfilled')await assert.rejects(auth.authenticate(result.value.accessToken),{status:401});
 assert.equal([...auth.sessions.values()][0].revoked,true);
});
test('HTTP handlers sign in, enforce roles, refresh, and log out',async()=>{
 const handler=createHandler();
 async function request(path,{body,access,headers={}}={}){
  const req=Readable.from(body?[JSON.stringify(body)]:[]);Object.assign(req,{method:body?'POST':'GET',url:'/v1'+path,headers:{'content-type':'application/json',...(access?{authorization:'Bearer '+access}:{}),...headers},socket:{remoteAddress:'127.0.0.1'}});
  const res={writeHead(status){this.status=status;},end(data){this.data=JSON.parse(data);}};await handler(req,res);return res;
 }
 assert.equal((await request('/orders',{access:'demo-admin'})).status,401);
 const challenge=(await request('/auth/challenges',{body:customer})).data.data;
 const verified=await request('/auth/verify',{body:{challengeId:challenge.challengeId,code:challenge.demoCode}});assert.equal(verified.status,200);
 let session=verified.data.data;
 assert.equal((await request('/auth/me',{access:session.accessToken})).data.data.role,'customer');
 const created=await request('/orders',{access:session.accessToken,headers:{'idempotency-key':'auth-order-01'},body:{storeId:'store-1',addressId:'address-1',addressVersion:1,quoteTotalMilli:17500,items:[{productId:'p1',quantity:1}],role:'admin'}});assert.equal(created.status,201);
 const denied=await request('/orders/'+created.data.data.id+'/status',{access:session.accessToken,body:{status:'accepted',version:1,role:'merchant'}});assert.equal(denied.status,403);
 session=(await request('/auth/refresh',{body:{refreshToken:session.refreshToken}})).data.data;
 assert.equal((await request('/auth/logout',{access:session.accessToken,body:{}})).status,200);
 assert.equal((await request('/orders',{access:session.accessToken})).status,401);
});
