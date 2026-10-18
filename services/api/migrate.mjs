import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {connectPostgres,transaction} from './postgres.mjs';
import {demoZones} from './delivery.mjs';

export async function migrate(pool){
 const root=new URL('../../database/',import.meta.url);
 const files=(await readdir(root)).filter(n=>/^\d+_.*\.sql$/.test(n)).sort();
 await transaction(pool,async client=>{
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('dima-migrations',0))");
  const existing=(await client.query("SELECT to_regclass('users') AS users,to_regclass('schema_migrations') AS migrations")).rows[0];
  if(existing.users&&!existing.migrations)throw new Error('Existing untracked schema detected. Use a new development database or review a manual migration baseline; no tables were changed.');
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
  for(const name of files){
   const source=await readFile(new URL(name,root),'utf8'),checksum=createHash('sha256').update(source).digest('hex');
   const prior=(await client.query('SELECT checksum FROM schema_migrations WHERE name=$1',[name])).rows[0];
   if(prior){if(prior.checksum!==checksum)throw new Error(`Migration checksum changed: ${name}`);continue;}
   // Migration files have one outer BEGIN/COMMIT; runner owns the transaction.
   const sql=source.replace(/^\s*BEGIN;\s*/i,'').replace(/\s*COMMIT;\s*$/i,'');
   await client.query(sql);
   await client.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',[name,checksum]);
  }
 });
}
export async function seedDevelopment(pool){
 return transaction(pool,seedDevelopmentClient);
}
export async function seedDevelopmentClient(client){
 if(process.env.NODE_ENV==='production')throw new Error('Development seed disabled in production');
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('dima-development-seed',0))");
  await client.query(await readFile(new URL('../../database/seed.development.sql',import.meta.url),'utf8'));
  for(const z of demoZones){
   await client.query('INSERT INTO service_zones(id,name_ar,name_fr,south,north,west,east,geometry,enabled) VALUES($1,$2,$3,$4,$5,$6,$7,$8,true) ON CONFLICT(id) DO NOTHING',[z.id,z.name,z.nameFr,z.south,z.north,z.west,z.east,z.geometry]);
   await client.query('INSERT INTO store_service_zones(store_id,zone_id) SELECT id,$1 FROM stores WHERE id=ANY($2::uuid[]) ON CONFLICT DO NOTHING',[z.id,['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002']]);
  }
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(process.env.NODE_ENV==='production')throw new Error('This development migration CLI is disabled in production');
 if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
 const pool=await connectPostgres(process.env.DATABASE_URL);
 try{await migrate(pool);if(process.argv.includes('--seed'))await seedDevelopment(pool);console.log('DIMA database ready');}finally{await pool.end();}
}
