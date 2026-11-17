// Observation only: wrap the controller's SDK callbacks, preserving every return/callback.
const Module=require('node:module'),original=Module._load;
let sequence=0;
Module._load=function(request,parent,isMain){
 const value=original.apply(this,arguments);
 if(typeof request==='string'&&request.includes('@supabase/supabase-js')&&value.createClient&&!value.__cineObserved){
  return {...value,__cineObserved:true,createClient(...args){
   const client=value.createClient(...args),id=++sequence;let expiry;
   const setAuth=client.realtime.setAuth.bind(client.realtime);
   client.realtime.setAuth=async token=>{if(typeof token==='string'){try{const p=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));expiry=p.exp;console.log(JSON.stringify({observation:'raw-observer-jwt',id,now:Math.floor(Date.now()/1000),expires:expiry}));}catch{}}return setAuth(token);};
   const channel=client.channel.bind(client);
   client.channel=(...input)=>{const ch=channel(...input),subscribe=ch.subscribe.bind(ch);
    ch.subscribe=(callback,...rest)=>subscribe((status,error)=>{console.log(JSON.stringify({observation:'raw-observer-channel',id,status,now:Math.floor(Date.now()/1000),expires:expiry,expiredAtCallback:expiry?Date.now()/1000>=expiry:null,errorMentionsExpiry:!!error&&/expir/i.test(String(error.message))}));return callback?.(status,error);},...rest);
    return ch;
   };
   return client;
  }};
 }
 return value;
};
