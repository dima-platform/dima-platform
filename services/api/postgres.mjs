import {randomUUID,createHash} from 'node:crypto';
import {Fault,validateOrder,fingerprint,assertTransition,project,visible,assertQuote} from './domain.mjs';
import {resolvePgAddress} from './delivery.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const demoActors={
 'demo-customer':{id:'00000000-0000-4000-8000-000000000001',role:'customer'},
 'demo-merchant':{id:'00000000-0000-4000-8000-000000000002',role:'merchant',storeId:'10000000-0000-4000-8000-000000000001'},
 'demo-courier':{id:'00000000-0000-4000-8000-000000000003',role:'courier'},
 'demo-admin':{id:'00000000-0000-4000-8000-000000000004',role:'admin'},
};

export async function transaction(pool,fn){
 const client=await pool.connect();
 try{await client.query('BEGIN');await client.query("SET LOCAL lock_timeout = '5s'");const result=await fn(client);await client.query('COMMIT');return result;}
 catch(error){await client.query('ROLLBACK');if(['55P03','40P01','40001'].includes(error.code)||error.code==='23505'&&error.constraint==='courier_one_active_delivery')throw new Fault(409,'Concurrent update; retry request');throw error;}
 finally{client.release();}
}

export async function checkActor(client,actor){
 const role=await client.query('SELECT 1 FROM user_roles WHERE user_id=$1 AND role=$2',[actor.id,actor.role]);
 if(!role.rowCount)throw new Fault(403,'Inactive role');
 if(actor.role==='merchant'){
  const member=await client.query('SELECT 1 FROM store_members WHERE user_id=$1 AND store_id=$2',[actor.id,actor.storeId]);
  if(!member.rowCount)throw new Fault(403,'Store membership required');
 }
 if(actor.role==='courier'){
  const profile=await client.query('SELECT verified,available FROM courier_profiles WHERE user_id=$1 FOR UPDATE',[actor.id]);
  if(!profile.rows[0])throw new Fault(403,'Courier profile required');
  return profile.rows[0];
 }
}

async function hydrate(client,ids){
 if(!ids.length)return [];
 const [orders,items,events]=await Promise.all([
  client.query('SELECT * FROM orders WHERE id=ANY($1::uuid[]) ORDER BY created_at DESC,id',[ids]),
  client.query('SELECT * FROM order_items WHERE order_id=ANY($1::uuid[]) ORDER BY product_id',[ids]),
  client.query('SELECT * FROM order_events WHERE order_id=ANY($1::uuid[]) ORDER BY id',[ids]),
 ]);
 return orders.rows.map(o=>({id:o.id,customerId:o.customer_id,storeId:o.store_id,courierId:o.courier_id,address:o.address_snapshot.text,addressSnapshot:o.address_snapshot,totalMilli:o.total_milli,deliveryMilli:o.delivery_milli,currency:o.currency,payment:o.payment_method,status:o.status,version:o.version,createdAt:o.created_at,items:items.rows.filter(i=>i.order_id===o.id).map(i=>({productId:i.product_id,name:i.name_snapshot,nameFr:i.name_fr_snapshot||i.name_snapshot,quantity:i.quantity,priceMilli:i.price_milli})),events:events.rows.filter(e=>e.order_id===o.id).map(e=>({status:e.status,at:e.created_at,actorId:e.actor_id}))}));
}

