// tests/live/supabase-worker.ts
// Independent Node.js child process for CINE-012 PostgreSQL concurrency testing.
// Connects with its own separate PostgreSQL client using strict TLS verification,
// and invokes production PostgresRoomRepository with row-level SELECT ... FOR UPDATE transactions.

import { Client } from "pg";
import fs from "node:fs";
import path from "node:path";
import { PostgresRoomRepository } from "../../src/lib/server/room/postgresRoomRepository";
import type { VoteType } from "../../src/db/schema";

async function main() {
  const host = process.env.SUPABASE_PG_HOST;
  const port = parseInt(process.env.SUPABASE_PG_PORT || "5432", 10);
  const database = process.env.SUPABASE_PG_DATABASE || "postgres";
  const user = process.env.SUPABASE_PG_USER;
  const password = process.env.SUPABASE_PG_PASSWORD;
  const schema = process.env.SUPABASE_PG_SCHEMA || "cinematch_qualification";

  if (!password || !host || !user) {
    throw new Error("SUPABASE_PG_HOST, SUPABASE_PG_USER, and SUPABASE_PG_PASSWORD are required");
  }

  const caPath = path.join(process.cwd(), "src", "db", "supabase-root-ca.crt");
  const ca = fs.existsSync(caPath) ? fs.readFileSync(caPath, "utf8") : undefined;

  const client = new Client({
    host,
    port,
    database,
    user,
    password,
    ssl: {
      rejectUnauthorized: true,
      ca,
      servername: host,
    },
    connectionTimeoutMillis: 10000,
  });

  await client.connect();

  const repo = new PostgresRoomRepository(client, { schema });

  if (process.send) {
    process.send({ type: "READY", pid: process.pid });
  }

  interface VoteMessage {
    command?: string;
    roomId: string;
    roundId: string;
    participantId: string;
    candidateId: string;
    movieId: number;
    voteType?: string;
    terminateAfter?: boolean;
  }

  process.on("message", async (msg: unknown) => {
    const voteMsg = msg as VoteMessage | null;
    if (!voteMsg || voteMsg.command !== "VOTE") return;

    const { roomId, roundId, participantId, candidateId, movieId, voteType = "LIKE" } = voteMsg;
    const start = performance.now();
    let isMatched = false;
    let transition: string | null = null;
    let error: string | null = null;
    let errorName: string | null = null;

    try {
      const res = await repo.recordVote(
        roomId,
        roundId,
        participantId,
        candidateId,
        movieId,
        voteType as VoteType
      );
      isMatched = res.isMatched;
      transition = res.isMatched ? "MATCHED" : "VOTE_RECORDED";
    } catch (err: unknown) {
      const typedErr = err as { message?: string; name?: string };
      error = typedErr.message || String(err);
      errorName = typedErr.name || "Error";
    }

    const durationMs = performance.now() - start;

    if (process.send) {
      process.send({
        type: "RESULT",
        pid: process.pid,
        participantId,
        transition,
        isMatched,
        durationMs,
        error,
        errorName,
      });
    }

    if (voteMsg.terminateAfter) {
      await client.end();
      process.exit(0);
    }
  });

  process.on("SIGTERM", async () => {
    try {
      await client.end();
    } catch {}
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Worker fatal error:", err);
  process.exit(1);
});
