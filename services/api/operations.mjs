import {Fault} from './domain.mjs';
import {randomUUID,createHash} from 'node:crypto';

export function requireRole(actor,role){if(actor.role!==role)throw new Fault(403,role+' required');}
export function patchInput(body,fields){
 if(!body||typeof body!=='object'||Array.isArray(body)||!Number.isInteger(body.version)||body.version<1)throw new Fault(400,'Valid version required');
 const keys=Object.keys(body).filter(k=>k!=='version');
 if(!keys.length||keys.some(k=>!Object.hasOwn(fields,k)))throw new Fault(400,'Unsupported or empty update');
 for(const key of keys){const value=body[key],rule=fields[key];if(typeof rule==='object'){if(!validName(value,rule.text))throw new Fault(400,'Invalid '+key);}else if(rule==='boolean'?typeof value!=='boolean':!Number.isInteger(value)||value<0||value>rule)throw new Fault(400,'Invalid '+key);}
 return Object.fromEntries(keys.map(key=>[key,typeof fields[key]==='object'?body[key].normalize('NFC').trim():body[key]]));
}
const validName=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
export const productFields={name:{text:120},nameFr:{text:120},priceMilli:100_000_000,available:'boolean'};
export function productInput(body){
 if(!body||Object.keys(body).some(k=>!['requestId','name','nameFr','priceMilli','available'].includes(k))||typeof body.requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestId))throw new Fault(400,'Valid product requestId required');
 const changes=patchInput({version:1,name:body.name,nameFr:body.nameFr,priceMilli:body.priceMilli,available:body.available},productFields);
 return {requestId:body.requestId.toLowerCase(),changes,hash:createHash('sha256').update(JSON.stringify(changes)).digest('hex')};
}
export const adminStoreFields={enabled:'boolean',deliveryMilli:1_000_000};
export const courierFields={verified:'boolean',available:'boolean'};
export function assertVersion(row,version){if(row.version!==version)throw new Fault(409,'Stale version; reload before editing');}

export class MemoryOperations {
 constructor(state){this.state=state;}
 catalog(){return structuredClone(this.state.stores.filter(s=>s.enabled&&s.isOpen).map(s=>({...s,products:s.products.filter(p=>p.available)})));}
 merchantStore(actor){requireRole(actor,'merchant');const store=this.state.stores.find(s=>s.id===actor.storeId);if(!store)throw new Fault(404,'Store not found');return structuredClone(store);}
 update(actor,row,changes,action){const before=structuredClone(row);Object.assign(row,changes);row.version++;this.state.audit.push({id:this.state.audit.length+1,actorId:actor.id,action,resource:action.includes('product')?'product':action.includes('courier')?'courier':'store',targetId:row.id,before,after:structuredClone(row),at:new Date().toISOString()});return structuredClone(row);}
 storeStatus(actor,body){const changes=patchInput(body,{isOpen:'boolean'});this.merchantStore(actor);const row=this.state.stores.find(s=>s.id===actor.storeId);assertVersion(row,body.version);return this.update(actor,row,changes,'merchant.store.status');}
 product(actor,id,body){requireRole(actor,'merchant');const changes=patchInput(body,productFields);const store=this.state.stores.find(s=>s.id===actor.storeId),row=store?.products.find(p=>p.id===id);if(!row)throw new Fault(404,'Product not found');assertVersion(row,body.version);return this.update(actor,row,changes,'merchant.product.update');}
 createProduct(actor,body){
  requireRole(actor,'merchant');const {requestId,changes,hash}=productInput(body);this.merchantStore(actor);
  const key=actor.storeId+':'+requestId,prior=this.state.productRequests.get(key),store=this.state.stores.find(s=>s.id===actor.storeId);
  if(prior){if(prior.hash!==hash)throw new Fault(409,'Product requestId reused with different content');return structuredClone(store.products.find(p=>p.id===prior.productId));}
  if(store.products.length>=1000)throw new Fault(409,'Maximum 1000 products per store');
  const row={id:randomUUID(),storeId:store.id,...changes,version:1};store.products.push(row);this.state.productRequests.set(key,{hash,productId:row.id});
  this.state.audit.push({id:this.state.audit.length+1,actorId:actor.id,action:'merchant.product.create',resource:'product',targetId:row.id,before:{},after:structuredClone(row),at:new Date().toISOString()});return structuredClone(row);
 }
 overview(actor){requireRole(actor,'admin');return structuredClone({stores:this.state.stores,couriers:this.state.couriers,recentAudit:this.state.audit.slice(-50).reverse()});}
 store(actor,id,body){requireRole(actor,'admin');const changes=patchInput(body,adminStoreFields),row=this.state.stores.find(s=>s.id===id);if(!row)throw new Fault(404,'Store not found');assertVersion(row,body.version);return this.update(actor,row,changes,'admin.store.update');}
 courier(actor,id,body){requireRole(actor,'admin');const changes=patchInput(body,courierFields),row=this.state.couriers.find(c=>c.id===id);if(!row)throw new Fault(404,'Courier not found');assertVersion(row,body.version);return this.update(actor,row,changes,'admin.courier.update');}
}
