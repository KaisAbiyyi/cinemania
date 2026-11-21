import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";

// Playwright transforms test files through CommonJS in this repository.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { loadHostedStaging, assertEmptyHostedApplication } = require("../hosted-supabase/environment.cjs") as {
  loadHostedStaging: () => { project: string; pgConfig: Record<string, unknown> };
  assertEmptyHostedApplication: (db: Pool) => Promise<void>;
};

const staging = loadHostedStaging();
const ORIGIN = "http://127.0.0.1:3065";
const RUN = "C026-" + randomUUID().slice(0, 8);
const createdRoomIds = new Set<string>();
const db = new Pool({ ...staging.pgConfig, max: 1, connectionTimeoutMillis: 10000, statement_timeout: 10000 });

type RoomRun = {
  contexts: BrowserContext[];
  pages: Page[];
  roomId: string;
  code: string;
  hostName: string;
  participantIds: string[];
};

test.describe("CINE-026 — hosted staging Supabase / WebSocket qualification", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180000);

  test.beforeAll(async () => {
    expect(staging.project).toBe("dmrbticnsczhyaiftrar");
    // Only proceed against the explicitly configured staging project when its application table is empty.
    await assertEmptyHostedApplication(db);
  });

  test.afterAll(async () => {
    try {
      const ids = [...createdRoomIds];
      if (ids.length === 0) return;
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const ownership = await client.query(
          `SELECT r.id
             FROM public.rooms r
            WHERE r.id = ANY($1::uuid[])
              AND r.created_at >= NOW() - INTERVAL '8 hours'
              AND EXISTS (
                SELECT 1 FROM public.room_participants p
                 WHERE p.room_id = r.id AND p.display_name LIKE $2
              )`,
          [ids, RUN + "-%"]
        );
        if (ownership.rowCount !== ids.length) throw new Error("Staging cleanup refused: a room is not owned by this CINE-026 run.");
        const expired = await client.query(
          `UPDATE public.rooms
              SET status = 'EXPIRED', expires_at = NOW() - INTERVAL '1 second'
            WHERE id = ANY($1::uuid[])
              AND EXISTS (
                SELECT 1 FROM public.room_participants p
                 WHERE p.room_id = public.rooms.id AND p.display_name LIKE $2
              )`,
          [ids, RUN + "-%"]
        );
        if (expired.rowCount !== ids.length) throw new Error("Staging cleanup refused: exact run-owned room expiration count did not match.");
        const deleted = await client.query("DELETE FROM public.rooms WHERE id = ANY($1::uuid[])", [ids]);
        if (deleted.rowCount !== ids.length) throw new Error("Staging cleanup refused: exact room deletion count did not match this run.");
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      createdRoomIds.clear();
    } finally {
      await db.end();
    }
  });

  test("2 independent clients reach one unanimous match through the real UI", async ({ browser }, testInfo) => {
    const room = await makeRoom(browser, testInfo, 2);
    try {
      await startVoting(room);
      const first = await clickVote(room.pages[0]!, room.roomId, "LIKE");
      expect(first.isMatched).toBe(false);
      await expect(room.pages[0]!.getByTestId("cine024-waiting")).toContainText("LIKE vote is locked");
      const last = await clickVote(room.pages[1]!, room.roomId, "LIKE");
      expect(last.isMatched).toBe(true);
      await expectResultForAll(room.pages);
    } finally {
      await closeContexts(room.contexts, testInfo);
    }
  });

  test("5 independent clients submit concurrent LIKE votes; exactly one wins", async ({ browser }, testInfo) => {
    const room = await makeRoom(browser, testInfo, 5);
    try {
      await startVoting(room);
      const results = await Promise.all(room.pages.map((page) => clickVote(page, room.roomId, "LIKE")));
      // The HTTP response can be an idempotent replay if the client retries before the
      // assertion observes it. Prove the single authoritative transition from persisted
      // vote and outbox rows instead of counting transport responses.
      expect(results).toHaveLength(5);
      const authority = await db.query("SELECT status, matched_movie_id FROM public.rooms WHERE id = $1", [room.roomId]);
      expect(authority.rows[0].status).toBe("MATCHED");
      expect(authority.rows[0].matched_movie_id).toBeTruthy();
      const voteRows = await db.query(
        "SELECT count(*)::int AS votes, count(DISTINCT participant_id)::int AS voters FROM public.votes WHERE room_id = $1",
        [room.roomId]
      );
      expect(voteRows.rows[0]).toEqual({ votes: 5, voters: 5 });
      const matchEvents = await db.query(
        "SELECT count(*)::int AS matches FROM public.room_events WHERE room_id = $1 AND event_type = 'MATCH_ANNOUNCED'",
        [room.roomId]
      );
      expect(matchEvents.rows[0].matches).toBe(1);
      await expectResultForAll(room.pages);
    } finally {
      await closeContexts(room.contexts, testInfo);
    }
  });

  test("partial SKIP defeats a two-of-three majority and advances only after the final vote", async ({ browser }, testInfo) => {
    const room = await makeRoom(browser, testInfo, 3);
    try {
      await startVoting(room);
      const firstTwo = await Promise.all(room.pages.slice(0, 2).map((page) => clickVote(page, room.roomId, "LIKE")));
      expect(firstTwo.every((result) => result.isMatched === false && result.room.status === "ACTIVE")).toBe(true);
      const last = await clickVote(room.pages[2]!, room.roomId, "SKIP");
      expect(last.isMatched).toBe(false);
      expect(last.room.status).toBe("ACTIVE");
      expect(last.room.currentCandidateIndex).toBe(1);
      await Promise.all(room.pages.map((page) => expect(page.getByTestId("cine024-progress")).toHaveText("Card 02 / 20")));
    } finally {
      await closeContexts(room.contexts, testInfo);
    }
  });

  test("the sixth browser context is rejected after five independent members join", async ({ browser }, testInfo) => {
    const room = await makeRoom(browser, testInfo, 5);
    try {
      const sixth = await makeContext(browser, testInfo);
      room.contexts.push(sixth);
      const page = await sixth.newPage();
      await page.goto("/join/" + room.code);
      await page.getByLabel("Your display name").fill(RUN + "-sixth");
      await page.getByRole("button", { name: "Join Screening Room" }).click();
      await expect(page.getByTestId("cm-scoped-alert")).toContainText("ROOM_FULL");
      const snapshot = await room.contexts[0]!.request.get(`${ORIGIN}/api/rooms/${room.roomId}`);
      expect(snapshot.status()).toBe(200);
      expect((await snapshot.json()).room.participantCount).toBe(5);
    } finally {
      await closeContexts(room.contexts, testInfo);
    }
  });

  test("refresh retains a recorded vote and does not submit it twice", async ({ browser }, testInfo) => {
    const room = await makeRoom(browser, testInfo, 2);
    try {
      await startVoting(room);
      let recordedRequest: { url: string; body: string; headers: Record<string, string> } | undefined;
      const captureVote = (request: import("@playwright/test").Request) => {
        if (request.method() === "POST" && new URL(request.url()).pathname === `/api/rooms/${room.roomId}/votes`) {
          recordedRequest = { url: request.url(), body: request.postData() ?? "", headers: request.headers() };
        }
      };
      room.pages[0]!.on("request", captureVote);
      const first = await clickVote(room.pages[0]!, room.roomId, "SKIP");
      room.pages[0]!.off("request", captureVote);
      expect(first.isMatched).toBe(false);
      expect(recordedRequest?.body).toBeTruthy();
      const voteBody = JSON.parse(recordedRequest!.body) as { candidateId: string; operationId: string };
      const recorded = await db.query(
        `SELECT count(*)::int AS count FROM public.votes
          WHERE room_id = $1 AND participant_id = $2 AND candidate_id = $3 AND operation_id = $4`,
        [room.roomId, room.participantIds[0], voteBody.candidateId, voteBody.operationId]
      );
      expect(recorded.rows[0]?.count).toBe(1);
      await room.pages[0]!.reload();
      await expectLive(room.pages[0]!);
      await expect(room.pages[0]!.getByTestId("cine024-waiting")).toContainText("SKIP vote is locked");
      await expect(room.pages[0]!.getByTestId("cine024-skip")).toHaveCount(0);
      const replay = await room.contexts[0]!.request.post(recordedRequest!.url, {
        headers: { origin: ORIGIN, "idempotency-key": voteBody.operationId },
        data: JSON.parse(recordedRequest!.body),
      });
      expect(replay.status()).toBe(200);
      expect((await replay.json()).idempotentReplay).toBe(true);
      const afterReplay = await db.query(
        `SELECT count(*)::int AS count FROM public.votes
          WHERE room_id = $1 AND participant_id = $2 AND candidate_id = $3 AND operation_id = $4`,
        [room.roomId, room.participantIds[0], voteBody.candidateId, voteBody.operationId]
      );
      expect(afterReplay.rows[0]?.count).toBe(1);
      const last = await clickVote(room.pages[1]!, room.roomId, "SKIP");
      expect(last.room.currentCandidateIndex).toBe(1);
      await Promise.all(room.pages.map((page) => expect(page.getByTestId("cine024-progress")).toHaveText("Card 02 / 20")));
    } finally {
      await closeContexts(room.contexts, testInfo);
    }
  });

  test("authenticated members cannot read or vote in another room", async ({ browser }, testInfo) => {
    const first = await makeRoom(browser, testInfo, 2);
    const second = await makeRoom(browser, testInfo, 2);
    try {
      await Promise.all([startVoting(first), startVoting(second)]);
      const foreignSnapshot = await first.contexts[1]!.request.get(`${ORIGIN}/api/rooms/${second.roomId}`);
      expect(foreignSnapshot.status()).toBe(401);
      const candidate = await second.contexts[0]!.request.get(`${ORIGIN}/api/rooms/${second.roomId}`);
      expect(candidate.status()).toBe(200);
      const body = await candidate.json();
      const foreignVote = await first.contexts[1]!.request.post(`${ORIGIN}/api/rooms/${second.roomId}/votes`, {
        headers: { origin: ORIGIN },
        data: {
          candidateId: body.room.currentCandidate.candidateId,
          movieId: body.room.currentCandidate.movieId,
          roundId: body.room.currentRoundId,
          vote: "SKIP",
          operationId: randomUUID(),
        },
      });
      expect(foreignVote.status()).toBe(401);
      const untouched = await db.query("SELECT count(*)::int AS count FROM public.votes WHERE room_id = $1", [second.roomId]);
      expect(untouched.rows[0]?.count).toBe(0);
    } finally {
      await closeContexts([...first.contexts, ...second.contexts], testInfo);
    }
  });

  test("host browser disconnect is visible, and reconnect preserves the active round", async ({ browser }, testInfo) => {
    const room = await makeRoom(browser, testInfo, 2);
    try {
      await startVoting(room);
      const hostContext = room.contexts[0]!;
      const storageState = await hostContext.storageState();
      const disconnect = await hostContext.request.post(`${ORIGIN}/api/rooms/${room.roomId}/presence`, {
        headers: { origin: ORIGIN }, data: { connected: false },
      });
      expect(disconnect.status()).toBe(200);
      expect((await disconnect.json()).room.status).toBe("ACTIVE");
      await hostContext.close();
      room.contexts.splice(0, 1);
      const guest = room.contexts[0]!;
      await expect.poll(async () => {
        const response = await guest.request.get(`${ORIGIN}/api/rooms/${room.roomId}`);
        const body = await response.json();
        return body.room.participants.find((participant: { displayName: string }) => participant.displayName === room.hostName)?.isConnected;
      }, { timeout: 20000 }).toBe(false);
      const active = await guest.request.get(`${ORIGIN}/api/rooms/${room.roomId}`);
      expect((await active.json()).room.status).toBe("ACTIVE");

      const resumed = await makeContext(browser, testInfo, storageState);
      room.contexts.push(resumed);
      const page = await resumed.newPage();
      await page.goto(`/cinematch/vote/${room.roomId}`);
      await expectLive(page);
      const presence = await resumed.request.post(`${ORIGIN}/api/rooms/${room.roomId}/presence`, {
        headers: { origin: ORIGIN }, data: { connected: true },
      });
      expect(presence.status()).toBe(200);
      const restored = await resumed.request.get(`${ORIGIN}/api/rooms/${room.roomId}`);
      const body = await restored.json();
      expect(body.room.status).toBe("ACTIVE");
      expect(body.viewer.role).toBe("HOST");
    } finally {
      await closeContexts(room.contexts, testInfo);
    }
  });

  test("WebSocket interruption reconnects and resyncs the Supabase Realtime room", async ({ browser }, testInfo) => {
    const interruption: {
      connections: number;
      closes: number;
      routes: number;
      broadcasts: number;
      activeRoute?: { close: (options?: { code?: number; reason?: string }) => Promise<void> };
    } = { connections: 0, closes: 0, routes: 0, broadcasts: 0 };
    const room = await makeRoom(browser, testInfo, 2, undefined, async (page, index) => {
      if (index !== 1) return;
      await page.routeWebSocket(/\/realtime\/v1\/websocket/, (route) => {
        interruption.routes += 1;
        route.connectToServer();
        interruption.activeRoute = route;
      });
      page.on("websocket", (socket) => {
        if (new URL(socket.url()).pathname !== "/realtime/v1/websocket") return;
        interruption.connections += 1;
        socket.on("close", () => { interruption.closes += 1; });
        socket.on("framereceived", ({ payload }) => {
          const frame = decodeRealtimeFrame(payload);
          if (frame?.topic?.includes(room.roomId) && frame.event === "broadcast" && frame.payload?.event === "room_changed") interruption.broadcasts += 1;
        });
      });
    });
    try {
      await startVoting(room);
      await expect.poll(() => interruption.connections, { timeout: 20000 }).toBeGreaterThan(0);
      await expect.poll(() => interruption.routes, { timeout: 20000 }).toBeGreaterThan(0);
      const connectionsBeforeInterruption = interruption.connections;
      await interruption.activeRoute!.close({ code: 1011, reason: "CINE-026 simulated Realtime interruption" });
      await expect.poll(() => interruption.closes, { timeout: 15000 }).toBeGreaterThan(0);
      const broadcastsBeforeInterruptedVote = interruption.broadcasts;
      const offlineVote = await clickVote(room.pages[0]!, room.roomId, "SKIP");
      expect(offlineVote.room.status).toBe("ACTIVE");
      expect(offlineVote.room.currentCandidateIndex).toBe(0);
      await expect.poll(() => interruption.connections, { timeout: 30000 }).toBeGreaterThan(connectionsBeforeInterruption);
      await expectLive(room.pages[1]!);
      const last = await clickVote(room.pages[1]!, room.roomId, "SKIP");
      expect(last.room.currentCandidateIndex).toBe(1);
      await expect(room.pages[1]!.getByTestId("cine024-progress")).toHaveText("Card 02 / 20");
      await expect.poll(() => interruption.connections, { timeout: 30000 }).toBeGreaterThan(1);
      await expect.poll(() => interruption.broadcasts, { timeout: 30000 }).toBeGreaterThan(broadcastsBeforeInterruptedVote);
    } finally {
      await closeContexts(room.contexts, testInfo);
    }
  });

  test("90-second disconnected-host grace expires without a wall-clock sleep", async ({ browser }, testInfo) => {
    const room = await makeRoom(browser, testInfo, 2);
    try {
      await startVoting(room);
      const [hostContext] = room.contexts.splice(0, 1);
      const disconnected = await hostContext!.request.post(`${ORIGIN}/api/rooms/${room.roomId}/presence`, {
        headers: { origin: ORIGIN }, data: { connected: false },
      });
      expect(disconnected.status()).toBe(200);
      await hostContext!.close();
      const guest = room.contexts[0]!;
      await expect.poll(async () => {
        const response = await guest.request.get(`${ORIGIN}/api/rooms/${room.roomId}`);
        const snapshot = await response.json();
        return snapshot.room.participants.find((participant: { displayName: string }) => participant.displayName === room.hostName)?.isConnected;
      }, { timeout: 20000 }).toBe(false);
      const backdated = await db.query(
        `UPDATE public.room_participants
            SET is_connected = false, last_seen_at = NOW() - INTERVAL '120 seconds'
          WHERE room_id = $1 AND participant_id = $2 AND display_name = $3`,
        [room.roomId, room.participantIds[0], room.hostName]
      );
      expect(backdated.rowCount).toBe(1);
      const staleHost = await db.query(
        `SELECT is_connected, last_seen_at < NOW() - INTERVAL '90 seconds' AS grace_expired
           FROM public.room_participants
          WHERE room_id = $1 AND participant_id = $2 AND display_name = $3`,
        [room.roomId, room.participantIds[0], room.hostName]
      );
      expect(staleHost.rows[0]?.is_connected).toBe(false);
      expect(staleHost.rows[0]?.grace_expired).toBe(true);
      const roundState = await db.query(
        `SELECT r.status, r.current_round_id, r.host_participant_id,
                (SELECT count(*) FROM public.round_participants rp WHERE rp.round_id = r.current_round_id) AS frozen_members
           FROM public.rooms r WHERE r.id = $1`,
        [room.roomId]
      );
      expect(roundState.rows[0]?.status).toBe("ACTIVE");
      expect(roundState.rows[0]?.current_round_id).toBeTruthy();
      expect(Number(roundState.rows[0]?.frozen_members)).toBe(2);
      const response = await guest.request.get(`${ORIGIN}/api/rooms/${room.roomId}`);
      expect(response.status()).toBe(200);
      const snapshot = await response.json();
      expect(snapshot.room.status, JSON.stringify({ room: snapshot.room, roundState: roundState.rows[0] })).toBe("LOBBY");
      expect(snapshot.room.finishState.code).toBe("ROUND_CANCELLED");
      expect(snapshot.viewer.role).toBe("HOST");
    } finally {
      await closeContexts(room.contexts, testInfo);
    }
  });

  test("all twenty cards exhaust only after both independent clients skip each card", async ({ browser }, testInfo) => {
    test.setTimeout(600000);
    const room = await makeRoom(browser, testInfo, 2);
    try {
      await startVoting(room);
      for (let index = 0; index < 20; index += 1) {
        const current = await room.contexts[0]!.request.get(`${ORIGIN}/api/rooms/${room.roomId}`);
        expect(current.status()).toBe(200);
        const snapshot = await current.json();
        expect(snapshot.room.currentCandidateIndex).toBe(index);
        const candidate = snapshot.room.currentCandidate as { candidateId: string; movieId: number };
        const roundId = snapshot.room.currentRoundId as string;
        const votes = await Promise.all(room.contexts.map((context) => context.request.post(`${ORIGIN}/api/rooms/${room.roomId}/votes`, {
          headers: { origin: ORIGIN },
          data: { candidateId: candidate.candidateId, movieId: candidate.movieId, roundId, vote: "SKIP", operationId: randomUUID() },
        })));
        expect(votes.map((response) => response.status())).toEqual([200, 200]);
        const results = await Promise.all(votes.map((response) => response.json()));
        const expectedStatus = index === 19 ? "EXHAUSTED" : "ACTIVE";
        expect(results.every((result) => result.isMatched === false)).toBe(true);
        const authoritative = await room.contexts[0]!.request.get(`${ORIGIN}/api/rooms/${room.roomId}`);
        expect(authoritative.status()).toBe(200);
        const finalCardState = await authoritative.json();
        expect(finalCardState.room.status).toBe(expectedStatus);
        expect(finalCardState.room.currentCandidateIndex).toBe(index === 19 ? null : index + 1);
      }
      const persisted = await db.query(
        `SELECT r.status, r.matched_movie_id, count(v.*)::int AS vote_count,
                count(DISTINCT v.candidate_id)::int AS candidates,
                count(DISTINCT v.participant_id)::int AS voters
           FROM public.rooms r LEFT JOIN public.votes v ON v.room_id = r.id
          WHERE r.id = $1 GROUP BY r.id`,
        [room.roomId]
      );
      expect(persisted.rows[0]).toEqual({ status: "EXHAUSTED", matched_movie_id: null, vote_count: 40, candidates: 20, voters: 2 });
      await Promise.all(room.pages.map((page) => page.reload()));
      await expectResultForAll(room.pages);
      for (const page of room.pages) await expect(page.getByTestId("cine025-no-match")).toBeVisible();
    } finally {
      await closeContexts(room.contexts, testInfo);
    }
  });
});

