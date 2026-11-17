/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";
// Synthetic-only idempotent seed for the loopback-verified local Compose database.
const { Client } = require("pg");
const { assertLocalStack } = require("./runtime.cjs");
const { assertNoCloudTargetEnv } = require("./safety.cjs");
const { parseEnvFile, STACK_ENV_PATH } = require("./generate-env.cjs");

const SYNTHETIC_IDS = {
  lobbyRoomId: "00000000-0000-4000-8000-000000005201",
  lobbyCode: "GH52A2",
  lobbyHostId: "00000000-0000-4000-8000-000000005211",
  lobbyGuestId: "00000000-0000-4000-8000-000000005212",
  activeRoomId: "00000000-0000-4000-8000-000000005202",
  activeCode: "GH52B3",
  activeHostId: "00000000-0000-4000-8000-000000005221",
  activeGuestId: "00000000-0000-4000-8000-000000005222",
  activeRoundId: "00000000-0000-4000-8000-000000005231",
};

function createLocalPgClient() {
  assertNoCloudTargetEnv();
  assertLocalStack();
  const env = parseEnvFile(STACK_ENV_PATH);
  if (!env.POSTGRES_PASSWORD) throw new Error("Local POSTGRES_PASSWORD missing in supabase/.env.local");
  return new Client({
    host: "127.0.0.1",
    port: 55432,
    user: "supabase_admin",
    password: env.POSTGRES_PASSWORD,
    database: "postgres",
    connectionTimeoutMillis: 5000,
  });
}

