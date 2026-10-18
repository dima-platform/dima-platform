import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Orders,createDemoState,Fault} from './domain.mjs';
import {MemoryOperations} from './operations.mjs';
import {DemoAuth,memoryAccounts} from './auth.mjs';
import {MemoryAddresses,validateCheckout} from './delivery.mjs';
import {browseCatalog} from './catalog.mjs';
import {timingSafeEqual,createHash} from 'node:crypto';
export function deploymentSettings(env=process.env){
 const hosted=env.DIMA_HOSTED_DEMO==='true';
 if(hosted&&(!env.DATABASE_URL||!env.DEMO_PASSWORD||env.DEMO_PASSWORD.length<16))throw new Error('Hosted demo requires PostgreSQL and a DEMO_PASSWORD of at least 16 characters');
 return {host:hosted?'0.0.0.0':'127.0.0.1',demoPassword:hosted?env.DEMO_PASSWORD:null};
}
function authorizedDemo(req,password){
 if(!password)return true;
 const expected=Buffer.from('demo:'+password).toString('base64');
 const digest=value=>createHash('sha256').update(value).digest();
 return timingSafeEqual(digest(req.headers.authorization||''),digest('Basic '+expected));
}
async function readBody(req){
 if(!req.headers['content-type']?.startsWith('application/json'))throw new Fault(415,'JSON required');
 let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>16384)throw new Fault(413,'Body too large');}
 let body;try{body=JSON.parse(raw);}catch{throw new Fault(400,'Invalid JSON');}
 if(!body||Array.isArray(body)||typeof body!=='object')throw new Fault(400,'Object required');return body;
}
export function createHandler(options={}){
 const orders=options.orders||new Orders();
 const operations=options.operations||new MemoryOperations(orders.state||createDemoState());
 const addresses=options.addresses||new MemoryAddresses(orders.state||createDemoState());
 const catalog=options.catalog||(()=>operations.catalog());
 const auth=options.auth||new DemoAuth();
 return async(req,res)=>{
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
  try{
   const url=new URL(req.url,'http://localhost'),path=url.pathname.replace(/\/$/,'')||'/';
   // Browser Basic credentials protect pages; API calls carry Bearer tokens instead.
   // Protect the synthetic login endpoints too, using a dedicated demo pass header.
   if(options.demoPassword&&path!=='/health'){
    const api=path.startsWith('/v1/');
    const login=path.startsWith('/v1/auth/challenges')||path.startsWith('/v1/auth/verify');
    const supplied=req.headers['x-dima-demo-password'];
    const validPass=typeof supplied==='string'&&timingSafeEqual(createHash('sha256').update(supplied).digest(),createHash('sha256').update(options.demoPassword).digest());
    if((!api&&!authorizedDemo(req,options.demoPassword))||(login&&!validPass)){
     if(api)return send(401,{error:{message:'كلمة مرور التجربة غير صحيحة / Invalid demo password'}});
     res.writeHead(401,{'WWW-Authenticate':'Basic realm="DIMA test", charset="UTF-8"','Cache-Control':'no-store'});return res.end('DIMA private test: sign in with demo and the shared test password.');
    }
   }
   if(req.method==='GET'&&path==='/app.js'){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(`window.DIMA_HOSTED_DEMO=${!!options.demoPassword};\n`+await readFile(new URL('../../web/app.js',import.meta.url),'utf8'));}
   if(req.method==='GET'&&(['/','/app','/merchant','/admin','/courier'].includes(path)||/^\/store\/[^/]+$/.test(path))){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:"});return res.end(await readFile(new URL('../../web/index.html',import.meta.url)));}
   if(req.method==='GET'&&path==='/health'){if(options.health)await options.health();return send(200,{status:'ok',mode:options.mode||'demo-memory'});}
   if(req.method==='GET'&&path==='/v1/stores')return send(200,{data:browseCatalog(await catalog(),url.searchParams)});
   const storeDetail=path.match(/^\/v1\/stores\/([^/]+)$/);
   if(req.method==='GET'&&storeDetail){const row=(await catalog()).find(s=>s.id===storeDetail[1]);if(!row)throw new Fault(404,'Store not found');return send(200,{data:row});}
   if(req.method==='GET'&&path==='/v1/delivery-zones')return send(200,{data:await addresses.zones()});
   const ip=req.socket?.remoteAddress||'local';
   if(req.method==='POST'&&path==='/v1/auth/challenges')return send(201,{data:await auth.challenge(await readBody(req),ip)});
   if(req.method==='POST'&&path==='/v1/auth/verify')return send(200,{data:await auth.verify(await readBody(req),ip)});
   if(req.method==='POST'&&path==='/v1/auth/refresh')return send(200,{data:await auth.refresh(await readBody(req),ip)});
   const token=req.headers.authorization?.match(/^Bearer ([^\s]+)$/)?.[1];
   // Actor injection is for isolated tests only. Runtime uses opaque session tokens.
   const a=options.actors?(Object.hasOwn(options.actors,token||'')?options.actors[token]:null):await auth.authenticate(token);
   if(!a)throw new Fault(401,'Session required');
   if(req.method==='GET'&&path==='/v1/auth/me')return send(200,{data:a});
   if(req.method==='POST'&&path==='/v1/auth/logout'){await auth.logout(token);return send(200,{data:{loggedOut:true}});}
   if(req.method==='GET'&&path==='/v1/orders')return send(200,{data:await orders.list(a)});
   if(req.method==='GET'&&path==='/v1/addresses')return send(200,{data:await addresses.list(a)});
   const detail=path.match(/^\/v1\/orders\/([^/]+)$/);if(req.method==='GET'&&detail)return send(200,{data:await orders.get(a,detail[1])});
   if(req.method==='GET'&&path==='/v1/merchant/store')return send(200,{data:await operations.merchantStore(a)});
   if(req.method==='GET'&&path==='/v1/admin/overview')return send(200,{data:await operations.overview(a)});
   if(req.method!=='POST')throw new Fault(404,'Route not found');
   const body=await readBody(req);
   if(path==='/v1/addresses')return send(201,{data:await addresses.create(a,body)});
   const addressEdit=path.match(/^\/v1\/addresses\/([^/]+)$/);if(addressEdit)return send(200,{data:await addresses.edit(a,addressEdit[1],body)});
   const archive=path.match(/^\/v1\/addresses\/([^/]+)\/archive$/);if(archive)return send(200,{data:await addresses.archive(a,archive[1],body)});
   if(path==='/v1/merchant/store/status')return send(200,{data:await operations.storeStatus(a,body)});
   if(path==='/v1/merchant/products')return send(201,{data:await operations.createProduct(a,body)});
   const product=path.match(/^\/v1\/merchant\/products\/([^/]+)$/);if(product)return send(200,{data:await operations.product(a,product[1],body)});
   const adminStore=path.match(/^\/v1\/admin\/stores\/([^/]+)$/);if(adminStore)return send(200,{data:await operations.store(a,adminStore[1],body)});
   const courier=path.match(/^\/v1\/admin\/couriers\/([^/]+)$/);if(courier)return send(200,{data:await operations.courier(a,courier[1],body)});
   if(path==='/v1/orders'){validateCheckout(body);return send(201,{data:await orders.create(a,body,req.headers['idempotency-key'])});}
   const match=path.match(/^\/v1\/orders\/([^/]+)\/status$/);if(match)return send(200,{data:await orders.transition(a,match[1],body.status,body.version)});
   throw new Fault(404,'Route not found');
  }catch(e){send(e.status||500,{error:{message:e.status?e.message:'Internal error'}});}
 };
}
export function createServer(options={}){return http.createServer(createHandler(options));}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(process.env.NODE_ENV==='production')throw new Error('Demo server cannot run in production');
 const deployment=deploymentSettings();
 let pool,options={};
 if(process.env.DATABASE_URL){
  const {connectPostgres,PostgresOrders}=await import('./postgres.mjs');
  const {PostgresOperations}=await import('./postgres-operations.mjs');
  const {PostgresAddresses}=await import('./postgres-addresses.mjs');
  pool=await connectPostgres(process.env.DATABASE_URL);const repository=new PostgresOrders(pool);
  const auth=new DemoAuth({resolveAccount:async(phone,role)=>{
   if(!memoryAccounts.some(a=>a.phone===phone&&a.actor.role===role))return null;
   const {rows}=await pool.query('SELECT u.id,r.role,m.store_id FROM users u JOIN user_roles r ON r.user_id=u.id LEFT JOIN store_members m ON m.user_id=u.id WHERE u.phone=$1 AND r.role=$2 ORDER BY m.store_id LIMIT 1',[phone,role]);
   const row=rows[0];if(!row||role==='merchant'&&!row.store_id)return null;
   return {id:row.id,role:row.role,...(role==='merchant'?{storeId:row.store_id}:{})};
  }});
  options={orders:repository,operations:new PostgresOperations(pool),addresses:new PostgresAddresses(pool),catalog:()=>repository.catalog(),auth,mode:'demo-postgres',health:()=>pool.query('SELECT 1')};
 }
 const server=createServer({...options,demoPassword:deployment.demoPassword});
 server.listen(Number(process.env.PORT||3000),deployment.host,()=>console.log(`DIMA ${options.mode||'demo-memory'} listening on port ${process.env.PORT||3000}`));
 async function stop(){server.close(async()=>{if(pool)await pool.end();});}
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
