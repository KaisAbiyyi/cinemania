"use strict";
// Real local WebSocket probe; never reads hosted settings or credentials.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const { Client } = require("pg");
const { createClient } = require("@supabase/supabase-js");
const { assertLocalStack } = require("./runtime.cjs");
assertLocalStack();
process.loadEnvFile(path.resolve(__dirname, "../../supabase/.env.local"));
const jwtSecret = process.env.JWT_SECRET;
const anon = process.env.ANON_KEY;
const service = process.env.SERVICE_ROLE_KEY;
if (!jwtSecret || !anon || !service || !process.env.POSTGRES_PASSWORD) throw new Error("Local synthetic credentials missing");
const db = new Client({ host: "127.0.0.1", port: 55432, user: "supabase_admin", password: process.env.POSTGRES_PASSWORD, database: "postgres", connectionTimeoutMillis: 5000 });
const clients = [];
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
function token(room, participant) {
  const iat = Math.floor(Date.now() / 1000);
  const input = b64({ alg: "HS256", typ: "JWT" }) + "." + b64({ sub: participant, room_id: room, role: "authenticated", aud: "authenticated", iss: "cinematch", iat, exp: iat + 60 });
  return input + "." + crypto.createHmac("sha256", jwtSecret).update(input).digest("base64url");
}
async function open(room, participant, topic, privateChannel = true) {
  const client = createClient("http://127.0.0.1:54321", anon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  clients.push(client);
  await client.realtime.setAuth(token(room, participant));
  const messages = [];
  const channel = client.channel("room:" + topic, { config: { private: privateChannel, broadcast: { ack: true } } });
  channel.on("broadcast", { event: "room_changed" }, (message) => messages.push(message.payload));
  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve("TIMEOUT"), 10000);
    channel.subscribe((status) => { if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") { clearTimeout(timer); resolve(status); } });
  });
  return { client, channel, messages, result };
}
async function main() {
  await db.connect();
  const existing = await db.query("SELECT private_only FROM _realtime.tenants WHERE external_id='realtime-dev'");
  if (existing.rows.length !== 1 || existing.rows[0].private_only !== true) throw new Error("Local Realtime tenant is not private-only");
  const roomA = crypto.randomUUID(), roomB = crypto.randomUUID(), a = crypto.randomUUID(), b = crypto.randomUUID();
  const codeA = crypto.randomBytes(3).toString("hex").toUpperCase();
  const codeB = crypto.randomBytes(3).toString("hex").toUpperCase();
  await db.query("INSERT INTO rooms(id,code) VALUES ($1,$2),($3,$4)", [roomA,codeA,roomB,codeB]);
  await db.query("INSERT INTO room_participants(room_id,participant_id,display_name) VALUES ($1,$2,'Local A'),($3,$4,'Local B')", [roomA,a,roomB,b]);
  await db.query("CREATE POLICY gh52_probe_competing_insert ON realtime.messages FOR INSERT TO authenticated WITH CHECK (true)");
  try {
    const member = await open(roomA,a,roomA);
    assert.equal(member.result, "SUBSCRIBED", "own room private join");
    const cross = await open(roomA,a,roomB);
    assert.notEqual(cross.result, "SUBSCRIBED", "cross-room private join");
    const publicJoin = await open(roomA,a,roomA,false);
    assert.notEqual(publicJoin.result, "SUBSCRIBED", "public join disabled");
    const forged = await member.channel.send({ type:"broadcast", event:"room_changed", payload:{ roomId:roomA,version:99 } });
    assert.notEqual(forged, "ok", "client-forged broadcast denied despite competing permissive policy");
    const response = await fetch("http://127.0.0.1:54321/realtime/v1/api/broadcast/" + encodeURIComponent("room:" + roomA) + "/events/room_changed?private=true", {
      method:"POST", headers: { "content-type":"application/json", apikey:service }, body:JSON.stringify({ roomId:roomA,version:1 })
    });
    assert.equal(response.ok, true, "server HTTP publication");
    await new Promise(resolve => setTimeout(resolve, 1000));
    assert.equal(member.messages.some(m => m.version === 1), true, "authorized private websocket receives server hint");
    assert.equal(member.messages.some(m => m.version === 99), false, "forgery not delivered");
    console.log("PASS: local private join, cross-room denial, public denial, competing-policy forged denial, server REST to private WebSocket");
  } finally {
    await Promise.allSettled(clients.map(client => client.removeAllChannels()));
    await db.query("DROP POLICY IF EXISTS gh52_probe_competing_insert ON realtime.messages");
  }
}
main().catch((error) => { console.error("Local WS probe failed:", error.message); process.exitCode = 1; }).finally(() => db.end());
