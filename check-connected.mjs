// Runs a real synthetic order against an already deployed staging service.
// Set DIMA_TEST_URL and DIMA_TEST_PASSWORD locally; never paste secrets into chat.
const base=new URL(process.env.DIMA_TEST_URL||'http://localhost:3000');
if(!['https:','http:'].includes(base.protocol)||base.username||base.password)throw Error('Invalid test URL');
const pass=process.env.DIMA_TEST_PASSWORD;
if(!pass)throw Error('DIMA_TEST_PASSWORD required');
async function call(path,{token,body,key}={}){
 const response=await fetch(new URL(path,base),{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Dima-Demo-Password':pass,...(token?{Authorization:'Bearer '+token}:{}),...(key?{'Idempotency-Key':key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(90_000)});
 const result=await response.json();if(!response.ok)throw Error(`Request ${path}: ${response.status} ${result.error?.message||''}`);return result.data??result;
}
async function login(phone,role){const c=await call('/v1/auth/challenges',{body:{phone,role}});return (await call('/v1/auth/verify',{body:{challengeId:c.challengeId,code:c.demoCode}})).accessToken;}
const health=await call('/health');if(health.mode!=='demo-postgres')throw Error('PostgreSQL mode required; refusing an isolated browser or memory demo');
const customer=await login('+21600000001','customer'),merchant=await login('+21600000002','merchant'),courier=await login('+21600000003','courier');
const store=(await call('/v1/merchant/store',{token:merchant}));
const catalog=await call('/v1/stores');
const selected=catalog.find(s=>s.id===store.id),product=selected?.products[0];if(!product)throw Error('Demo store must be open with an available product');
const address=(await call('/v1/addresses',{token:customer})).find(a=>a.serviceable);if(!address)throw Error('Demo customer needs an address within Nabeul');
const input={storeId:selected.id,addressId:address.id,addressVersion:address.version,quoteTotalMilli:selected.deliveryMilli+product.priceMilli,items:[{productId:product.id,quantity:1}]};
const key=crypto.randomUUID();let order=await call('/v1/orders',{token:customer,body:input,key});
if((await call('/v1/orders',{token:customer,body:input,key})).id!==order.id)throw Error('Retry created a duplicate order');
for(const [token,status]of [[merchant,'accepted'],[merchant,'preparing'],[merchant,'ready'],[courier,'assigned'],[courier,'picked_up'],[courier,'delivered']]){
 order=await call(`/v1/orders/${order.id}/status`,{token,body:{status,version:order.version}});
 const seen=await call(`/v1/orders/${order.id}`,{token:customer});if(seen.status!==status)throw Error('Customer did not observe transition');
 console.log(`Shared order: ${status}`);
}
console.log('PASS: PostgreSQL service, three independent sessions, idempotent creation, all delivery transitions.');