async function makeContext(browser: Browser, testInfo: TestInfo, storageState?: Awaited<ReturnType<BrowserContext["storageState"]>>) {
  const context = await browser.newContext({
    ...(storageState ? { storageState } : {}),
    recordVideo: { dir: testInfo.outputPath("cine026-staging-video") },
  });
  await context.addInitScript(() => {
    const redact = () => {
      if (!document.head || document.getElementById("cine026-video-redaction")) return;
      const style = document.createElement("style");
      style.id = "cine026-video-redaction";
      style.textContent = '[data-testid="cm-room-code"], [data-testid="cine024-voting-panel"] header p { filter: blur(10px) !important; }';
      document.head.append(style);
    };
    new MutationObserver(redact).observe(document.documentElement, { childList: true, subtree: true });
    redact();
  });
  return context;
}

function decodeRealtimeFrame(message: string | Buffer): {
  topic?: string;
  event?: string;
  payload?: { event?: string; status?: string; response?: Record<string, unknown> };
} | null {
  if (typeof message === "string") {
    const decoded = JSON.parse(message) as unknown;
    if (Array.isArray(decoded) && decoded.length >= 5) {
      return { topic: String(decoded[0]), event: String(decoded[3]), payload: decoded[4] as { event?: string; status?: string; response?: Record<string, unknown> } };
    }
    return decoded as { event?: string; payload?: { event?: string; status?: string; response?: Record<string, unknown> } };
  }

  // Supabase Realtime encodes server broadcast frames as binary (kind 4).
  // Read only the length-prefixed event name; no room IDs or payload data are logged.
  if (message.length >= 5 && message[0] === 4) {
    const topicLength = message[1]!;
    const eventLength = message[2]!;
    const topic = message.subarray(5, 5 + topicLength).toString("utf8");
    const eventStart = 5 + topicLength;
    const event = message.subarray(eventStart, eventStart + eventLength).toString("utf8");
    return { topic, event: "broadcast", payload: { event } };
  }
  const decoded = JSON.parse(message.toString("utf8")) as unknown;
  if (Array.isArray(decoded) && decoded.length >= 5) {
    return { topic: String(decoded[0]), event: String(decoded[3]), payload: decoded[4] as { event?: string; status?: string; response?: Record<string, unknown> } };
  }
  return decoded as { event?: string; payload?: { event?: string; status?: string; response?: Record<string, unknown> } };
}

