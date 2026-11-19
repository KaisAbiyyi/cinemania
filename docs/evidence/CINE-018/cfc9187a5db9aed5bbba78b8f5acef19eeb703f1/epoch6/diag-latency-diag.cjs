// Read-only latency diagnosis of the hosted dispatch path (no schema writes; fixtures none).
const root = process.env.WT;
process.chdir(root);
const { loadHostedStaging } = require(root + "/tests/hosted-supabase/environment.cjs");
const { Pool } = require(root + "/node_modules/pg");
const t = loadHostedStaging();
const ms = (a) => Number((performance.now() - a).toFixed(0));
const stat = (xs) => { const s = [...xs].sort((a,b)=>a-b); return { n: s.length, min: s[0], p50: s[Math.floor(s.length/2)], p90: s[Math.floor(s.length*0.9)], max: s[s.length-1] }; };
(async () => {
  const pool = new Pool({ ...t.pgConfig, max: 2, statement_timeout: 5000, query_timeout: 7000 });
  const out = {};
  let a = performance.now(); const c0 = await pool.connect(); out.firstConnectMs = ms(a); c0.release();
  const rtt = [];
  for (let i = 0; i < 20; i++) { a = performance.now(); await pool.query("SELECT 1"); rtt.push(ms(a)); }
  out.selectRttMs = stat(rtt);
  // Replicate withRoomLock transaction shape against room_events (read-only, empty table) with real broadcast POST to a throwaway topic.
  const seq = [];
  for (let i = 0; i < 10; i++) {
    const s = performance.now(); const steps = {};
    let x = performance.now(); const c = await pool.connect(); steps.connect = ms(x);
    x = performance.now(); await c.query("BEGIN"); steps.begin = ms(x);
    x = performance.now(); await c.query("SET LOCAL lock_timeout = '250ms'"); steps.setLocal = ms(x);
    x = performance.now(); await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", ["cinematch-diag:" + i]); steps.lock = ms(x);
    x = performance.now(); await c.query("SELECT id::text, version FROM public.room_events WHERE room_id = $1 AND NOT dispatched AND NOT poison ORDER BY version ASC LIMIT 3", ["00000000-0000-4000-8000-000000000000"]); steps.pending = ms(x);
    x = performance.now(); await c.query("ROLLBACK"); steps.end = ms(x);
    c.release(); steps.total = ms(s); seq.push(steps);
  }
  out.dispatchTxnShape = Object.fromEntries(Object.keys(seq[0]).map(k => [k, stat(seq.map(s => s[k]))]));
  // Broadcast REST latency to a throwaway private topic with the server key (no subscribers).
  const bc = [];
  for (let i = 0; i < 15; i++) {
    const topic = encodeURIComponent("room:" + "00000000-0000-4000-8000-0000000000" + String(10 + i));
    a = performance.now();
    let status; try { const r = await fetch(`${t.url}/realtime/v1/api/broadcast/${topic}/events/room_changed?private=true`, { method: "POST", headers: { "content-type": "application/json", apikey: t.appEnv.SUPABASE_SECRET_KEY }, body: JSON.stringify({ roomId: "diag", version: 0 }), signal: AbortSignal.timeout(10000) }); status = r.status; } catch (e) { status = "ERR:" + e.name; }
    bc.push({ status, ms: ms(a) });
  }
  out.broadcastPost = { statuses: [...new Set(bc.map(b => b.status))], ms: stat(bc.map(b => b.ms)), over1500: bc.filter(b => b.ms > 1500).length };
  await pool.end();
  console.log(JSON.stringify(out, null, 1));
})().catch(e => { console.error("diag failed:", e.message); process.exit(1); });
