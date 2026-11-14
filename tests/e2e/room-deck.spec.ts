import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const REQUEST_LOG_PATH = path.join(process.cwd(), "tests", "fixtures", "request-logs.json");

function countDiscoverRequestsForKeyword(keyword: string): number {
  if (!fs.existsSync(REQUEST_LOG_PATH)) {
    return 0;
  }
  try {
    const raw = fs.readFileSync(REQUEST_LOG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Array<{ pathname?: string; query?: string }>;
    if (!Array.isArray(parsed)) return 0;
    return parsed.filter(
      (entry) =>
        entry.pathname === "/3/discover/movie" &&
        String(entry.query ?? "").includes(`with_keywords=${keyword}`)
    ).length;
  } catch {
    return 0;
  }
}

test.describe("CINE-016 Deterministic Room Movie Deck & Filters E2E", () => {
  test("5 browser contexts converge on identical deterministic 20-movie deck, zero per-read TMDB calls, and lock post-start filters", async ({
    browser,
    baseURL,
  }) => {
    const origin = new URL(baseURL ?? "http://localhost:3055").origin;
    const contexts = await Promise.all(Array.from({ length: 5 }, () => browser.newContext()));

    try {
      const [hostCtx, ...guestCtxs] = contexts;

      // Reject adult content cleanly at room creation
      const badCreate = await hostCtx.request.post(`${origin}/api/rooms`, {
        headers: { origin },
        data: { displayName: "Host", deckFilter: { include_adult: true } },
      });
      expect(badCreate.status()).toBe(400);
      expect((await badCreate.json()).error).toBe("INVALID_DECK_FILTER");

      // Host creates room cleanly with initial filters
      const createRes = await hostCtx.request.post(`${origin}/api/rooms`, {
        headers: { origin },
        data: {
          displayName: "Host",
          deckFilter: { with_genres: "28", "vote_average.gte": 7 },
        },
      });
      expect(createRes.status()).toBe(201);
      const created = await createRes.json();
      const roomId: string = created.room.roomId;
      const code: string = created.room.code;

      // 4 separate guests join via separate browser contexts
      for (let i = 0; i < guestCtxs.length; i += 1) {
        const joinRes = await guestCtxs[i].request.post(`${origin}/api/rooms/join`, {
          headers: { origin },
          data: { code, displayName: `Guest ${i + 1}` },
        });
        expect(joinRes.status()).toBe(200);
      }

      // Guest cannot update room filters
      const guestDenied = await guestCtxs[0].request.patch(`${origin}/api/rooms/${roomId}/filters`, {
        headers: { origin },
        data: { with_keywords: "999994" },
      });
      expect(guestDenied.status()).toBe(403);
      expect((await guestDenied.json()).error).toBe("HOST_ONLY_ACTION");

      // Host updates filter to 20-movie deterministic sentinel 999994
      const filterRes = await hostCtx.request.patch(`${origin}/api/rooms/${roomId}/filters`, {
        headers: { origin },
        data: {
          with_genres: "28",
          "vote_average.gte": 7,
          with_keywords: "999994",
        },
      });
      expect(filterRes.status()).toBe(200);
      const filterBody = await filterRes.json();
      expect(filterBody.room.deckFilter.with_keywords).toBe("999994");
      expect(filterBody.room.deckFilter.include_adult).toBe(false);

      const beforeStartDiscoverCount = countDiscoverRequestsForKeyword("999994");

      // Host starts round -> transitions LOBBY -> ACTIVE with 20 deterministic candidates
      const startRes = await hostCtx.request.post(`${origin}/api/rooms/${roomId}/start`, {
        headers: { origin },
        data: {},
      });
      expect(startRes.status()).toBe(200);
      const started = await startRes.json();
      expect(started.room.status).toBe("ACTIVE");
      expect(started.room.frozenQuorum).toBe(5);
      expect(started.room.deckSize).toBe(20);
      expect(started.room.isDeckShortage).toBe(false);
      expect(started.room.deck).toHaveLength(20);

      const countRightAfterStart = countDiscoverRequestsForKeyword("999994");
      expect(countRightAfterStart).toBeGreaterThan(beforeStartDiscoverCount);

      const expectedIds = started.room.deck.map((item: { movieId: number }) => item.movieId);

      // All 5 browser contexts read /api/rooms/[roomId] & /api/rooms/[roomId]/deck
      for (const ctx of contexts) {
        const snapRes = await ctx.request.get(`${origin}/api/rooms/${roomId}`);
        expect(snapRes.status()).toBe(200);
        expect(snapRes.headers()["cache-control"]).toContain("no-store");
        const snapJson = await snapRes.json();
        expect(snapJson.room.deck.map((item: { movieId: number }) => item.movieId)).toEqual(
          expectedIds
        );

        const deckRes = await ctx.request.get(`${origin}/api/rooms/${roomId}/deck`);
        expect(deckRes.status()).toBe(200);
        const deckJson = await deckRes.json();
        expect(deckJson.deck.map((item: { movieId: number }) => item.movieId)).toEqual(expectedIds);

        for (const member of snapJson.room.participants) {
          expect(member).not.toHaveProperty("participantId");
          expect(member).not.toHaveProperty("id");
        }
      }

      // Strictly ZERO extra TMDB calls triggered while 5 clients read snapshot/deck
      expect(countDiscoverRequestsForKeyword("999994")).toBe(countRightAfterStart);

      // Filter edits rejected with 409 FILTER_LOCKED once room is ACTIVE
      const lockedRes = await hostCtx.request.put(`${origin}/api/rooms/${roomId}/filters`, {
        headers: { origin },
        data: { with_genres: "35" },
      });
      expect(lockedRes.status()).toBe(409);
      expect((await lockedRes.json()).error).toBe("FILTER_LOCKED");
    } finally {
      await Promise.all(contexts.map((ctx) => ctx.close()));
    }
  });

  test("handles 0-result recoverable 422 DECK_EMPTY and caps 100 provider results strictly at 20", async ({
    browser,
    baseURL,
  }) => {
    const origin = new URL(baseURL ?? "http://localhost:3055").origin;
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();

    try {
      const createRes = await hostCtx.request.post(`${origin}/api/rooms`, {
        headers: { origin },
        data: { displayName: "Host", deckFilter: { with_keywords: "999991" } },
      });
      expect(createRes.status()).toBe(201);
      const { room } = await createRes.json();

      await guestCtx.request.post(`${origin}/api/rooms/join`, {
        headers: { origin },
        data: { code: room.code, displayName: "Guest" },
      });

      // 0 results -> 422 DECK_EMPTY leaving room in LOBBY
      const emptyStart = await hostCtx.request.post(`${origin}/api/rooms/${room.roomId}/start`, {
        headers: { origin },
        data: {},
      });
      expect(emptyStart.status()).toBe(422);
      expect((await emptyStart.json()).error).toBe("DECK_EMPTY");

      const lobbySnap = await hostCtx.request.get(`${origin}/api/rooms/${room.roomId}`);
      expect((await lobbySnap.json()).room.status).toBe("LOBBY");

      // Host broadens filter to 100-result fixture -> capped strictly at 20 unique cards
      await hostCtx.request.patch(`${origin}/api/rooms/${room.roomId}/filters`, {
        headers: { origin },
        data: { with_keywords: "999995" },
      });

      const cappedStart = await hostCtx.request.post(`${origin}/api/rooms/${room.roomId}/start`, {
        headers: { origin },
        data: {},
      });
      expect(cappedStart.status()).toBe(200);
      const cappedBody = await cappedStart.json();
      expect(cappedBody.room.status).toBe("ACTIVE");
      expect(cappedBody.room.deckSize).toBe(20);
      expect(cappedBody.room.isDeckShortage).toBe(false);
      expect(new Set(cappedBody.room.deck.map((d: { movieId: number }) => d.movieId)).size).toBe(
        20
      );
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });

  test("handles 1-result shortage + null poster_path and recovers from 429 rate-limit without leaving LOBBY", async ({
    browser,
    baseURL,
  }) => {
    const origin = new URL(baseURL ?? "http://localhost:3055").origin;
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();

    try {
      // Part A: 1 movie with missing poster
      const shortCreate = await hostCtx.request.post(`${origin}/api/rooms`, {
        headers: { origin },
        data: { displayName: "Host Short", deckFilter: { with_keywords: "999992" } },
      });
      expect(shortCreate.status()).toBe(201);
      const shortRoom = (await shortCreate.json()).room;

      await guestCtx.request.post(`${origin}/api/rooms/join`, {
        headers: { origin },
        data: { code: shortRoom.code, displayName: "Guest Short" },
      });

      const shortStart = await hostCtx.request.post(
        `${origin}/api/rooms/${shortRoom.roomId}/start`,
        {
          headers: { origin },
          data: {},
        }
      );
      expect(shortStart.status()).toBe(200);
      const shortBody = await shortStart.json();
      expect(shortBody.room.status).toBe("ACTIVE");
      expect(shortBody.room.deckSize).toBe(1);
      expect(shortBody.room.isDeckShortage).toBe(true);
      expect(shortBody.room.deck[0]?.posterPath).toBeNull();
      expect(shortBody.room.deck[0]?.posterUrl).toBeNull();

      // Part B: Upstream 429 leaves room in LOBBY and permits retry
      const hostRateCtx = await browser.newContext();
      const guestRateCtx = await browser.newContext();
      try {
        const rateCreate = await hostRateCtx.request.post(`${origin}/api/rooms`, {
          headers: { origin },
          data: { displayName: "Host Rate", deckFilter: { with_keywords: "999993" } },
        });
        expect(rateCreate.status()).toBe(201);
        const rateRoom = (await rateCreate.json()).room;

        await guestRateCtx.request.post(`${origin}/api/rooms/join`, {
          headers: { origin },
          data: { code: rateRoom.code, displayName: "Guest Rate" },
        });

        const rateStart = await hostRateCtx.request.post(
          `${origin}/api/rooms/${rateRoom.roomId}/start`,
          {
            headers: { origin },
            data: {},
          }
        );
        expect(rateStart.status()).toBe(429);
        expect(rateStart.headers()["retry-after"]).toBe("3");
        expect((await rateStart.json()).error).toBe("RATE_LIMITED");

        const snapAfter429 = await hostRateCtx.request.get(
          `${origin}/api/rooms/${rateRoom.roomId}`
        );
        expect((await snapAfter429.json()).room.status).toBe("LOBBY");

        await hostRateCtx.request.patch(`${origin}/api/rooms/${rateRoom.roomId}/filters`, {
          headers: { origin },
          data: { with_keywords: "999995" },
        });

        const retryStart = await hostRateCtx.request.post(
          `${origin}/api/rooms/${rateRoom.roomId}/start`,
          {
            headers: { origin },
            data: {},
          }
        );
        expect(retryStart.status()).toBe(200);
        expect((await retryStart.json()).room.status).toBe("ACTIVE");
      } finally {
        await hostRateCtx.close();
        await guestRateCtx.close();
      }
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });
});
