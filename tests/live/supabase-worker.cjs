/* eslint-disable @typescript-eslint/no-require-imports */
// tests/live/supabase-worker.cjs
// Independent Node.js child process for CINE-012 PostgreSQL concurrency testing.
// Connects with its own separate PostgreSQL client and executes transactional transitions with SELECT ... FOR UPDATE.

const { Client } = require('pg');
const crypto = require('node:crypto');

async function main() {
  const host = process.env.SUPABASE_PG_HOST || 'aws-0-ap-northeast-2.pooler.supabase.com';
  const port = parseInt(process.env.SUPABASE_PG_PORT || '5432', 10);
  const database = process.env.SUPABASE_PG_DATABASE || 'postgres';
  const user = process.env.SUPABASE_PG_USER || 'cinematch_runner.dmrbticnsczhyaiftrar';
  const password = process.env.SUPABASE_PG_PASSWORD;
  if (!password) {
    throw new Error('SUPABASE_PG_PASSWORD environment variable is required');
  }

  const client = new Client({
    host,
    port,
    database,
    user,
    password,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });

  await client.connect();

  if (process.send) {
    process.send({ type: 'READY', pid: process.pid });
  }

  process.on('message', async (msg) => {
    if (!msg || msg.command !== 'VOTE') return;

    const { roomId, roundId, participantId, candidateId, movieId } = msg;
    const start = performance.now();
    let transition = 'VOTE_RECORDED';
    let error = null;

    try {
      await client.query('BEGIN');

      // 1. Lock room row with SELECT ... FOR UPDATE
      const roomRes = await client.query(
        'SELECT id, status, participant_count, state_version FROM rooms WHERE id = $1 FOR UPDATE',
        [roomId]
      );

      if (roomRes.rows.length === 0) {
        throw new Error(`Room ${roomId} not found during lock acquisition`);
      }
      const room = roomRes.rows[0];

      // 2. Insert vote with idempotency
      const voteId = crypto.randomUUID();
      const nowIso = new Date().toISOString();
      await client.query(
        `INSERT INTO votes (id, room_id, round_id, participant_id, candidate_id, movie_id, vote, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'LIKE', $7)
         ON CONFLICT (round_id, participant_id, candidate_id) DO NOTHING`,
        [voteId, roomId, roundId, participantId, candidateId, movieId, nowIso]
      );

      // 3. Count LIKE votes for this candidate in this round
      const countRes = await client.query(
        `SELECT COUNT(*)::int as count FROM votes WHERE round_id = $1 AND candidate_id = $2 AND vote = 'LIKE'`,
        [roundId, candidateId]
      );
      const likeCount = countRes.rows[0].count;

      const nextVersion = room.state_version + 1;

      // 4. Determine state transition
      if (likeCount >= room.participant_count && room.status !== 'MATCHED') {
        transition = 'MATCHED';
        await client.query(
          `UPDATE rooms
           SET status = 'MATCHED',
               matched_movie_id = $1,
               state_version = $2,
               last_activity_at = $3,
               updated_at = $3
           WHERE id = $4 AND status = 'ACTIVE'`,
          [movieId, nextVersion, nowIso, roomId]
        );

        await client.query(
          `INSERT INTO room_events (room_id, version, event_type, payload)
           VALUES ($1, $2, 'MATCH_ANNOUNCED', $3)`,
          [
            roomId,
            nextVersion,
            JSON.stringify({ movieId, unanimousCount: room.participant_count }),
          ]
        );
      } else {
        transition = 'VOTE_RECORDED';
        await client.query(
          `UPDATE rooms
           SET state_version = $1,
               last_activity_at = $2,
               updated_at = $2
           WHERE id = $3`,
          [nextVersion, nowIso, roomId]
        );

        await client.query(
          `INSERT INTO room_events (room_id, version, event_type, payload)
           VALUES ($1, $2, 'VOTE_RECORDED', $3)`,
          [roomId, nextVersion, JSON.stringify({ participantId, movieId })]
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {}
      error = err.message;
    }

    const durationMs = performance.now() - start;

    if (process.send) {
      process.send({
        type: 'RESULT',
        pid: process.pid,
        participantId,
        transition: error ? null : transition,
        durationMs,
        error,
      });
    }

    // Keep client alive until explicitly closed or exit
    if (msg.terminateAfter) {
      await client.end();
      process.exit(0);
    }
  });

  process.on('SIGTERM', async () => {
    try {
      await client.end();
    } catch {}
    process.exit(0);
  });
}

main().catch((err) => {
  if (process.send) {
    process.send({ type: 'FATAL_ERROR', error: err.message });
  }
  process.exit(1);
});
