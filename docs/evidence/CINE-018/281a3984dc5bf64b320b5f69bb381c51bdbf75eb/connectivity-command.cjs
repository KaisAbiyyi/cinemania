const fs=require('node:fs'),cp=require('node:child_process'),dns=require('node:dns/promises');
process.chdir('D:/projects/cinemania');process.env.CINE018_STAGING_PROJECT='dmrbticnsczhyaiftrar';
const target=require('D:/projects/cinemania/tests/hosted-supabase/environment.cjs').loadHostedStaging();
const {Client}=require('D:/projects/cinemania/scripts/local-supabase/node_modules/pg');
const head=cp.execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dir='D:/projects/cinemania-cine018-evidence/'+head;
async function main(){const addresses=await dns.lookup(target.pgConfig.host,{all:true});const results=[];
const probes=[...Array(4).fill(null),...addresses.map(x=>x.address)];
for(let i=0;i<probes.length;i++){const db=new Client({...target.pgConfig,...(probes[i]?{host:probes[i]}:{})}),start=performance.now();let tcpMs=null,remoteAddress=null;
db.connection.stream.once('connect',()=>{tcpMs=performance.now()-start;remoteAddress=db.connection.stream.remoteAddress;});
try{await db.connect();const row=(await db.query('SELECT current_database() AS database,current_user AS actor,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS backend_tls_from_pooler')).rows[0];const socket=db.connection.stream;results.push({attempt:i+1,probe:probes[i]||'normal DNS',status:'PASS',elapsedMs:Math.round(performance.now()-start),tcpMs:tcpMs===null?null:Math.round(tcpMs),remoteAddress,clientTls:{encrypted:socket.encrypted===true,authorized:socket.authorized===true,protocol:socket.getProtocol?.()},...row});}
catch(e){results.push({attempt:i+1,probe:probes[i]||'normal DNS',status:'FAIL',elapsedMs:Math.round(performance.now()-start),tcpMs:tcpMs===null?null:Math.round(tcpMs),remoteAddress,code:e.code||null,error:e.message});}
finally{await db.end().catch(()=>{});}}
const result={head,utc:new Date().toISOString(),project:target.project,readOnly:true,connectionTimeoutMs:10000,tlsVerification:'strict root CA and hostname; unchanged',addresses,results};fs.writeFileSync(dir+'/hosted-connectivity.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
main().catch(()=>{console.error('Read-only staging connectivity diagnostic failed');process.exitCode=1;});