export class PostgresOrders {
 constructor(pool){this.pool=pool;}
 async catalog(){
  const {rows}=await this.pool.query(`SELECT s.id,s.name_ar AS name,s.name_fr,s.category,s.delivery_milli,p.id AS product_id,p.name_ar AS product_name,p.name_fr AS product_name_fr,p.price_milli
   FROM stores s LEFT JOIN products p ON p.store_id=s.id AND p.available WHERE s.is_open AND s.enabled ORDER BY s.id,p.id`);
  const stores=new Map();for(const r of rows){if(!stores.has(r.id))stores.set(r.id,{id:r.id,name:r.name,nameFr:r.name_fr,category:r.category,deliveryMilli:r.delivery_milli,products:[]});if(r.product_id)stores.get(r.id).products.push({id:r.product_id,name:r.product_name,nameFr:r.product_name_fr,priceMilli:r.price_milli});}return [...stores.values()];
 }
 async create(actor,body,key){
  validateOrder(actor,body,key);
  if(!uuid.test(body.storeId)||body.items.some(i=>!uuid.test(i.productId)))throw new Fault(400,'Invalid identifier');
  const hash=createHash('sha256').update(fingerprint(body)).digest('hex');
  return transaction(this.pool,async client=>{
   await checkActor(client,actor);
   // Serializes retries for the same actor/key, including two independent API processes.
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[actor.id+':'+key]);
   const prior=await client.query('SELECT request_hash,order_id FROM idempotency_keys WHERE user_id=$1 AND key=$2',[actor.id,key]);
   if(prior.rowCount){if(prior.rows[0].request_hash!==hash)throw new Fault(409,'Key reused with different request');return (await hydrate(client,[prior.rows[0].order_id]))[0];}
   const store=(await client.query('SELECT * FROM stores WHERE id=$1 FOR SHARE',[body.storeId])).rows[0];
   if(!store?.is_open||!store.enabled)throw new Fault(400,'Store unavailable');
   const snapshot=body.addressId?await resolvePgAddress(client,actor,body,store.id):{text:body.address.trim()};
   const products=(await client.query('SELECT * FROM products WHERE store_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR SHARE',[body.storeId,body.items.map(i=>i.productId)])).rows;
   if(products.length!==body.items.length||products.some(p=>!p.available))throw new Fault(400,'Product unavailable');
   const items=body.items.map(i=>({...i,product:products.find(p=>p.id===i.productId)}));
   const total=items.reduce((n,i)=>n+i.product.price_milli*i.quantity,store.delivery_milli);
   if(!Number.isSafeInteger(total)||total>2147483647)throw new Fault(400,'Order total too large');
   assertQuote(body,total);
   const id=randomUUID();
   await client.query(`INSERT INTO orders(id,customer_id,store_id,address_snapshot,delivery_milli,total_milli) VALUES($1,$2,$3,$4,$5,$6)`,[id,actor.id,store.id,snapshot,store.delivery_milli,total]);
   for(const i of items)await client.query('INSERT INTO order_items(order_id,store_id,product_id,name_snapshot,quantity,price_milli,name_fr_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,store.id,i.productId,i.product.name_ar,i.quantity,i.product.price_milli,i.product.name_fr]);
   await client.query('INSERT INTO order_events(order_id,actor_id,status) VALUES($1,$2,$3)',[id,actor.id,'placed']);
   await client.query('INSERT INTO idempotency_keys(user_id,key,request_hash,order_id) VALUES($1,$2,$3,$4)',[actor.id,key,hash,id]);
   return (await hydrate(client,[id]))[0];
  });
 }
 async list(actor){
  return transaction(this.pool,async client=>{
   const profile=await checkActor(client,actor);
   const filters={customer:['customer_id=$1',[actor.id]],merchant:['store_id=$1',[actor.storeId]],courier:["(courier_id=$1 OR (status='ready' AND courier_id IS NULL AND $2))",[actor.id,!!(profile?.verified&&profile?.available)]],admin:['TRUE',[]]};
   const [where,params]=filters[actor.role]||['FALSE',[]];
   const {rows}=await client.query(`SELECT id FROM orders WHERE ${where} ORDER BY created_at DESC,id LIMIT 100`,params);
   // Recheck visibility after hydration; a ready order may have been claimed meanwhile.
   return (await hydrate(client,rows.map(o=>o.id))).filter(o=>visible(actor,o)).map(o=>project(actor,o));
  });
 }
 async get(actor,id){
  if(!uuid.test(id))throw new Fault(404,'Order not found');
  return transaction(this.pool,async client=>{const profile=await checkActor(client,actor),row=(await hydrate(client,[id]))[0];if(!row||!visible(actor,row)||(actor.role==='courier'&&row.courierId!==actor.id&&(!profile?.verified||!profile?.available)))throw new Fault(404,'Order not found');return project(actor,row);});
 }
 async transition(actor,id,status,version){
  if(!uuid.test(id))throw new Fault(404,'Order not found');
  return transaction(this.pool,async client=>{
   const profile=await checkActor(client,actor);
   const row=(await client.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE',[id])).rows[0];
   const order=row?(await hydrate(client,[id]))[0]:null;
   assertTransition(actor,order,status,version);
   if(status==='assigned'){
    if(!profile?.verified||!profile?.available)throw new Fault(403,'Courier must be verified and available');
    const active=await client.query("SELECT 1 FROM orders WHERE courier_id=$1 AND status IN ('assigned','picked_up') LIMIT 1",[actor.id]);
    if(active.rowCount)throw new Fault(409,'Courier already has an active delivery');
   }
   await client.query('UPDATE orders SET status=$1,version=version+1,courier_id=$2 WHERE id=$3',[status,status==='assigned'?actor.id:order.courierId,id]);
   await client.query('INSERT INTO order_events(order_id,actor_id,status) VALUES($1,$2,$3)',[id,actor.id,status]);
   return (await hydrate(client,[id]))[0];
  });
 }
}

export async function connectPostgres(connectionString){
 const {Pool}=await import('pg');
 const pool=new Pool({connectionString,max:10,connectionTimeoutMillis:5000,idleTimeoutMillis:30000});
 pool.on('error',()=>console.error('PostgreSQL background connection failure'));
 try{await pool.query('SELECT 1');return pool;}catch(e){await pool.end();throw e;}
}
