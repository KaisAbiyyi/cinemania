const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const {Client}=require('D:/projects/cinemania/node_modules/pg');
const root='D:/projects/cinemania';
const ref='dmrbticnsczhyaiftrar';
const dir='D:/projects/cinemania-cine018-evidence/staging-epoch4-private';
fs.mkdirSync(dir,{recursive:true});
const env={};
for(const line of fs.readFileSync(path.join(root,'.env.test.local'),'utf8').split(/\r?\n/)){
 const m=line.match(/^(SUPABASE_PG_(?:HOST|PORT|DATABASE|USER|PASSWORD))=(.*)$/);if(m)env[m[1]]=m[2].trim();
}
if(!env.SUPABASE_PG_HOST.includes(ref)&&!env.SUPABASE_PG_USER.includes(ref))throw Error('Ref fence refused');
const caPath=path.join(root,'supabase-ca.crt');
const candidates=['src/db/supabase-root-ca.crt','supabase-ca.crt','prod-ca-2021.crt','supabase-ca.pem','certs/prod-ca-2021.crt'];
const ca=candidates.map(p=>path.join(root,p)).find(p=>fs.existsSync(p));
const config={host:env.SUPABASE_PG_HOST,port:Number(env.SUPABASE_PG_PORT||5432),database:env.SUPABASE_PG_DATABASE||'postgres',user:env.SUPABASE_PG_USER,password:env.SUPABASE_PG_PASSWORD,ssl:{rejectUnauthorized:true,...(ca?{ca:fs.readFileSync(ca,'utf8')}:{})},connectionTimeoutMillis:10000,statement_timeout:20000};
async function main(){
 const db=new Client(config);try{await db.connect();console.log('PASS strict-TLS staging connection');
 const queries={
 identity:'SELECT current_database(),current_user,version(),inet_server_addr(),current_setting(\'search_path\')',
 schemas:"SELECT nspname,pg_get_userbyid(nspowner) owner,nspacl FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' ORDER BY 1",
 relations:"SELECT n.nspname,c.relname,c.relkind,c.relrowsecurity,c.relacl,pg_get_userbyid(c.relowner) owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' ORDER BY 1,2",
 functions:"SELECT p.proname,pg_get_function_identity_arguments(p.oid) args,pg_get_functiondef(p.oid) def,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY 1,2",
 types:"SELECT t.typname,t.typtype FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' ORDER BY 1",
 policies:'SELECT * FROM pg_policies ORDER BY schemaname,tablename,policyname',
 default_acl:'SELECT * FROM pg_default_acl ORDER BY oid',
 grants:"SELECT * FROM information_schema.role_table_grants WHERE table_schema IN ('public','realtime','supabase_migrations') ORDER BY table_schema,table_name,grantee,privilege_type",
 migrations:'SELECT * FROM supabase_migrations.schema_migrations ORDER BY version',
 data_counts:"SELECT (SELECT count(*) FROM auth.users) users,(SELECT count(*) FROM storage.buckets) buckets,(SELECT count(*) FROM storage.objects) objects,(SELECT count(*) FROM realtime.messages) messages",
 extensions:'SELECT extname,extversion FROM pg_extension ORDER BY extname'};
 const result={project:ref,utc:new Date().toISOString(),head:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()};
 for(const [name,q] of Object.entries(queries))result[name]=(await db.query(q)).rows;
 const objects=result.relations.filter(x=>x.nspname==='public');
 console.log('Public relations:',objects.length,'functions:',result.functions.length,'types:',result.types.length,'counts:',JSON.stringify(result.data_counts));
 fs.writeFileSync(path.join(dir,'catalog-baseline.json'),JSON.stringify(result,null,2));
 const hist=result.migrations[0];const src=fs.readFileSync(path.join(root,'src/db/migrations/001_create_room_schema.sql'),'utf8');
 console.log('Migration record count:',result.migrations.length,'canonical001 exact:',hist?.statements?.join('\n')===src);
 }finally{await db.end();}
 const pgEnv={...process.env,PGHOST:config.host,PGPORT:String(config.port),PGUSER:config.user,PGPASSWORD:config.password,PGDATABASE:config.database,PGSSLMODE:'verify-full',PGCONNECT_TIMEOUT:'10',...(ca?{PGSSLROOTCERT:ca}:{})};
 for(const [name,args] of [['full',['--format=custom']],['schema',['--schema-only']],['application',['--format=custom','--schema=public','--schema=supabase_migrations']]]){
 const dest=path.join(dir,name+'.dump');const r=cp.spawnSync('C:/Program Files/PostgreSQL/18/bin/pg_dump.exe',[...args,'--file',dest],{env:pgEnv,encoding:'utf8',timeout:120000});
 fs.writeFileSync(path.join(dir,name+'-dump.stderr.private.txt'),r.stderr||'');
 console.log('pg_dump',name,'exit',r.status,'bytes',fs.existsSync(dest)?fs.statSync(dest).size:0);if(r.status!==0)throw Error('Backup failed; no staging writes permitted');
 console.log('sha256',name,crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex'));
 }
}
main().catch(e=>{console.error('Baseline blocked:',e.code||e.message.replace(/password[^\n]*/gi,'[redacted]'));process.exitCode=1;});

