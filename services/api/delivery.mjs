import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Fault} from './errors.mjs';
import {contains} from './geometry.mjs';
const boundary=JSON.parse(readFileSync(new URL('../../assets/geography/nabeul.geojson',import.meta.url),'utf8'));
export const demoZones=[{id:'nabeul',name:'ولاية نابل — نطاق الإطلاق المستهدف',nameFr:'Gouvernorat de Nabeul — zone de lancement cible',south:36.350332,north:37.087470,west:10.339297,east:11.136227,geometry:boundary.geometry,enabled:true,operationalCoverageApproved:false}];
export const demoAddress={id:'address-1',userId:'customer-1',label:'عنوان اختبار في نابل',text:'عنوان وهمي لاختبار التوصيل في نابل',latitude:36.46,longitude:10.73,version:1,archived:false};
export function addressInput(body){
 const allowed=['label','text','latitude','longitude','version'];
 if(Object.keys(body).some(k=>!allowed.includes(k))||typeof body.label!=='string'||!body.label.trim()||body.label.length>60||typeof body.text!=='string'||body.text.trim().length<5||body.text.length>300||!Number.isFinite(body.latitude)||Math.abs(body.latitude)>90||!Number.isFinite(body.longitude)||Math.abs(body.longitude)>180)throw new Fault(400,'Invalid address or coordinates');
 return {label:body.label.trim(),text:body.text.trim(),latitude:Math.round(body.latitude*1e6)/1e6,longitude:Math.round(body.longitude*1e6)/1e6};
}
export function requireCustomer(actor){if(actor.role!=='customer')throw new Fault(403,'Customer required');}
export function validateCheckout(body){
 if(typeof body.addressId!=='string'||!body.addressId||!Number.isInteger(body.addressVersion)||body.addressVersion<1||!Number.isSafeInteger(body.quoteTotalMilli)||body.quoteTotalMilli<0)throw new Fault(400,'Saved addressId, addressVersion and quoteTotalMilli required');
}
export function coverage(address,zones){return zones.filter(z=>z.enabled&&address.latitude>=z.south&&address.latitude<=z.north&&address.longitude>=z.west&&address.longitude<=z.east&&contains(z.geometry,address.longitude,address.latitude));}
export function resolveAddress(address,zones,storeZoneIds,body){
 if(!address||address.archived)throw new Fault(404,'Address not found');
 if(address.version!==body.addressVersion)throw new Fault(409,'Address changed; review before confirming');
 const zone=coverage(address,zones).find(z=>storeZoneIds.includes(z.id));
 if(!zone)throw new Fault(422,'Address outside this store delivery area');
 return {id:address.id,version:address.version,label:address.label,text:address.text,latitude:address.latitude,longitude:address.longitude,zoneId:zone.id,zoneName:zone.name};
}
export const addressDto=a=>({id:a.id,userId:a.user_id,label:a.label,text:a.address_text,latitude:Number(a.latitude),longitude:Number(a.longitude),version:a.version,archived:a.archived});
export async function readZones(client){const {rows}=await client.query('SELECT * FROM service_zones WHERE enabled ORDER BY id FOR SHARE');return rows.map(z=>({id:z.id,name:z.name_ar,nameFr:z.name_fr,south:Number(z.south),north:Number(z.north),west:Number(z.west),east:Number(z.east),geometry:z.geometry,enabled:z.enabled,operationalCoverageApproved:false}));}
export async function resolvePgAddress(client,actor,body,storeId){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.addressId))throw new Fault(404,'Address not found');
 const row=(await client.query('SELECT * FROM addresses WHERE id=$1 AND user_id=$2 FOR SHARE',[body.addressId,actor.id])).rows[0];
 const zones=await readZones(client),links=(await client.query('SELECT zone_id FROM store_service_zones WHERE store_id=$1 FOR SHARE',[storeId])).rows;
 return resolveAddress(row?addressDto(row):null,zones,links.map(z=>z.zone_id),body);
}
export class MemoryAddresses {
 constructor(state){this.state=state;}
 zones(){return structuredClone(this.state.zones.filter(z=>z.enabled));}
 list(actor){requireCustomer(actor);return this.state.addresses.filter(a=>a.userId===actor.id&&!a.archived).map(a=>({...structuredClone(a),serviceable:coverage(a,this.state.zones).length>0}));}
 create(actor,body){requireCustomer(actor);const input=addressInput(body);if(this.list(actor).length>=20)throw new Fault(409,'Maximum 20 saved addresses');const row={...input,id:randomUUID(),userId:actor.id,version:1,archived:false};this.state.addresses.push(row);return {...structuredClone(row),serviceable:coverage(row,this.state.zones).length>0};}
 edit(actor,id,body){requireCustomer(actor);if(!Number.isInteger(body.version)||body.version<1)throw new Fault(400,'Version required');const input=addressInput(body),row=this.state.addresses.find(a=>a.id===id&&a.userId===actor.id&&!a.archived);if(!row)throw new Fault(404,'Address not found');if(row.version!==body.version)throw new Fault(409,'Address changed; reload');Object.assign(row,input);row.version++;return {...structuredClone(row),serviceable:coverage(row,this.state.zones).length>0};}
 archive(actor,id,body){requireCustomer(actor);const row=this.state.addresses.find(a=>a.id===id&&a.userId===actor.id&&!a.archived);if(!row)throw new Fault(404,'Address not found');if(!Number.isInteger(body.version)||body.version<1)throw new Fault(400,'Version required');if(row.version!==body.version)throw new Fault(409,'Address changed; reload');row.archived=true;row.version++;return {id:row.id,archived:true,version:row.version};}
}
