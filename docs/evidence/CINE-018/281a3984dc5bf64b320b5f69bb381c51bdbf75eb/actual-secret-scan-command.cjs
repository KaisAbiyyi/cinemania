const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root='D:/projects/cinemania';process.chdir(root);
const sha=cp.execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const secret=JSON.parse(fs.readFileSync('D:/projects/cinemania-cine018-evidence/staging-epoch4-private/api-keys.json','utf8'));
const line=fs.readFileSync('.env.test.local','utf8').split(/\r?\n/).find(x=>x.startsWith('SUPABASE_PG_PASSWORD='));
const values=[secret.SUPABASE_SECRET_KEY,secret.SUPABASE_JWT_SECRET,line?.slice(line.indexOf('=')+1).trim()].filter(Boolean);
const variants=values.flatMap(x=>[x,encodeURIComponent(x),Buffer.from(x).toString('base64'),Buffer.from(x).toString('base64url')]);
const walk=p=>fs.readdirSync(p,{withFileTypes:true}).flatMap(x=>x.isDirectory()?walk(path.join(p,x.name)):x.name.endsWith('.js')?[path.join(p,x.name)]:[]);
const bundles=walk('.next/static');if(!bundles.length)throw Error('Missing build');
const tracked=cp.execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(x=>x&&fs.existsSync(x)&&fs.statSync(x).isFile());
const hits=[];for(const file of new Set([...bundles,...tracked])){const data=fs.readFileSync(file);if(variants.some(x=>data.includes(Buffer.from(x))))hits.push(file);}
const output={head:sha,utc:new Date().toISOString(),cwd:root,actualServerJwtPgCredentialsScanned:true,representations:['literal','URL-encoded','base64','base64url'],clientBundles:bundles.length,trackedFiles:tracked.length,matchingPaths:hits,verdict:hits.length?'FAIL':'PASS'};
fs.writeFileSync('D:/projects/cinemania-cine018-evidence/'+sha+'/actual-secret-scan.json',JSON.stringify(output,null,2));console.log(JSON.stringify(output));if(hits.length)process.exitCode=1;
