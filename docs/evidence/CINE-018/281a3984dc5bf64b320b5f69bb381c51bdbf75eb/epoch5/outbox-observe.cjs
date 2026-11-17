const fs=require('node:fs');
const target=require('D:/projects/cinemania/tests/hosted-supabase/environment.cjs').loadHostedStaging();
const {Client}=require('D:/projects/cinemania/node_modules/pg');
async function main(){const db=new Client(target.pgConfig),samples=[];await db.connect();try{for(let i=0;i<18;i++){const r=await db.query("SELECT clock_timestamp() AS observed_at,room_id,version,dispatched,dispatched_at,retry_count,poison FROM public.room_events ORDER BY room_id,version");samples.push({clientUtc:new Date().toISOString(),rows:r.rows});await new Promise(resolve=>setTimeout(resolve,5000));}}finally{await db.end();fs.writeFileSync('D:/projects/cinemania-cine018-reviewfix-evidence/outbox-observations.json',JSON.stringify({readOnly:true,applicationHttpRequests:0,samples},null,2));console.log('Read-only outbox observation complete; samples='+samples.length);}}
main().catch(()=>{console.error('Read-only outbox observation failed');process.exitCode=1;});