async function makeRoom(
  browser: Browser,
  testInfo: TestInfo,
  participantCount: number,
  prepareContext?: (context: BrowserContext, index: number) => Promise<void> | void,
  observePage?: (page: Page, index: number) => void | Promise<void>
): Promise<RoomRun> {
  const contexts = await Promise.all(Array.from({ length: participantCount }, () => makeContext(browser, testInfo)));
  try {
    if (prepareContext) await Promise.all(contexts.map((context, index) => prepareContext(context, index)));
    const hostName = RUN + "-host";
    const create = await contexts[0]!.request.post(`${ORIGIN}/api/rooms`, {
      headers: { origin: ORIGIN },
      data: { displayName: hostName, deckFilter: { with_keywords: "999995" } },
    });
    expect(create.status()).toBe(201);
    const created = await create.json();
    const roomId = created.room.roomId as string;
    const code = created.room.code as string;
    const participantIds = [created.viewer.participantId as string];
    createdRoomIds.add(roomId);

    for (let index = 1; index < contexts.length; index += 1) {
      const name = `${RUN}-p${index + 1}`;
      const joined = await contexts[index]!.request.post(`${ORIGIN}/api/rooms/join`, {
        headers: { origin: ORIGIN }, data: { code, displayName: name },
      });
      expect(joined.status()).toBe(200);
      participantIds.push((await joined.json()).viewer.participantId as string);
    }

    const authoritative = await contexts[0]!.request.get(`${ORIGIN}/api/rooms/${roomId}`);
    expect(authoritative.status()).toBe(200);
    expect((await authoritative.json()).room.participantCount).toBe(participantCount);

    const pages = await Promise.all(contexts.map(async (context) => {
      const page = await context.newPage();
      await observePage?.(page, contexts.indexOf(context));
      await page.goto(`/cinematch/room/${roomId}`);
      await expect(page.getByTestId("cm-participant-count")).toHaveText(`${participantCount} / 5`, { timeout: 30000 });
      return page;
    }));
    return { contexts, pages, roomId, code, hostName, participantIds };
  } catch (error) {
    await closeContexts(contexts, testInfo);
    throw error;
  }
}

