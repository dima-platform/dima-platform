import {randomUUID} from 'node:crypto';
import {transaction,checkActor} from './postgres.mjs';
import {Fault} from './errors.mjs';
import {addressInput,requireCustomer,addressDto,coverage,readZones} from './delivery.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class PostgresAddresses {
 constructor(pool){this.pool=pool;}
 zones(){return transaction(this.pool,readZones);}
 list(actor){requireCustomer(actor);return transaction(this.pool,async client=>{await checkActor(client,actor);const zones=await readZones(client);return (await client.query('SELECT * FROM addresses WHERE user_id=$1 AND NOT archived ORDER BY id',[actor.id])).rows.map(a=>({...addressDto(a),serviceable:coverage(addressDto(a),zones).length>0}));});}
 create(actor,body){requireCustomer(actor);const input=addressInput(body);return transaction(this.pool,async client=>{
  await checkActor(client,actor);await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[actor.id]);
  const count=(await client.query('SELECT count(*)::int AS n FROM addresses WHERE user_id=$1 AND NOT archived',[actor.id])).rows[0].n;
  if(count>=20)throw new Fault(409,'Maximum 20 saved addresses');
  const row=(await client.query('INSERT INTO addresses(id,user_id,label,address_text,latitude,longitude) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[randomUUID(),actor.id,input.label,input.text,input.latitude,input.longitude])).rows[0];
  const address=addressDto(row);return {...address,serviceable:coverage(address,await readZones(client)).length>0};
 });}
 change(actor,id,body,archive){
  requireCustomer(actor);if(!uuid.test(id))throw new Fault(404,'Address not found');if(!Number.isInteger(body.version)||body.version<1)throw new Fault(400,'Version required');
  const input=archive?null:addressInput(body);
  return transaction(this.pool,async client=>{
   await checkActor(client,actor);const row=(await client.query('SELECT * FROM addresses WHERE id=$1 AND user_id=$2 AND NOT archived FOR UPDATE',[id,actor.id])).rows[0];
   if(!row)throw new Fault(404,'Address not found');if(row.version!==body.version)throw new Fault(409,'Address changed; reload');
   if(archive){await client.query('UPDATE addresses SET archived=true,version=version+1 WHERE id=$1',[id]);return {id,archived:true,version:row.version+1};}
   const updated=(await client.query('UPDATE addresses SET label=$1,address_text=$2,latitude=$3,longitude=$4,version=version+1 WHERE id=$5 RETURNING *',[input.label,input.text,input.latitude,input.longitude,id])).rows[0];
   const address=addressDto(updated);return {...address,serviceable:coverage(address,await readZones(client)).length>0};
  });
 }
 edit(actor,id,body){return this.change(actor,id,body,false);}
 archive(actor,id,body){return this.change(actor,id,body,true);}
}
