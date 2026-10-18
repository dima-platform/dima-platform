import {randomUUID} from 'node:crypto';
import {Fault} from './errors.mjs';
import {demoZones,demoAddress,resolveAddress} from './delivery.mjs';
export {Fault} from './errors.mjs';
export const stores=[{id:'store-1',name:'مذاق نابل',nameFr:'Saveurs de Nabeul',category:'restaurants',deliveryMilli:3000,products:[{id:'p1',name:'كسكسي بالخضار',nameFr:'Couscous aux légumes',priceMilli:14500},{id:'p2',name:'سلاطة مشوية',nameFr:'Salade méchouia',priceMilli:6500}]},{id:'store-2',name:'سوق الحي',nameFr:'Marché du quartier',category:'groceries',deliveryMilli:2500,products:[{id:'p3',name:'سلة خضار',nameFr:'Panier de légumes',priceMilli:12000}]}];
export function createDemoState(){return {stores:structuredClone(stores).map(s=>({...s,zoneIds:['nabeul'],isOpen:true,enabled:true,version:1,products:s.products.map(p=>({...p,storeId:s.id,available:true,version:1}))})),couriers:[{id:'courier-1',verified:true,available:true,version:1}],audit:[],productRequests:new Map(),addresses:[structuredClone(demoAddress)],zones:structuredClone(demoZones)};}
export function validateOrder(actor,body,key){
 if(actor.role!=='customer')throw new Fault(403,'Customer required');
 if(typeof key!=='string'||key.length<8||key.length>128)throw new Fault(400,'Idempotency-Key must be 8–128 characters');
 if(!body||typeof body!=='object'||Array.isArray(body)||typeof body.storeId!=='string'||!Array.isArray(body.items)||body.items.length<1||body.items.length>30||(!body.addressId&&(typeof body.address!=='string'||body.address.trim().length<5||body.address.length>300)))throw new Fault(400,'Invalid order');
 const seen=new Set();
 for(const i of body.items){if(!i||typeof i.productId!=='string'||!Number.isInteger(i.quantity)||i.quantity<1||i.quantity>20||seen.has(i.productId))throw new Fault(400,'Invalid product or quantity');seen.add(i.productId);}
 if(body.quoteTotalMilli!==undefined&&(!Number.isSafeInteger(body.quoteTotalMilli)||body.quoteTotalMilli<0))throw new Fault(400,'Invalid quoted total');
}
export function assertQuote(body,total){if(total>2147483647)throw new Fault(400,'Order total too large');if(body.quoteTotalMilli!==undefined&&body.quoteTotalMilli!==total)throw new Fault(409,'Order price changed; review basket');}
export function fingerprint(body){return JSON.stringify({storeId:body.storeId,...(body.addressId?{addressId:body.addressId,addressVersion:body.addressVersion}:{address:body.address.trim()}),items:body.items.map(i=>({productId:i.productId,quantity:i.quantity})).sort((a,b)=>a.productId.localeCompare(b.productId))});}
export function visible(a,o){return a.role==='admin'||a.role==='customer'&&o.customerId===a.id||a.role==='merchant'&&o.storeId===a.storeId||a.role==='courier'&&(o.courierId===a.id||o.status==='ready'&&o.courierId===null);}
export function project(a,o){return a.role==='courier'&&o.courierId===null?{id:o.id,storeId:o.storeId,status:o.status,version:o.version}:o;}
export function assertTransition(a,o,status,version){
 if(!Number.isInteger(version)||version<1||typeof status!=='string')throw new Fault(400,'Invalid status or version');
 if(!o||!visible(a,o))throw new Fault(404,'Order not found');
 if(o.version!==version)throw new Fault(409,'Stale version');
 const allowed=(a.role==='merchant'&&o.storeId===a.storeId&&({placed:['accepted','cancelled'],accepted:['preparing'],preparing:['ready']}[o.status]||[]).includes(status))||(a.role==='courier'&&((o.status==='ready'&&status==='assigned'&&o.courierId===null)||(o.courierId===a.id&&({assigned:['picked_up'],picked_up:['delivered']}[o.status]||[]).includes(status))))||(a.role==='customer'&&o.customerId===a.id&&o.status==='placed'&&status==='cancelled');
 if(!allowed)throw new Fault(403,'Transition not permitted');
}
export class Orders {
 constructor(state=createDemoState()){this.rows=new Map();this.keys=new Map();this.state=state;}
 create(actor,body,key){
  validateOrder(actor,body,key);
  const hash=fingerprint(body), prior=this.keys.get(actor.id+':'+key);
  if(prior){if(prior.fingerprint!==hash)throw new Fault(409,'Key reused with different request');return this.rows.get(prior.id);}
  const store=this.state.stores.find(s=>s.id===body.storeId&&s.isOpen&&s.enabled);
  if(!store)throw new Fault(400,'Store unavailable');
  const snapshot=body.addressId?resolveAddress(this.state.addresses.find(a=>a.id===body.addressId&&a.userId===actor.id),this.state.zones,store.zoneIds,body):{text:body.address.trim()};
  const seen=new Set();
  const items=body.items.map(i=>{const p=store.products.find(p=>p.id===i.productId&&p.available);if(!p||!Number.isInteger(i.quantity)||i.quantity<1||i.quantity>20||seen.has(p.id))throw new Fault(400,'Invalid product or quantity');seen.add(p.id);return {productId:p.id,name:p.name,nameFr:p.nameFr||p.name,quantity:i.quantity,priceMilli:p.priceMilli};});
  assertQuote(body,items.reduce((n,i)=>n+i.priceMilli*i.quantity,store.deliveryMilli));
  const row={id:randomUUID(),customerId:actor.id,storeId:store.id,courierId:null,address:snapshot.text,addressSnapshot:structuredClone(snapshot),items,totalMilli:items.reduce((n,i)=>n+i.priceMilli*i.quantity,store.deliveryMilli),deliveryMilli:store.deliveryMilli,currency:'TND',payment:'cash_on_delivery',status:'placed',version:1,events:[{status:'placed',at:new Date().toISOString(),actorId:actor.id}]};
  this.rows.set(row.id,row);this.keys.set(actor.id+':'+key,{id:row.id,fingerprint:hash});return row;
 }
 visible(a,o){return visible(a,o);}
 get(a,id){const row=this.rows.get(id);if(!row||!visible(a,row))throw new Fault(404,'Order not found');const profile=this.state.couriers.find(c=>c.id===a.id);if(a.role==='courier'&&row.courierId!==a.id&&(!profile?.verified||!profile.available))throw new Fault(404,'Order not found');return structuredClone(project(a,row));}
 list(a){const profile=this.state.couriers.find(c=>c.id===a.id);return [...this.rows.values()].filter(o=>visible(a,o)&&(a.role!=='courier'||o.courierId===a.id||profile?.verified&&profile?.available)).map(o=>project(a,o));}
 transition(a,id,status,version){
  const o=this.rows.get(id);assertTransition(a,o,status,version);
  if(status==='assigned'){
   const profile=this.state.couriers.find(c=>c.id===a.id);
   if(!profile?.verified||!profile?.available)throw new Fault(403,'Courier must be verified and available');
   if([...this.rows.values()].some(row=>row.courierId===a.id&&['assigned','picked_up'].includes(row.status)))throw new Fault(409,'Courier already has an active delivery');
  }
  if(status==='assigned')o.courierId=a.id;o.status=status;o.version++;o.events.push({status,at:new Date().toISOString(),actorId:a.id});return o;
 }
}