async function startVoting(room: RoomRun) {
  await expect(room.pages[0]!.getByTestId("cm-start-round")).toBeEnabled();
  await room.pages[0]!.getByTestId("cm-start-round").click();
  await Promise.all(room.pages.map((page) => expect(page.getByTestId("cm-continue-voting")).toBeVisible({ timeout: 30000 })));
  await Promise.all(room.pages.map(async (page) => {
    await page.getByTestId("cm-continue-voting").click();
    await expect(page.getByTestId("cine024-voting-panel")).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("cine024-progress")).toHaveText("Card 01 / 20", { timeout: 30000 });
    await expectLive(page);
  }));
}

async function expectLive(page: Page) {
  await expect(page.getByTestId("cm-connection-banner")).toContainText("Live: Realtime room channel connected", { timeout: 30000 });
}

async function clickVote(page: Page, roomId: string, choice: "LIKE" | "SKIP") {
  const responsePromise = page.waitForResponse((response) => {
    const request = response.request();
    return new URL(response.url()).pathname === `/api/rooms/${roomId}/votes` && request.method() === "POST";
  });
  await page.getByTestId(choice === "LIKE" ? "cine024-like" : "cine024-skip").click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  return response.json() as Promise<{ isMatched: boolean; idempotentReplay: boolean; room: { status: string; currentCandidateIndex: number | null } }>;
}

async function expectResultForAll(pages: Page[]) {
  await Promise.all(pages.map((page) => expect(page.getByTestId("cine026-open-result")).toBeVisible({ timeout: 30000 })));
  await Promise.all(pages.map((page) => page.getByTestId("cine026-open-result").click()));
  await Promise.all(pages.map(async (page) => {
    await expect(page).toHaveURL(/\/cinematch\/result\/[a-f0-9-]{36}$/i);
  }));
}

async function closeContexts(contexts: BrowserContext[], testInfo: TestInfo) {
  const videos = contexts.flatMap((context) => context.pages().map((page) => page.video()).filter((video): video is NonNullable<typeof video> => Boolean(video)));
  await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
  if (testInfo.status === testInfo.expectedStatus) {
    await Promise.all(videos.map((video) => video.delete().catch(() => undefined)));
  }
}
