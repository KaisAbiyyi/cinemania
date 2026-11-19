import { expect, test } from "@playwright/test";

test.describe("CINE-020 Finish States, Filtered Retry & Presence E2E", () => {
  test("recovers EXHAUSTED round via LOBBY+filters and direct startRound=true retry, enforcing host/state guards", async ({
    browser,
    baseURL,
  }) => {
    const origin = new URL(baseURL ?? "http://localhost:3055").origin;
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const outsiderCtx = await browser.newContext();

    try {
      const createRes = await hostCtx.request.post(`${origin}/api/rooms`, {
        headers: { origin },
        data: { displayName: "Finish Host", deckFilter: { with_keywords: "999992" } },
      });
      expect(createRes.status()).toBe(201);
      const created = await createRes.json();
      const roomId: string = created.room.roomId;
      const code: string = created.room.code;

      const joinRes = await guestCtx.request.post(`${origin}/api/rooms/join`, {
        headers: { origin },
        data: { code, displayName: "Finish Guest" },
      });
      expect(joinRes.status()).toBe(200);

      // Start Round 1 (1-card shortage deck 999992)
      const start1Res = await hostCtx.request.post(`${origin}/api/rooms/${roomId}/start`, {
        headers: { origin },
        data: {},
      });
      expect(start1Res.status()).toBe(200);
      const s1 = await start1Res.json();
      const round1Id: string = s1.room.currentRoundId;
      const onlyCard = s1.room.deck[0]!;

      await hostCtx.request.post(`${origin}/api/rooms/${roomId}/votes`, {
        headers: { origin, "Idempotency-Key": "e2e-fin-r1-h" },
        data: { roundId: round1Id, candidateId: onlyCard.candidateId, movieId: onlyCard.movieId, vote: "SKIP" },
      });
      const lastV1 = await guestCtx.request.post(`${origin}/api/rooms/${roomId}/votes`, {
        headers: { origin, "Idempotency-Key": "e2e-fin-r1-g" },
        data: { roundId: round1Id, candidateId: onlyCard.candidateId, movieId: onlyCard.movieId, vote: "LIKE" },
      });
      expect(lastV1.status()).toBe(200);
      const exBody = await lastV1.json();
      expect(exBody.isExhausted).toBe(true);
      expect(exBody.room.status).toBe("EXHAUSTED");
      expect(exBody.room.canRetry).toBe(true);
      expect(exBody.room.finishState.code).toBe("DECK_EXHAUSTED");

      // Outsider 401 and non-host 403 fail closed on /retry
      const outRetry = await outsiderCtx.request.post(`${origin}/api/rooms/${roomId}/retry`, {
        headers: { origin },
        data: { startRound: false },
      });
      expect(outRetry.status()).toBe(401);

      const guestRetry = await guestCtx.request.post(`${origin}/api/rooms/${roomId}/retry`, {
        headers: { origin },
        data: { startRound: false },
      });
      expect(guestRetry.status()).toBe(403);
      expect((await guestRetry.json()).error).toBe("HOST_ONLY_ACTION");

      // Path A: Host retries EXHAUSTED -> LOBBY, updates filters to 999994 (20 movies), starts Round 2
      const retryLobbyRes = await hostCtx.request.post(`${origin}/api/rooms/${roomId}/retry`, {
        headers: { origin },
        data: { startRound: false, operationId: `e2e-retry-lobby-${round1Id}` },
      });
      expect(retryLobbyRes.status()).toBe(200);
      expect((await retryLobbyRes.json()).room.status).toBe("LOBBY");

      const filterRes = await hostCtx.request.patch(`${origin}/api/rooms/${roomId}/filters`, {
        headers: { origin },
        data: { with_keywords: "999994" },
      });
      expect(filterRes.status()).toBe(200);

      const start2Res = await hostCtx.request.post(`${origin}/api/rooms/${roomId}/start`, {
        headers: { origin },
        data: {},
      });
      expect(start2Res.status()).toBe(200);
      const s2 = await start2Res.json();
      expect(s2.room.status).toBe("ACTIVE");
      expect(s2.room.deckSize).toBe(20);
      expect(s2.room.frozenQuorum).toBe(2);

      // Reach MATCHED on Round 2 Card 0, then verify /retry refuses MATCHED with 409
      const r2Card0 = s2.room.deck[0]!;
      await hostCtx.request.post(`${origin}/api/rooms/${roomId}/votes`, {
        headers: { origin, "Idempotency-Key": "e2e-fin-r2-h" },
        data: { roundId: s2.room.currentRoundId, candidateId: r2Card0.candidateId, movieId: r2Card0.movieId, vote: "LIKE" },
      });
      const r2Win = await guestCtx.request.post(`${origin}/api/rooms/${roomId}/votes`, {
        headers: { origin, "Idempotency-Key": "e2e-fin-r2-g" },
        data: { roundId: s2.room.currentRoundId, candidateId: r2Card0.candidateId, movieId: r2Card0.movieId, vote: "LIKE" },
      });
      expect(r2Win.status()).toBe(200);
      expect((await r2Win.json()).room.status).toBe("MATCHED");

      const retryAfterMatch = await hostCtx.request.post(`${origin}/api/rooms/${roomId}/retry`, {
        headers: { origin },
        data: { startRound: false },
      });
      expect(retryAfterMatch.status()).toBe(409);
      expect((await retryAfterMatch.json()).error).toBe("ROOM_NOT_EXHAUSTED");
    } finally {
      await Promise.all([hostCtx.close(), guestCtx.close(), outsiderCtx.close()]);
    }
  });

  test("handles direct EXHAUSTED -> ACTIVE retry with idempotency and live disconnect/reconnect presence without split-brain", async ({
    browser,
    baseURL,
  }) => {
    const origin = new URL(baseURL ?? "http://localhost:3055").origin;
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();

    try {
      const createRes = await hostCtx.request.post(`${origin}/api/rooms`, {
        headers: { origin },
        data: { displayName: "Presence Host", deckFilter: { with_keywords: "999992" } },
      });
      expect(createRes.status()).toBe(201);
      const created = await createRes.json();
      const roomId: string = created.room.roomId;

      await guestCtx.request.post(`${origin}/api/rooms/join`, {
        headers: { origin },
        data: { code: created.room.code, displayName: "Presence Guest" },
      });

      const s1 = await (
        await hostCtx.request.post(`${origin}/api/rooms/${roomId}/start`, {
          headers: { origin },
          data: {},
        })
      ).json();
      const c0 = s1.room.deck[0]!;
      await hostCtx.request.post(`${origin}/api/rooms/${roomId}/votes`, {
        headers: { origin },
        data: { roundId: s1.room.currentRoundId, candidateId: c0.candidateId, movieId: c0.movieId, vote: "SKIP" },
      });
      await guestCtx.request.post(`${origin}/api/rooms/${roomId}/votes`, {
        headers: { origin },
        data: { roundId: s1.room.currentRoundId, candidateId: c0.candidateId, movieId: c0.movieId, vote: "LIKE" },
      });

      // Direct EXHAUSTED -> ACTIVE retry with updated filter 999995 & operationId
      const directOpId = `e2e-direct-retry-${s1.room.currentRoundId}`;
      const directRes = await hostCtx.request.post(`${origin}/api/rooms/${roomId}/retry`, {
        headers: { origin, "Idempotency-Key": directOpId },
        data: { startRound: true, deckFilter: { with_keywords: "999995" } },
      });
      expect(directRes.status()).toBe(200);
      const directBody = await directRes.json();
      expect(directBody.room.status).toBe("ACTIVE");
      expect(directBody.room.deckSize).toBe(20);
      expect(directBody.idempotentReplay).toBe(false);

      // Idempotent replay produces identical round and stateVersion
      const replayRes = await hostCtx.request.post(`${origin}/api/rooms/${roomId}/retry`, {
        headers: { origin, "Idempotency-Key": directOpId },
        data: { startRound: true, deckFilter: { with_keywords: "999995" } },
      });
      expect(replayRes.status()).toBe(200);
      const replayBody = await replayRes.json();
      expect(replayBody.idempotentReplay).toBe(true);
      expect(replayBody.room.currentRoundId).toBe(directBody.room.currentRoundId);
      expect(replayBody.room.stateVersion).toBe(directBody.room.stateVersion);

      // Presence disconnect + reconnect within 90s grace preserves ACTIVE round and zero duplicate participant
      const badPayload = await guestCtx.request.post(`${origin}/api/rooms/${roomId}/presence`, {
        headers: { origin },
        data: { connected: "invalid" },
      });
      expect(badPayload.status()).toBe(400);

      const discRes = await guestCtx.request.post(`${origin}/api/rooms/${roomId}/presence`, {
        headers: { origin },
        data: { connected: false },
      });
      expect(discRes.status()).toBe(200);
      const discBody = await discRes.json();
      expect(discBody.changed).toBe(true);
      expect(discBody.room.status).toBe("ACTIVE");
      expect(discBody.room.participants.find((p: { isSelf: boolean }) => p.isSelf).graceExpiresAt).toBeDefined();

      const reconRes = await guestCtx.request.post(`${origin}/api/rooms/${roomId}/presence`, {
        headers: { origin },
        data: { connected: true },
      });
      expect(reconRes.status()).toBe(200);
      const reconBody = await reconRes.json();
      expect(reconBody.changed).toBe(true);
      expect(reconBody.room.status).toBe("ACTIVE");
      expect(reconBody.room.participants).toHaveLength(2);
      expect(reconBody.room.participants.find((p: { isSelf: boolean }) => p.isSelf).graceExpiresAt).toBeUndefined();
    } finally {
      await Promise.all([hostCtx.close(), guestCtx.close()]);
    }
  });
});
