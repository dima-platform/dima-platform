import {Fault} from './domain.mjs';
import {randomUUID} from 'node:crypto';
import {transaction,checkActor} from './postgres.mjs';
import {requireRole,patchInput,assertVersion,productFields,adminStoreFields,courierFields,productInput} from './operations.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const storeDto=s=>({id:s.id,name:s.name_ar,nameFr:s.name_fr,category:s.category,isOpen:s.is_open,enabled:s.enabled,deliveryMilli:s.delivery_milli,version:s.version});
const productDto=p=>({id:p.id,storeId:p.store_id,name:p.name_ar,nameFr:p.name_fr,priceMilli:p.price_milli,available:p.available,version:p.version});
const courierDto=c=>({id:c.user_id,verified:c.verified,available:c.available,version:c.version});
async function stores(client,id){
 const rows=(await client.query('SELECT * FROM stores '+(id?'WHERE id=$1 ':'')+'ORDER BY id',id?[id]:[])).rows;
 if(!rows.length)return [];
 const products=(await client.query('SELECT * FROM products WHERE store_id=ANY($1::uuid[]) ORDER BY id',[rows.map(s=>s.id)])).rows;
 return rows.map(s=>({...storeDto(s),products:products.filter(p=>p.store_id===s.id).map(productDto)}));
}

export class PostgresOperations {
 constructor(pool){this.pool=pool;}
 async merchantStore(actor){
  requireRole(actor,'merchant');return transaction(this.pool,async client=>{await checkActor(client,actor);const row=(await stores(client,actor.storeId))[0];if(!row)throw new Fault(404,'Store not found');return row;});
 }
 async overview(actor){
  requireRole(actor,'admin');return transaction(this.pool,async client=>{
   await checkActor(client,actor);
   const storeRows=await stores(client);
   const couriers=(await client.query('SELECT * FROM courier_profiles ORDER BY user_id')).rows.map(courierDto);
   const recentAudit=(await client.query('SELECT * FROM operations_audit ORDER BY id DESC LIMIT 50')).rows.map(r=>({id:r.id,actorId:r.actor_id,action:r.action,resource:r.resource,targetId:r.target_id,before:r.before_snapshot,after:r.after_snapshot,at:r.created_at}));
   return {stores:storeRows,couriers,recentAudit};
  });
 }
 async change(actor,id,body,{role,fields,table,idColumn='id',columns,dto,action,resource,owned=false}){
  requireRole(actor,role);const changes=patchInput(body,fields);
  if(!uuid.test(id))throw new Fault(404,'Resource not found');
  return transaction(this.pool,async client=>{
   await checkActor(client,actor);
   // All SQL identifiers originate exclusively from the fixed configurations below.
   const params=[id];let where=`${idColumn}=$1`;
   if(owned){params.push(actor.storeId);where+=' AND store_id=$2';}
   const row=(await client.query(`SELECT * FROM ${table} WHERE ${where} FOR UPDATE`,params)).rows[0];
   if(!row)throw new Fault(404,'Resource not found');assertVersion(row,body.version);
   const keys=Object.keys(changes),values=keys.map(k=>changes[k]);
   const setters=keys.map((k,i)=>`${columns[k]}=$${i+1}`);values.push(id);
   const updated=(await client.query(`UPDATE ${table} SET ${setters.join(',')},version=version+1 WHERE ${idColumn}=$${values.length} RETURNING *`,values)).rows[0];
   const before=dto(row),after=dto(updated);
   await client.query('INSERT INTO operations_audit(actor_id,action,resource,target_id,before_snapshot,after_snapshot) VALUES($1,$2,$3,$4,$5,$6)',[actor.id,action,resource,id,before,after]);
   return after;
  });
 }
 storeStatus(actor,body){return this.change(actor,actor.storeId,body,{role:'merchant',fields:{isOpen:'boolean'},table:'stores',columns:{isOpen:'is_open'},dto:storeDto,action:'merchant.store.status',resource:'store'});}
 product(actor,id,body){return this.change(actor,id,body,{role:'merchant',fields:productFields,table:'products',columns:{name:'name_ar',nameFr:'name_fr',priceMilli:'price_milli',available:'available'},dto:productDto,action:'merchant.product.update',resource:'product',owned:true});}
 async createProduct(actor,body){
  requireRole(actor,'merchant');const {requestId,changes,hash}=productInput(body);
  return transaction(this.pool,async client=>{
   await checkActor(client,actor);
   const store=(await client.query('SELECT id FROM stores WHERE id=$1 FOR UPDATE',[actor.storeId])).rows[0];if(!store)throw new Fault(404,'Store not found');
   const prior=(await client.query('SELECT * FROM product_create_requests WHERE store_id=$1 AND request_id=$2',[store.id,requestId])).rows[0];
   if(prior){if(prior.request_hash!==hash)throw new Fault(409,'Product requestId reused with different content');return productDto((await client.query('SELECT * FROM products WHERE id=$1',[prior.product_id])).rows[0]);}
   const count=(await client.query('SELECT count(*)::int AS n FROM products WHERE store_id=$1',[store.id])).rows[0].n;if(count>=1000)throw new Fault(409,'Maximum 1000 products per store');
   const row=(await client.query('INSERT INTO products(id,store_id,name_ar,name_fr,price_milli,available) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[randomUUID(),store.id,changes.name,changes.nameFr,changes.priceMilli,changes.available])).rows[0];
   const after=productDto(row);
   await client.query('INSERT INTO product_create_requests(store_id,request_id,request_hash,product_id) VALUES($1,$2,$3,$4)',[store.id,requestId,hash,row.id]);
   await client.query('INSERT INTO operations_audit(actor_id,action,resource,target_id,before_snapshot,after_snapshot) VALUES($1,$2,$3,$4,$5,$6)',[actor.id,'merchant.product.create','product',row.id,{},after]);
   return after;
  });
 }
 store(actor,id,body){return this.change(actor,id,body,{role:'admin',fields:adminStoreFields,table:'stores',columns:{enabled:'enabled',deliveryMilli:'delivery_milli'},dto:storeDto,action:'admin.store.update',resource:'store'});}
 courier(actor,id,body){return this.change(actor,id,body,{role:'admin',fields:courierFields,table:'courier_profiles',idColumn:'user_id',columns:{verified:'verified',available:'available'},dto:courierDto,action:'admin.courier.update',resource:'courier'});}
}
