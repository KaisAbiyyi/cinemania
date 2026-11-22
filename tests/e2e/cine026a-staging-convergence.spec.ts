import { expect, test } from "@playwright/test";
import { db, assertStagingReady, cleanupStaging, makeRoom, startVoting, vote, closeAll } from "./helpers/cine026a-staging";

/**
 * CINE-026-A diagnostic — Chromium snapshot convergence.
 *
 * Runs the same "partial SKIP" scenario as cine026-staging.spec.ts but records, per client and with
 * wall-clock timestamps, every layer of the authoritative path:
 *   vote response (stateVersion) -> private WebSocket room_changed hint (version)
 *   -> snapshot GET (stateVersion) -> rendered "Card NN / 20" text.
 * It never records tokens, cookies, room ids, room codes or participant names; clients are labelled c0..c2.
 * A client that has not converged within STALE_AFTER_MS gets a forced resync (focus wake-up) so the failing
 * layer can be told apart: a forced resync that heals proves a lost/late notification, one that does not
 * proves a stale snapshot or a render/reducer defect.
 *
 * CINE026A_MODE=burst adds a concurrent 5-member room (pool / advisory-lock contention);
 * CINE026A_FIDELITY=1 reproduces the production spec's video recording and blur redaction.
 * Staging only; same project guard and ownership-checked cleanup as cine026-staging.spec.ts.
 */
const ITERATIONS = Number(process.env.CINE026A_ITERATIONS ?? "3");
const STALE_AFTER_MS = 6000;
const MODE = process.env.CINE026A_MODE ?? "isolated";
const MATRIX_FIDELITY = process.env.CINE026A_FIDELITY === "1";

test.describe("CINE-026-A hosted convergence diagnostic", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(240000);
  test.beforeAll(assertStagingReady);
  test.afterAll(cleanupStaging);

  for (let iteration = 1; iteration <= ITERATIONS; iteration += 1) {
    test(`partial SKIP convergence trace #${iteration}`, async ({ browser }, testInfo) => {
      const { clients, roomId } = await makeRoom(browser, 3);
      const burst = MODE === "burst" ? await makeRoom(browser, 5) : null;
      let burstVotes: Promise<unknown> | null = null;
      try {
        await startVoting(clients);
        if (burst) await startVoting(burst.clients);
        const marks: Record<string, number> = {};
        burstVotes = burst ? Promise.all(burst.clients.map((client) => vote(client, burst.roomId, "LIKE"))) : null;
        const voteResults = await Promise.all(clients.slice(0, 2).map((client) => vote(client, roomId, "LIKE")));
        marks.firstTwoDone = Date.now();
        void burstVotes?.catch(() => undefined);
        expect(voteResults.every((r) => r.isMatched === false && r.room.status === "ACTIVE")).toBe(true);
        marks.finalVoteClick = Date.now();
        const last = await vote(clients[2]!, roomId, "SKIP");
        marks.finalVoteResponse = Date.now();
        expect(last.room.currentCandidateIndex).toBe(1);
        const finalVersion = last.room.stateVersion;

        // Per-client convergence time (no assertion timeouts involved: we measure, then assert on facts).
        const converged = await Promise.all(clients.map(async (client) => {
          const deadline = marks.finalVoteResponse! + 25000;
          let forcedAt: number | null = null;
          while (Date.now() < deadline) {
            const text = await client.page.getByTestId("cine024-progress").textContent();
            if (text?.trim() === "Card 02 / 20") return { label: client.label, convergedAt: Date.now(), forcedAt };
            if (forcedAt === null && Date.now() - marks.finalVoteResponse! > STALE_AFTER_MS) {
              forcedAt = Date.now();
              // Forced resync probe: the same wake path the browser uses on focus / visibility.
              await client.page.evaluate(() => window.dispatchEvent(new Event("focus")));
              client.events.push({ t: forcedAt, kind: "forced-resync", detail: {} });
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          return { label: client.label, convergedAt: null, forcedAt };
        }));

        const domProgress: Array<Array<{ t: number; text: string }>> = await Promise.all(clients.map((c) => c.page.evaluate((): Array<{ t: number; text: string }> => (window as unknown as { __cm?: { progress: Array<{ t: number; text: string }> } }).__cm?.progress ?? [])));
        const outbox = await db.query(
          `SELECT version, event_type, dispatched, retry_count,
                  (EXTRACT(EPOCH FROM created_at) * 1000)::bigint AS created_ms,
                  (EXTRACT(EPOCH FROM dispatched_at) * 1000)::bigint AS dispatched_ms
             FROM public.room_events WHERE room_id = $1 ORDER BY version`,
          [roomId]
        );
        const dbNow = await db.query("SELECT (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint AS ms");
        const dbClockOffsetMs = Number(dbNow.rows[0].ms) - Date.now();

        const summary = {
          iteration,
          finalVersion,
          finalVoteResponseToClickMs: marks.finalVoteResponse! - marks.finalVoteClick!,
          clients: clients.map((client, index) => {
            const hints = client.events.filter((e) => e.kind === "ws-hint");
            const gets = client.events.filter((e) => e.kind === "snapshot-get");
            const firstHintAtFinal = hints.find((e) => Number(e.detail.version) >= finalVersion);
            const firstGetAtFinal = gets.find((e) => Number(e.detail.version) >= finalVersion);
            const firstRender = domProgress[index]!.find((p, i, all) => p.text.includes("02") && (i === 0 || all[i - 1]!.text !== p.text));
            const rel = (t: number | undefined) => (t === undefined ? null : t - marks.finalVoteResponse!);
            return {
              label: client.label,
              convergedAfterFinalResponseMs: converged[index]!.convergedAt === null ? null : converged[index]!.convergedAt! - marks.finalVoteResponse!,
              forcedResyncAfterMs: converged[index]!.forcedAt === null ? null : converged[index]!.forcedAt! - marks.finalVoteResponse!,
              hintForFinalVersionAfterMs: rel(firstHintAtFinal?.t),
              snapshotGetAtFinalVersionAfterMs: rel(firstGetAtFinal?.t),
              firstRenderOfCard02AfterMs: rel(firstRender?.t),
              hintVersionsSeen: hints.map((e) => e.detail.version),
              snapshotVersionsSeen: gets.map((e) => e.detail.version),
              wsConnections: client.events.filter((e) => e.kind === "ws-open").length,
              wsCloses: client.events.filter((e) => e.kind === "ws-close").length,
            };
          }),
          outbox: outbox.rows.map((row) => ({
            version: row.version, type: row.event_type, dispatched: row.dispatched, retries: row.retry_count,
            dispatchedAfterFinalResponseMs: row.dispatched_ms === null ? null : Number(row.dispatched_ms) - dbClockOffsetMs - marks.finalVoteResponse!,
            createdAfterFinalResponseMs: Number(row.created_ms) - dbClockOffsetMs - marks.finalVoteResponse!,
          })),
          dbClockOffsetMs,
          mode: MODE,
          fidelity: MATRIX_FIDELITY,
        };
        await testInfo.attach("convergence-trace.json", { body: JSON.stringify(summary, null, 2), contentType: "application/json" });
        console.log("CINE026A_TRACE " + JSON.stringify(summary));
        // Facts only: the authoritative server state advanced, and every client eventually showed it.
        expect(converged.map((c) => c.convergedAt !== null), JSON.stringify(summary)).toEqual([true, true, true]);
      } finally {
        await burstVotes?.catch(() => undefined);
        await closeAll([...clients, ...(burst?.clients ?? [])]);
      }
    });
  }
});
