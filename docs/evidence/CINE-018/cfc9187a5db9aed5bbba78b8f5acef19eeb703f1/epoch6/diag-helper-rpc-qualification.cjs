const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict'),cp=require('node:child_process');
const root='D:/projects/cinemania/.claude/worktrees/cine-018-pr51-qualification-040873',base='C:/Users/kaisa/AppData/Local/Temp/claude/3965350c0720d9b4/3526ecb3-744e-43c5-8170-17049c608f48/scratchpad/logs';
process.chdir(root);
const {loadHostedStaging,assertEmptyHostedApplication}=require(root+'/tests/hosted-supabase/environment.cjs');
const {Client}=require(root+'/node_modules/pg');
const target=loadHostedStaging(),head=cp.execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const rooms=[crypto.randomUUID(),crypto.randomUUID()],members=[crypto.randomUUID(),crypto.randomUUID()],codes=[crypto.randomBytes(3).toString('hex').toUpperCase(),crypto.randomBytes(3).toString('hex').toUpperCase()];
const tag='cine018_epoch5_'+crypto.randomBytes(6).toString('hex'),checks=[];
function jwt(sub,room,{wrong=false,expired=false,metadata}={}){const now=Math.floor(Date.now()/1000);const p={sub,room_id:room,role:'authenticated',aud:'authenticated',iss:'cinematch',iat:expired?now-180:now,exp:expired?now-60:now+60,...(metadata?{user_metadata:metadata}:{})};const b=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),s=b({alg:'HS256',typ:'JWT'})+'.'+b(p);return s+'.'+crypto.createHmac('sha256',wrong?'synthetic-wrong-key-never-trusted':target.stackEnv.JWT_SECRET).update(s).digest('base64url');}
async function call(name,token,args,expected){const res=await fetch(target.url+'/rest/v1/rpc/is_current_user_room_participant',{method:'POST',headers:{apikey:target.stackEnv.ANON_KEY,'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(args),signal:AbortSignal.timeout(10000)});const body=await res.json();if(typeof expected==='boolean'){assert.equal(res.status,200,name);assert.equal(body,expected,name);}else assert(expected.includes(res.status),name+' expected denial status');checks.push({name,http:res.status,...(typeof body==='boolean'?{boolean:body}:{}),verdict:'PASS'});}
async function main(){const db=new Client(target.pgConfig);let owned=false;
await db.connect();
try{
 await assertEmptyHostedApplication(db);
 fs.writeFileSync(base+'/rpc-fixture-provenance.json',JSON.stringify({head,project:target.project,tag,rooms,members,codes,utc:new Date().toISOString()},null,2));
 await db.query('BEGIN');
 await db.query('INSERT INTO public.rooms(id,code) VALUES ($1,$2),($3,$4)',[rooms[0],codes[0],rooms[1],codes[1]]);
 await db.query("INSERT INTO public.room_participants(room_id,participant_id,display_name,role) VALUES ($1,$2,$3,'HOST'),($4,$5,$3,'HOST')",[rooms[0],members[0],tag,rooms[1],members[1]]);
 await db.query('COMMIT');owned=true;
 const alice=jwt(members[0],rooms[0]);
 await call('own membership boolean only',alice,{target_room_id:rooms[0]},true);
 await call('cross-room boolean false',alice,{target_room_id:rooms[1]},false);
 await call('other member cannot query Alice membership as self',jwt(members[1],rooms[1]),{target_room_id:rooms[0]},false);
 await call('outsider ignores forged user_metadata identity',jwt(crypto.randomUUID(),rooms[0],{metadata:{sub:members[0],participant_id:members[0],room_id:rooms[0]}}),{target_room_id:rooms[0]},false);
 await call('anonymous EXECUTE denied',null,{target_room_id:rooms[0]},[401,403,404]);
 await call('forged signature denied',jwt(members[0],rooms[0],{wrong:true}),{target_room_id:rooms[0]},[401,403]);
 await call('expired JWT denied',jwt(members[0],rooms[0],{expired:true}),{target_room_id:rooms[0]},[401,403]);
 await call('caller cannot supply target_user_id',alice,{target_room_id:rooms[0],target_user_id:members[1]},[400,404]);
}finally{
 await db.query('ROLLBACK').catch(()=>{});
 if(owned){await db.query("UPDATE public.rooms SET status='EXPIRED',expires_at=NOW()-INTERVAL '1 second' WHERE id=ANY($1::uuid[])",[rooms]);await db.query('DELETE FROM public.rooms WHERE id=ANY($1::uuid[])',[rooms]);assert.equal((await db.query('SELECT count(*)::int n FROM public.rooms WHERE id=ANY($1::uuid[])',[rooms])).rows[0].n,0);}
 await db.end();
 const report={head,project:target.project,utc:new Date().toISOString(),checks,ownedFixtureCleanup:owned?'PASS':'no committed fixtures',credentialValuesLogged:false};fs.writeFileSync(base+'/helper-rpc-results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}}
main().catch(error=>{console.error('Helper RPC qualification failed:',error.message);process.exitCode=1;});
