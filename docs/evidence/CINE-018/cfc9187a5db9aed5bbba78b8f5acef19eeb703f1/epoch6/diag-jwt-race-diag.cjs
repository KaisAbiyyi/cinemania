// Synthetic diagnosis: does a private Realtime channel keep delivering broadcasts after its 60s JWT expires, with/without renewal?
const fs = require("node:fs"), crypto = require("node:crypto");
const root = process.env.WT; process.chdir(root);
const { loadHostedStaging, assertEmptyHostedApplication } = require(root + "/tests/hosted-supabase/environment.cjs");
const { Client } = require(root + "/node_modules/pg");
const { createClient } = require(root + "/node_modules/@supabase/supabase-js");
const t = loadHostedStaging();
const room = crypto.randomUUID(), member = crypto.randomUUID(), code = crypto.randomBytes(3).toString("hex").toUpperCase(), tag = "cine018_epoch6_jwtdiag_" + crypto.randomBytes(4).toString("hex");
const mint = (ttl) => { const now = Math.floor(Date.now() / 1000); const b = x => Buffer.from(JSON.stringify(x)).toString("base64url"); const s = b({ alg: "HS256", typ: "JWT" }) + "." + b({ sub: member, room_id: room, role: "authenticated", aud: "authenticated", iss: "cinematch", iat: now, exp: now + ttl }); return s + "." + crypto.createHmac("sha256", t.stackEnv.JWT_SECRET).update(s).digest("base64url"); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let db = new Client(t.pgConfig); db.on('error',()=>{}); await db.connect(); let owned = false;
  const log = [];
  try {
    await assertEmptyHostedApplication(db);
    await db.query("BEGIN");
    await db.query("INSERT INTO public.rooms(id,code) VALUES ($1,$2)", [room, code]);
    await db.query("INSERT INTO public.room_participants(room_id,participant_id,display_name,role) VALUES ($1,$2,$3,'HOST')", [room, member, tag]);
    await db.query("COMMIT"); owned = true; await db.end();
    const client = createClient(t.url, t.stackEnv.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const t0 = performance.now(); const at = () => Number(((performance.now() - t0) / 1000).toFixed(1));
    await client.realtime.setAuth(mint(60));
    const got = [];
    const ch = client.channel("room:" + room, { config: { private: true } });
    ch.on("broadcast", { event: "room_changed" }, m => got.push({ v: m.payload.version, t: at() }));
    const statuses = [];
    await new Promise(res => ch.subscribe(s => { statuses.push({ s, t: at() }); if (s === "SUBSCRIBED") res(); }));
    const send = async v => { const r = await fetch(`${t.url}/realtime/v1/api/broadcast/${encodeURIComponent("room:" + room)}/events/room_changed?private=true`, { method: "POST", headers: { apikey: t.appEnv.SUPABASE_SECRET_KEY, "content-type": "application/json" }, body: JSON.stringify({ roomId: room, version: v }) }); log.push({ sent: v, at: at(), http: r.status }); };
    // continuous broadcasts (every 400ms) across product-cadence renewals (every 30s) for ~100s
    const renewals = [];
    const renew = setInterval(async () => { const s0 = at(); await client.realtime.setAuth(mint(60)); renewals.push({ start: s0, end: at() }); }, 30000);
    let v = 0; const end = performance.now() + 100000;
    while (performance.now() < end) { v++; await send(v); await sleep(400); }
    clearInterval(renew); await sleep(3000);
    const recv = new Set(got.map(g => g.v));
    const missing = log.filter(l => l.sent && !recv.has(l.sent)).map(l => ({ v: l.sent, at: l.at }));
    console.log(JSON.stringify({ sent: v, received: recv.size, missing, renewals, statuses }, null, 1));
    await client.removeChannel(ch);
    
  } finally {
    if (owned) { db = new Client(t.pgConfig); db.on('error',()=>{}); await db.connect(); await db.query("UPDATE public.rooms SET status='EXPIRED',expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [room]); await db.query("DELETE FROM public.rooms WHERE id=$1", [room]); console.log("cleanup rooms remaining:", (await db.query("SELECT count(*)::int n FROM public.rooms WHERE id=$1", [room])).rows[0].n); }
    await db.end();
  }
})().catch(e => { console.error("diag failed:", e.message); process.exit(1); });
