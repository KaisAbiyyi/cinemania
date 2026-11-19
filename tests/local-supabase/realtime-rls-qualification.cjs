/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";
// Real local Docker Supabase Realtime + Postgres RLS + JWT qualification suite.
// Default loopback-only. --hosted-staging requires a separate exact-project consent fence.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const { Client } = require(path.resolve(__dirname, "../../scripts/local-supabase/node_modules/pg"));
const { createClient } = require(path.resolve(__dirname, "../../scripts/local-supabase/node_modules/@supabase/supabase-js"));
const { assertLocalStack } = require("../../scripts/local-supabase/runtime.cjs");
const { parseEnvFile, STACK_ENV_PATH } = require("../../scripts/local-supabase/generate-env.cjs");

const { loadHostedStaging, assertEmptyHostedApplication } = require("../hosted-supabase/environment.cjs");
const hosted = process.argv.includes("--hosted-staging") ? loadHostedStaging() : null;
if (!hosted) assertLocalStack();
const stackEnv = hosted ? hosted.stackEnv : parseEnvFile(STACK_ENV_PATH);
const supabaseUrl = hosted ? hosted.url : "http://127.0.0.1:54321";
const jwtSecret = stackEnv.JWT_SECRET;
const anonKey = stackEnv.ANON_KEY;
const serviceKey = stackEnv.SERVICE_ROLE_KEY;
const pgPassword = stackEnv.POSTGRES_PASSWORD;
if (!jwtSecret || !anonKey || !serviceKey || (!hosted && !pgPassword)) {
  throw new Error("Local synthetic credentials missing in supabase/.env.local");
}

const b64 = (value) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

function signJwt({ room, participant, secret = jwtSecret, ttlSeconds = 60, role = "authenticated", includeRoomId = true }) {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + ttlSeconds;
  const payload = {
    sub: participant,
    role,
    aud: "authenticated",
    iss: "cinematch",
    iat,
    exp,
    ...(includeRoomId ? { room_id: room } : {}),
  };
  const input = `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}`;
  return `${input}.${crypto.createHmac("sha256", secret).update(input).digest("base64url")}`;
}

async function subscribeChannel(clients, jwt, topic, { privateChannel = true, timeoutMs = 6000 } = {}) {
  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  clients.push(client);
  await client.realtime.setAuth(jwt);
  const messages = [];
  const channel = client.channel(topic, { config: { private: privateChannel, broadcast: { ack: true } } });
  let diagnostic = "";
  channel.on("broadcast", { event: "room_changed" }, (msg) => messages.push(msg.payload));
  const status = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve("TIMEOUT"), timeoutMs);
    channel.subscribe((state, error) => {
      if (error) diagnostic = String(error.message || error).replace(/eyJ[A-Za-z0-9_.-]+/g, "[JWT redacted]").replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, "[API key redacted]");
      if (state === "SUBSCRIBED" || state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") {
        clearTimeout(timer);
        resolve(state);
      }
    });
  });
  return { client, channel, messages, status, diagnostic };
}