async function seedSyntheticData() {
  const client = createLocalPgClient();
  await client.connect();
  try {
    await client.query("BEGIN");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    // Room 1: LOBBY state (2 synthetic participants)
    await client.query(
      `INSERT INTO public.rooms (id, code, status, participant_count, state_version, expires_at)
       VALUES ($1, $2, 'LOBBY', 2, 1, $3)
       ON CONFLICT (id) DO NOTHING`,
      [SYNTHETIC_IDS.lobbyRoomId, SYNTHETIC_IDS.lobbyCode, expiresAt]
    );
    await client.query(
      `INSERT INTO public.room_participants (room_id, participant_id, display_name, role)
       VALUES ($1, $2, 'Synth Host A', 'HOST'), ($1, $3, 'Synth Guest A', 'MEMBER')
       ON CONFLICT (room_id, participant_id) DO NOTHING`,
      [SYNTHETIC_IDS.lobbyRoomId, SYNTHETIC_IDS.lobbyHostId, SYNTHETIC_IDS.lobbyGuestId]
    );
    await client.query(
      `UPDATE public.rooms SET host_participant_id = $2 WHERE id = $1 AND host_participant_id IS NULL`,
      [SYNTHETIC_IDS.lobbyRoomId, SYNTHETIC_IDS.lobbyHostId]
    );
    await client.query(
      `INSERT INTO public.guest_capability_sessions (room_id, participant_id, min_generation, expires_at)
       VALUES ($1, $2, 1, $4), ($1, $3, 1, $4)
       ON CONFLICT (room_id, participant_id) DO NOTHING`,
      [SYNTHETIC_IDS.lobbyRoomId, SYNTHETIC_IDS.lobbyHostId, SYNTHETIC_IDS.lobbyGuestId, expiresAt]
    );
    await client.query(
      `INSERT INTO public.room_events (room_id, version, event_type, payload, dispatched, dispatched_at)
       VALUES ($1, 1, 'ROOM_SEEDED', '{"synthetic":true}'::jsonb, true, NOW())
       ON CONFLICT (room_id, version) DO NOTHING`,
      [SYNTHETIC_IDS.lobbyRoomId]
    );

    // Room 2: ACTIVE state with frozen roster and 20 synthetic movie candidates
    await client.query(
      `INSERT INTO public.rooms (id, code, status, participant_count, state_version, expires_at)
       VALUES ($1, $2, 'ACTIVE', 2, 1, $3)
       ON CONFLICT (id) DO NOTHING`,
      [SYNTHETIC_IDS.activeRoomId, SYNTHETIC_IDS.activeCode, expiresAt]
    );
    await client.query(
      `INSERT INTO public.room_participants (room_id, participant_id, display_name, role)
       VALUES ($1, $2, 'Synth Host B', 'HOST'), ($1, $3, 'Synth Guest B', 'MEMBER')
       ON CONFLICT (room_id, participant_id) DO NOTHING`,
      [SYNTHETIC_IDS.activeRoomId, SYNTHETIC_IDS.activeHostId, SYNTHETIC_IDS.activeGuestId]
    );
    await client.query(
      `INSERT INTO public.rounds (id, room_id, round_number, status)
       VALUES ($1, $2, 1, 'ACTIVE')
       ON CONFLICT (id) DO NOTHING`,
      [SYNTHETIC_IDS.activeRoundId, SYNTHETIC_IDS.activeRoomId]
    );
    await client.query(
      `UPDATE public.rooms
       SET host_participant_id = COALESCE(host_participant_id, $2),
           current_round_id = COALESCE(current_round_id, $3)
       WHERE id = $1`,
      [SYNTHETIC_IDS.activeRoomId, SYNTHETIC_IDS.activeHostId, SYNTHETIC_IDS.activeRoundId]
    );
    await client.query(
      `INSERT INTO public.round_participants (room_id, round_id, participant_id, frozen_role, joined_at)
       VALUES ($1, $2, $3, 'HOST', NOW()), ($1, $2, $4, 'MEMBER', NOW())
       ON CONFLICT (round_id, participant_id) DO NOTHING`,
      [SYNTHETIC_IDS.activeRoomId, SYNTHETIC_IDS.activeRoundId, SYNTHETIC_IDS.activeHostId, SYNTHETIC_IDS.activeGuestId]
    );
    await client.query(
      `INSERT INTO public.guest_capability_sessions (room_id, participant_id, min_generation, expires_at)
       VALUES ($1, $2, 1, $4), ($1, $3, 1, $4)
       ON CONFLICT (room_id, participant_id) DO NOTHING`,
      [SYNTHETIC_IDS.activeRoomId, SYNTHETIC_IDS.activeHostId, SYNTHETIC_IDS.activeGuestId, expiresAt]
    );

    for (let pos = 0; pos < 20; pos++) {
      const movieId = 900001 + pos;
      await client.query(
        `INSERT INTO public.candidates (room_id, round_id, movie_id, position, title, poster_path, overview, release_date, vote_average)
         VALUES ($1, $2, $3, $4, $5, '/synthetic.jpg', 'Synthetic local development title', '2026-01-01', 7.5)
         ON CONFLICT (round_id, position) DO NOTHING`,
        [SYNTHETIC_IDS.activeRoomId, SYNTHETIC_IDS.activeRoundId, movieId, pos, `Synthetic Film ${pos + 1}`]
      );
    }

    await client.query(
      `INSERT INTO public.room_events (room_id, version, event_type, payload, dispatched, dispatched_at)
       VALUES ($1, 1, 'ROUND_SEEDED', '{"synthetic":true}'::jsonb, true, NOW())
       ON CONFLICT (room_id, version) DO NOTHING`,
      [SYNTHETIC_IDS.activeRoomId]
    );

    await client.query("COMMIT");
    return await inspectSyntheticSeed(client);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

async function inspectSyntheticSeed(existingClient) {
  const client = existingClient ?? createLocalPgClient();
  if (!existingClient) await client.connect();
  try {
    const rooms = await client.query(
      `SELECT id::text, code, status::text, participant_count
       FROM public.rooms
       WHERE id IN ($1, $2)
       ORDER BY code ASC`,
      [SYNTHETIC_IDS.lobbyRoomId, SYNTHETIC_IDS.activeRoomId]
    );
    const cands = await client.query(
      `SELECT count(*)::int AS count FROM public.candidates WHERE round_id = $1`,
      [SYNTHETIC_IDS.activeRoundId]
    );
    return { rooms: rooms.rows, activeRoundCandidates: cands.rows[0].count };
  } finally {
    if (!existingClient) await client.end();
  }
}

if (require.main === module) {
  const checkOnly = process.argv.includes("--check");
  const action = checkOnly ? inspectSyntheticSeed() : seedSyntheticData();
  action
    .then((summary) => {
      if (checkOnly && (summary.rooms.length !== 2 || summary.activeRoundCandidates !== 20)) {
        console.error("Synthetic seed check failed:", JSON.stringify(summary));
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify({ ok: true, synthetic: true, ...summary }));
    })
    .catch((error) => {
      console.error("Synthetic seed error:", error.message);
      process.exitCode = 1;
    });
}

module.exports = { SYNTHETIC_IDS, seedSyntheticData, inspectSyntheticSeed };
