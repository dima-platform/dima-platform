// Dedicated synthetic staging database only. Never point this at live customer data.
import {connectPostgres,transaction} from './postgres.mjs';
import {migrate,seedDevelopmentClient} from './migrate.mjs';
import {deploymentSettings} from './server.mjs';
import {spawn} from 'node:child_process';
deploymentSettings();
if(process.env.DIMA_HOSTED_DEMO!=='true'||process.env.NODE_ENV==='production')throw Error('Synthetic hosted demo configuration required');
const pool=await connectPostgres(process.env.DATABASE_URL);
try{
 await migrate(pool);
 await transaction(pool,async client=>{
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('dima-demo-bootstrap',0))");
  await client.query('CREATE TABLE IF NOT EXISTS demo_bootstrap(version integer PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT now())');
  const seeded=await client.query('SELECT 1 FROM demo_bootstrap WHERE version=1');
  if(!seeded.rowCount){
   await seedDevelopmentClient(client);
   await client.query('INSERT INTO demo_bootstrap(version) VALUES(1)');
  }
 });
}finally{await pool.end();}
const child=spawn(process.execPath,['services/api/server.mjs'],{stdio:'inherit',env:process.env});
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
child.once('exit',code=>process.exit(code??1));