async function main() {
  const db = new Client(hosted ? hosted.pgConfig : {
    host: "127.0.0.1",
    port: 55432,
    user: "supabase_admin",
    password: pgPassword,
    database: "postgres",
    connectionTimeoutMillis: 5000,
  });
  await db.connect();

  const clients = [];
  const policyPrefix = `cine018_qual_${crypto.randomBytes(8).toString("hex")}`;
  let selectPolicyCreated = false, insertPolicyCreated = false;
  const createdRooms = [];
  const roomA = crypto.randomUUID();
  const roomB = crypto.randomUUID();
  const alice = crypto.randomUUID();
  const alicePeer = crypto.randomUUID();
  const bob = crypto.randomUUID();
  const outsider = crypto.randomUUID();
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const randomCode = () => Array.from({ length: 6 }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
  const codeA = randomCode();
  const codeB = randomCode();

  try {
    // 1. Verify private-only tenant + gateway 403 hardening
    if (hosted) await assertEmptyHostedApplication(db);
    if (!hosted) {
    const tenantRes = await db.query("SELECT private_only FROM _realtime.tenants WHERE external_id = 'realtime-dev'");
    assert.equal(tenantRes.rows.length, 1);
    assert.equal(tenantRes.rows[0].private_only, true, "Realtime tenant must be private_only=true");

    const tenantsRes = await fetch("http://127.0.0.1:54321/realtime/v1/api/tenants");
    assert.equal(tenantsRes.status, 403, "Nginx gateway must block /realtime/v1/api/tenants");
    const openapiRes = await fetch("http://127.0.0.1:54321/realtime/v1/api/openapi");
    assert.equal(openapiRes.status, 403, "Nginx gateway must block /realtime/v1/api/openapi");
    }

    // Seed two synthetic rooms
    await db.query("INSERT INTO public.rooms (id, code) VALUES ($1, $2), ($3, $4)", [roomA, codeA, roomB, codeB]);
    createdRooms.push(roomA, roomB);
    await db.query(
      `INSERT INTO public.room_participants (room_id, participant_id, display_name, role)
       VALUES ($1, $2, 'Alice Host', 'HOST'),
              ($1, $3, 'Alice Peer', 'MEMBER'),
              ($4, $5, 'Bob Host', 'HOST')`,
      [roomA, alice, alicePeer, roomB, bob]
    );
    await db.query("UPDATE public.rooms SET host_participant_id = $2 WHERE id = $1", [roomA, alice]);
    await db.query("UPDATE public.rooms SET host_participant_id = $2 WHERE id = $1", [roomB, bob]);

    // 2. Authorized private channel subscribe (Room A & Room B)
    const aliceSub = await subscribeChannel(clients, signJwt({ room: roomA, participant: alice }), `room:${roomA}`);
    assert.equal(aliceSub.status, "SUBSCRIBED", `Authorized member must subscribe to private room:<uuid>: ${aliceSub.diagnostic}`);

    const bobSub = await subscribeChannel(clients, signJwt({ room: roomB, participant: bob }), `room:${roomB}`);
    const anonymousAttempt = await subscribeChannel(clients, null, `room:${roomA}`);
    assert.notEqual(anonymousAttempt.status, "SUBSCRIBED", "Anonymous private subscription must be denied");
    assert.equal(bobSub.status, "SUBSCRIBED", "Authorized Room B member must subscribe to private room:<uuid>");

    // 3. Public channel join rejected
    const publicAttempt = await subscribeChannel(
      clients,
      signJwt({ room: roomA, participant: alice }),
      `room:${roomA}`,
      { privateChannel: false }
    );
    assert.notEqual(publicAttempt.status, "SUBSCRIBED", "Public channel subscription must be rejected");

    // 4. Cross-room denial (Room A token -> Room B topic)
    const crossRoom = await subscribeChannel(clients, signJwt({ room: roomA, participant: alice }), `room:${roomB}`);
    assert.notEqual(crossRoom.status, "SUBSCRIBED", "Cross-room subscription must be rejected");

    // 5. Room-code topic denial (L-028: only room:<uuid> is valid, never room:<code>)
    const roomCodeTopic = await subscribeChannel(clients, signJwt({ room: roomA, participant: alice }), `room:${codeA}`);
    assert.notEqual(roomCodeTopic.status, "SUBSCRIBED", "room:<code> topic must be rejected by RLS");

    // 6. Expired JWT, wrong signature, missing room_id, non-member sub
    const expiredAttempt = await subscribeChannel(
      clients,
      signJwt({ room: roomA, participant: alice, ttlSeconds: -30 }),
      `room:${roomA}`
    );
    assert.notEqual(expiredAttempt.status, "SUBSCRIBED", "Expired JWT must be rejected");

    const badSigAttempt = await subscribeChannel(
      clients,
      signJwt({ room: roomA, participant: alice, secret: "wrong-signing-secret-0000000000000000" }),
      `room:${roomA}`
    );
    assert.notEqual(badSigAttempt.status, "SUBSCRIBED", "Bad JWT signature must be rejected");

    const noRoomClaimAttempt = await subscribeChannel(
      clients,
      signJwt({ room: roomA, participant: alice, includeRoomId: false }),
      `room:${roomA}`
    );
    assert.notEqual(noRoomClaimAttempt.status, "SUBSCRIBED", "JWT missing room_id must be rejected");

    const outsiderAttempt = await subscribeChannel(
      clients,
      signJwt({ room: roomA, participant: outsider }),
      `room:${roomA}`
    );
    assert.notEqual(outsiderAttempt.status, "SUBSCRIBED", "Non-member participant UUID must be rejected");

    // 7. Competing permissive SELECT & INSERT policies on realtime.messages cannot bypass AS RESTRICTIVE fences (L-033)
    await db.query(`CREATE POLICY "${policyPrefix}_select" ON realtime.messages FOR SELECT TO authenticated USING (true)`);
    selectPolicyCreated = true;
    await db.query(`CREATE POLICY "${policyPrefix}_insert" ON realtime.messages FOR INSERT TO authenticated WITH CHECK (true)`);
    insertPolicyCreated = true;

    const crossCompeting = await subscribeChannel(clients, signJwt({ room: roomA, participant: alice }), `room:${roomB}`);
    assert.notEqual(crossCompeting.status, "SUBSCRIBED", "AS RESTRICTIVE select fence must hold under competing permissive SELECT");

    // A fresh channel forces authorization evaluation AFTER competing policies exist.
    const competingAlice = await subscribeChannel(clients, signJwt({ room: roomA, participant: alice }), `room:${roomA}`);
    assert.equal(competingAlice.status, "SUBSCRIBED");
    const forgedResult = await competingAlice.channel.send({
      type: "broadcast",
      event: "room_changed",
      payload: { roomId: roomA, version: 999 },
    });
    assert.notEqual(forgedResult, "ok", "Client-forged broadcast must be denied under competing permissive INSERT");

    // 8. Server-only REST broadcast delivers ONLY to authorized Room A private WebSocket
    const broadcastRes = await fetch(
      `${supabaseUrl}/realtime/v1/api/broadcast/${encodeURIComponent(`room:${roomA}`)}/events/room_changed?private=true`,
      {
        method: "POST",
        headers: { "content-type": "application/json", apikey: serviceKey },
        body: JSON.stringify({ roomId: roomA, version: 42 }),
      }
    );
    assert.equal(broadcastRes.ok, true, `Server REST broadcast expected 2xx, got ${broadcastRes.status}`);

    await new Promise((resolve) => setTimeout(resolve, 1000));
    assert.equal(aliceSub.messages.some((m) => m.version === 42 && m.roomId === roomA), true, "Alice must receive server hint");
    assert.equal(aliceSub.messages.some((m) => m.version === 999), false, "Forged hint must never reach Alice");
    assert.equal(bobSub.messages.length, 0, "Bob in Room B must receive zero Room A broadcasts");

    // 9. Direct Postgres RLS & non-enumeration verification (L-034, L-035)
    async function expectDeniedAsRole(role, sql, message) {
      await db.query("BEGIN");
      try {
        await db.query(`SET LOCAL ROLE ${role}`);
        if (role === "authenticated") {
          await db.query("SELECT set_config('request.jwt.claims', $1, true)", [
            JSON.stringify({ sub: alice, room_id: roomA, role: "authenticated", aud: "authenticated" }),
          ]);
        }
        await assert.rejects(() => db.query(sql), /permission denied/i, message);
      } finally {
        await db.query("ROLLBACK");
      }
    }

    await db.query("BEGIN");
    try {
      await db.query("SET LOCAL ROLE authenticated");
      await db.query("SELECT set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: alice, room_id: roomA, role: "authenticated", aud: "authenticated" }),
      ]);

      const visibleRooms = await db.query("SELECT id::text FROM public.rooms");
      assert.deepEqual(visibleRooms.rows.map((r) => r.id), [roomA], "Authenticated member must only see own room");

      const visibleParticipants = await db.query("SELECT participant_id::text FROM public.room_participants");
      assert.deepEqual(
        visibleParticipants.rows.map((r) => r.participant_id),
        [alice],
        "participants_self_read_policy must prevent enumerating other room participants"
      );

      const crossCheck = await db.query("SELECT public.is_current_user_room_participant($1) AS ok", [roomB]);
      assert.equal(crossCheck.rows[0].ok, false, "Helper must return false for non-member room");
    } finally {
      await db.query("ROLLBACK");
    }

    await expectDeniedAsRole("authenticated", "SELECT * FROM public.votes", "authenticated role must be denied SELECT on votes");
    await expectDeniedAsRole("authenticated", "SELECT * FROM public.room_events", "authenticated role must be denied SELECT on room_events");
    await expectDeniedAsRole("anon", "SELECT * FROM public.rooms", "anon role must be denied SELECT on rooms");
    await expectDeniedAsRole("anon", "SELECT * FROM public.room_participants", "anon role must be denied SELECT on room_participants");
    await expectDeniedAsRole("anon", `SELECT public.is_current_user_room_participant('${roomA}')`, "anon helper RPC must be denied despite hosted default EXECUTE grants");

    // 10. Direct Postgres RLS check on realtime.messages for anon & authenticated under competing permissive policies
    await db.query("BEGIN");
    try {
      await db.query("SELECT set_config('realtime.topic', $1, true)", [`room:${roomA}`]);
      await db.query(
        "INSERT INTO realtime.messages (topic, extension, payload, private) VALUES ($1, 'broadcast', '{\"version\":1}'::jsonb, true)",
        [`room:${roomA}`]
      );
      await db.query("SET LOCAL ROLE anon");
      const anonMsgRes = await db.query("SELECT count(*)::int AS cnt FROM realtime.messages WHERE topic = $1", [`room:${roomA}`]);
      assert.equal(anonMsgRes.rows[0].cnt, 0, "anon role must see 0 rows in realtime.messages for room:* topics");
      await assert.rejects(
        () => db.query("INSERT INTO realtime.messages (topic, extension, payload, private) VALUES ($1, 'broadcast', '{}'::jsonb, true)", [`room:${roomA}`]),
        /row-level security/i,
        "anon INSERT into realtime.messages for room:* must be blocked by RLS"
      );
    } finally {
      await db.query("ROLLBACK");
    }

    await db.query("BEGIN");
    try {
      await db.query("SET LOCAL ROLE authenticated");
      await db.query("SELECT set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: alice, room_id: roomA, role: "authenticated", aud: "authenticated" }),
      ]);
      await assert.rejects(
        () => db.query("INSERT INTO realtime.messages (topic, extension, payload, private) VALUES ($1, 'broadcast', '{}'::jsonb, true)", [`room:${roomA}`]),
        /row-level security/i,
        "authenticated direct INSERT into realtime.messages for room:* must be blocked by AS RESTRICTIVE fence"
      );
    } finally {
      await db.query("ROLLBACK");
    }

    console.log(
      JSON.stringify({
        ok: true,
        environment: hosted ? `hosted:${hosted.project}` : "local Docker",
        checks: [
          ...(hosted ? ["private_only_config_dashboard_plus_public_channel_negative"] : ["private_only_tenant", "gateway_403_tenants_and_openapi"]),
          "private_ws_subscribe",
          "anonymous_private_subscription_denied",
          "public_channel_denied",
          "cross_room_denied",
          "room_code_topic_denied",
          "expired_bad_sig_missing_claim_outsider_denied",
          "competing_permissive_select_and_insert_fenced",
          "server_rest_broadcast_to_private_ws",
          "pg_rls_self_only_and_anon_denied",
        ],
      })
    );
  } finally {
    await Promise.allSettled(clients.map((client) => client.removeAllChannels()));
    await Promise.allSettled(
      clients.map((client) => Promise.race([client.realtime.disconnect(), new Promise((r) => setTimeout(r, 250))]))
    );
    if (selectPolicyCreated) await db.query(`DROP POLICY "${policyPrefix}_select" ON realtime.messages`);
    if (insertPolicyCreated) await db.query(`DROP POLICY "${policyPrefix}_insert" ON realtime.messages`);
    await db.query("UPDATE public.rooms SET status = 'EXPIRED', expires_at = NOW() - INTERVAL '1 second' WHERE id = ANY($1::uuid[])", [createdRooms]);
    await db.query("DELETE FROM public.rooms WHERE id = ANY($1::uuid[])", [createdRooms]);
    const leftover = await db.query("SELECT count(*)::int AS cnt FROM public.rooms WHERE id IN ($1, $2)", [roomA, roomB]);
    assert.equal(leftover.rows[0].cnt, 0, "Teardown must remove temporary qualification rooms");
    await db.end();
  }
}

main()
  .catch((error) => {
    console.error("Local WS/RLS qualification failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    process.exit(process.exitCode ?? 0);
  });
