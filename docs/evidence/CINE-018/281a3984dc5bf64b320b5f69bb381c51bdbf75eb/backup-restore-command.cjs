const fs=require('node:fs'),crypto=require('node:crypto'),cp=require('node:child_process');
const {Client}=require('D:/projects/cinemania/node_modules/pg');
const {parseEnvFile,STACK_ENV_PATH}=require('D:/projects/cinemania/scripts/local-supabase/generate-env.cjs');
const dir='D:/projects/cinemania-cine018-evidence/staging-epoch4-private';
const local=parseEnvFile(STACK_ENV_PATH),name='cine018_backup_'+crypto.randomBytes(16).toString('hex');
const config={host:'127.0.0.1',port:55432,user:'supabase_admin',password:local.POSTGRES_PASSWORD,database:'postgres'};
const bin='C:/Program Files/PostgreSQL/18/bin/pg_restore.exe';
async function main(){const admin=new Client(config);await admin.connect();let owned=false;
try{
 const list=cp.spawnSync(bin,['--list',dir+'/full.dump'],{encoding:'utf8'});if(list.status!==0)throw Error('Archive integrity/list failed');
 fs.writeFileSync(dir+'/full-toc.private.txt',list.stdout);console.log('PASS full archive readable; TOC entries',list.stdout.split('\n').filter(x=>/^\d+;/.test(x)).length);
 await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);owned=true;
 const env={...process.env,PGHOST:'127.0.0.1',PGPORT:'55432',PGUSER:config.user,PGPASSWORD:config.password,PGDATABASE:name,PGSSLMODE:'disable'};
 const r=cp.spawnSync(bin,['--clean','--if-exists','--no-owner','--no-acl','--exit-on-error','--dbname',name,dir+'/application.dump'],{env,encoding:'utf8',timeout:30000});
 fs.writeFileSync(dir+'/restore.private.stderr.txt',r.stderr||'');if(r.status!==0)throw Error('Application restore failed exit '+r.status);
 const db=new Client({...config,database:name});await db.connect();try{
 const history=(await db.query('SELECT * FROM supabase_migrations.schema_migrations ORDER BY version')).rows;
 const baseline=JSON.parse(fs.readFileSync(dir+'/catalog-baseline.json'));
 require('node:assert/strict').deepEqual(history,baseline.migrations);
 const count=(await db.query("SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'")).rows[0].n;
 require('node:assert/strict').equal(count,0);console.log('PASS application+history restore into exclusively created local DB; migration record byte-equivalent; public relations zero');
 }finally{await db.end();}
}finally{if(owned){await admin.query(`DROP DATABASE "${name}"`);console.log('PASS owned disposable restore database removed');}await admin.end();}}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
