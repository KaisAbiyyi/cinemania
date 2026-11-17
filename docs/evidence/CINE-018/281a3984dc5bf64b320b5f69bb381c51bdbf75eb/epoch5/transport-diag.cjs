const fs=require('node:fs'),path=require('node:path'),dns=require('node:dns/promises'),os=require('node:os');
const root=process.env.CINE018_SOURCE_ROOT||'D:/projects/cinemania';
const {loadHostedStaging}=require(path.join(root,'tests/hosted-supabase/environment.cjs'));
const {Client}=require(path.join(root,'scripts/local-supabase/node_modules/pg'));
const target=loadHostedStaging();
async function main(){
 const results=[],startDns=performance.now();const addresses=await dns.lookup(target.pgConfig.host,{all:true});const dnsMs=performance.now()-startDns;
 for(let i=0;i<6;i++){
  const start=performance.now(),phases=[],db=new Client({...target.pgConfig,application_name:'cine018-epoch5-readonly-diag'});
  const mark=name=>phases.push({phase:name,ms:Math.round((performance.now()-start)*100)/100});
  db.connection.stream.on('lookup',()=>mark('dns-lookup'));
  db.connection.stream.once('connect',()=>mark('tcp-connect'));
  db.connection.on('sslconnect',()=>{mark('ssl-wrapper-created');db.connection.stream.once('secureConnect',()=>mark('tls-secure'));});
  for(const event of ['authenticationSASL','authenticationSASLContinue','authenticationSASLFinal','authenticationOk','readyForQuery'])db.connection.on(event,()=>mark(event));
  let result;
  try{await db.connect();mark('client-ready');const stream=db.connection.stream;
   const row=(await db.query('SELECT current_database() AS database,current_user AS actor')).rows[0];mark('readonly-query-complete');
   if(!stream.encrypted||!stream.authorized)throw Error('Strict client TLS not verified');
   result={attempt:i+1,verdict:'PASS',elapsedMs:Math.round(performance.now()-start),remote:stream.remoteAddress,tls:{encrypted:stream.encrypted,authorized:stream.authorized,protocol:stream.getProtocol()},...row,phases};
  }catch(e){result={attempt:i+1,verdict:'FAIL',elapsedMs:Math.round(performance.now()-start),error:e.message,code:e.code||null,remote:db.connection.stream.remoteAddress,phases};}
  finally{await db.end().catch(()=>{});}
  results.push(result);console.log(JSON.stringify(result));
 }
 const report={source:process.env.CINE018_SOURCE_SHA,project:target.project,utc:new Date().toISOString(),node:process.version,platform:os.platform(),release:os.release(),arch:os.arch(),connectionTimeoutMillis:10000,readOnly:true,dnsMs:Math.round(dnsMs),addresses,results};
 const dest=process.env.CINE018_DIAG_OUTPUT;if(dest)fs.writeFileSync(dest,JSON.stringify(report,null,2));
 console.log(JSON.stringify({attempts:results.length,passed:results.filter(x=>x.verdict==='PASS').length,failed:results.filter(x=>x.verdict==='FAIL').length,node:process.version,platform:os.platform()}));
}
main().catch(()=>{console.error('Transport diagnostic failed; no secret values logged');process.exitCode=1;});
