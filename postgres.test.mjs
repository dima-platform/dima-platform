import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {connectPostgres,PostgresOrders,demoActors} from './postgres.mjs';
import {migrate,seedDevelopment} from './migrate.mjs';
import {PostgresOperations} from './postgres-operations.mjs';
import {PostgresAddresses} from './postgres-addresses.mjs';

// This suite creates a private schema in a separate explicitly configured test DB.
// It never truncates application tables. Its schema is left for inspection.
test('PostgreSQL persistence, rollback, idempotency races and competing couriers',{skip:!process.env.TEST_DATABASE_URL},async t=>{
 const admin=await connectPostgres(process.env.TEST_DATABASE_URL);
 const schema='dima_test_'+randomUUID().replaceAll('-','');
 let pool;
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);
  const {Pool}=await import('pg');
  pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,max:6,options:`-c search_path=${schema}`});
  await migrate(pool);await migrate(pool);await seedDevelopment(pool);
  const repository=new PostgresOrders(pool),customer=demoActors['demo-customer'],merchant=demoActors['demo-merchant'],courier=demoActors['demo-courier'];
  const catalog=await repository.catalog();const store=catalog.find(s=>s.id===merchant.storeId);
  const body={storeId:store.id,address:'تونس عنوان تجريبي',items:[{productId:store.products[0].id,quantity:2}],totalMilli:1};
  let order;
  await t.test('concurrent retries create one persisted order',async()=>{
   const rows=await Promise.all(Array.from({length:4},()=>repository.create(customer,body,'postgres-race-01')));
   assert.equal(new Set(rows.map(o=>o.id)).size,1);order=rows[0];
   assert.equal(order.totalMilli,store.products[0].priceMilli*2+store.deliveryMilli);
   assert.equal((await pool.query('SELECT count(*)::int AS n FROM orders')).rows[0].n,1);
   assert.equal((await new PostgresOrders(pool).list(customer))[0].id,order.id);
   await assert.rejects(repository.create(customer,{...body,address:'عنوان آخر في تونس'},'postgres-race-01'),{status:409});
  });
  await t.test('failure after order insert rolls back all rows',async()=>{
   // Force an event INSERT failure only inside this isolated test schema.
   await pool.query("CREATE FUNCTION fail_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test event failure'; END $$; CREATE TRIGGER reject_event BEFORE INSERT ON order_events FOR EACH ROW EXECUTE FUNCTION fail_event()");
   try{await assert.rejects(repository.create(customer,body,'postgres-rollback-01'));assert.equal((await pool.query('SELECT count(*)::int AS n FROM orders')).rows[0].n,1);assert.equal((await pool.query('SELECT count(*)::int AS n FROM idempotency_keys')).rows[0].n,1);}finally{await pool.query('DROP TRIGGER reject_event ON order_events; DROP FUNCTION fail_event()');}
  });
  await t.test('closed store and unavailable product are rejected',async()=>{
   await pool.query('UPDATE stores SET is_open=false WHERE id=$1',[store.id]);
   try{await assert.rejects(repository.create(customer,body,'postgres-closed-01'),{status:400});}finally{await pool.query('UPDATE stores SET is_open=true WHERE id=$1',[store.id]);}
   await pool.query('UPDATE products SET available=false WHERE id=$1',[body.items[0].productId]);
   try{await assert.rejects(repository.create(customer,body,'postgres-stock-01'),{status:400});}finally{await pool.query('UPDATE products SET available=true WHERE id=$1',[body.items[0].productId]);}
  });
  await t.test('two courier connections cannot claim the same order',async()=>{
   for(const status of ['accepted','preparing','ready'])order=await repository.transition(merchant,order.id,status,order.version);
   assert.equal((await repository.list(courier))[0].address,undefined);
   const second={id:randomUUID(),role:'courier'};
   await pool.query("INSERT INTO users(id,phone) VALUES($1,'+21600000005')",[second.id]);
   await pool.query("INSERT INTO user_roles(user_id,role) VALUES($1,'courier')",[second.id]);
   await pool.query('INSERT INTO courier_profiles(user_id,verified,available) VALUES($1,true,true)',[second.id]);
   const outcomes=await Promise.allSettled([repository.transition(courier,order.id,'assigned',order.version),repository.transition(second,order.id,'assigned',order.version)]);
   assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);
   const claimed=outcomes.find(o=>o.status==='fulfilled').value;
   assert.equal(claimed.events.length,5);
   const winner=claimed.courierId===courier.id?courier:second,loser=winner.id===courier.id?second:courier;
   assert.equal((await repository.list(loser)).length,0);
   await repository.transition(winner,order.id,'picked_up',claimed.version);
   await repository.transition(winner,order.id,'delivered',claimed.version+1);
  });
  await t.test('database roles and store membership are enforced',async()=>{
   await assert.rejects(repository.list({...customer,id:randomUUID()}),{status:403});
   await assert.rejects(repository.list({...merchant,storeId:catalog.find(s=>s.id!==store.id).id}),{status:403});
  });
  await t.test('merchant updates preserve order snapshots, enforce ownership and write audit',async()=>{
   const ops=new PostgresOperations(pool),before=await ops.merchantStore(merchant),product=before.products[0];
   const changed=await ops.product(merchant,product.id,{priceMilli:product.priceMilli+1000,version:product.version});assert.equal(changed.version,product.version+1);
   await assert.rejects(ops.product(merchant,product.id,{priceMilli:1,version:product.version}),{status:409});
   const foreignProduct=catalog.find(s=>s.id!==store.id).products[0];
   await assert.rejects(ops.product(merchant,foreignProduct.id,{available:false,version:1}),{status:404});
   await assert.rejects(repository.create(customer,{...body,quoteTotalMilli:order.totalMilli},'postgres-quote-01'),{status:409});
   assert.equal((await repository.list(customer)).find(o=>o.id===order.id).items[0].priceMilli,product.priceMilli);
   assert.equal((await ops.overview(demoActors['demo-admin'])).recentAudit[0].action,'merchant.product.update');
  });
  await t.test('audit failure rolls back product update',async()=>{
   const ops=new PostgresOperations(pool),product=(await ops.merchantStore(merchant)).products[0];
   await pool.query("CREATE FUNCTION fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$; CREATE TRIGGER reject_audit BEFORE INSERT ON operations_audit FOR EACH ROW EXECUTE FUNCTION fail_audit()");
   try{await assert.rejects(ops.product(merchant,product.id,{available:false,version:product.version}));assert.deepEqual((await ops.merchantStore(merchant)).products[0],product);}finally{await pool.query('DROP TRIGGER reject_audit ON operations_audit; DROP FUNCTION fail_audit()');}
  });
  await t.test('Nabeul saved address, coverage, archiving and order snapshots',async()=>{
   const addresses=new PostgresAddresses(pool),saved=(await addresses.list(customer))[0];assert.equal(saved.serviceable,true);
   const fresh=(await repository.catalog()).find(s=>s.id===store.id),product=fresh.products[0];
   const request={storeId:store.id,addressId:saved.id,addressVersion:saved.version,quoteTotalMilli:product.priceMilli*2+fresh.deliveryMilli,items:[{productId:product.id,quantity:2}]};
   const outside=await addresses.create(customer,{label:'خارج النطاق',text:'عنوان وهمي خارج منطقة الاختبار',latitude:0,longitude:0});
   await assert.rejects(repository.create(customer,{...request,addressId:outside.id},'pg-delivery-outside'),{status:422});
   const created=await repository.create(customer,request,'pg-delivery-inside');assert.equal(created.addressSnapshot.zoneId,'nabeul');
   await addresses.archive(customer,saved.id,{version:saved.version});
   assert.equal((await repository.get(customer,created.id)).addressSnapshot.id,saved.id);
   assert.equal((await repository.create(customer,request,'pg-delivery-inside')).id,created.id);
   await assert.rejects(repository.create(customer,request,'pg-delivery-archived'),{status:404});
   await assert.rejects(addresses.list(courier),{status:403});
  });
  await t.test('concurrent bilingual product creation has one resource and one audit entry',async()=>{
   const ops=new PostgresOperations(pool),body={requestId:randomUUID(),name:'منتج نابل الجديد',nameFr:'Nouveau produit Nabeul',priceMilli:7000,available:true};
   const rows=await Promise.all(Array.from({length:3},()=>ops.createProduct(merchant,body)));assert.equal(new Set(rows.map(p=>p.id)).size,1);
   const product=rows[0];assert.equal((await pool.query('SELECT count(*)::int AS n FROM operations_audit WHERE target_id=$1',[product.id])).rows[0].n,1);
   await assert.rejects(ops.createProduct(merchant,{...body,priceMilli:7001}),{status:409});
   const address=await new PostgresAddresses(pool).create(customer,{label:'تجربة',text:'عنوان وهمي في نطاق نابل',latitude:36.46,longitude:10.73});
   const ordered=await repository.create(customer,{storeId:store.id,addressId:address.id,addressVersion:address.version,quoteTotalMilli:product.priceMilli+store.deliveryMilli,items:[{productId:product.id,quantity:1}]},'pg-new-catalog-order');
   await ops.product(merchant,product.id,{name:'اسم أحدث',nameFr:'Nom modifié',version:1});
   assert.equal((await repository.get(customer,ordered.id)).items[0].nameFr,body.nameFr);
  });
  await t.test('failed catalog audit rolls back creation and permits the same request retry',async()=>{
   const ops=new PostgresOperations(pool),body={requestId:randomUUID(),name:'اختبار فشل',nameFr:'Test échec',priceMilli:1000,available:false};
   const before=(await ops.merchantStore(merchant)).products.length;
   await pool.query("CREATE FUNCTION fail_catalog_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test catalog audit failure'; END $$; CREATE TRIGGER reject_catalog_audit BEFORE INSERT ON operations_audit FOR EACH ROW EXECUTE FUNCTION fail_catalog_audit()");
   try{await assert.rejects(ops.createProduct(merchant,body));assert.equal((await ops.merchantStore(merchant)).products.length,before);assert.equal((await pool.query('SELECT count(*)::int AS n FROM product_create_requests WHERE request_id=$1',[body.requestId])).rows[0].n,0);}finally{await pool.query('DROP TRIGGER reject_catalog_audit ON operations_audit; DROP FUNCTION fail_catalog_audit()');}
   assert.equal((await ops.createProduct(merchant,body)).version,1);
  });
 }finally{if(pool)await pool.end();await admin.end();}
});
