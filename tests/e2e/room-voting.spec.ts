import { expect, test } from "@playwright/test";

test.describe("CINE-017 Multi-Context Unanimous Matching & Immutable Votes E2E", () => {
  test("converges across 5 browser contexts: advance on SKIP, immutable flips, idempotent retries, and unanimous MATCHED", async ({
    browser,
    baseURL,
  }) => {
    const origin = new URL(baseURL ?? "http://localhost:3055").origin;
    const contexts = await Promise.all(Array.from({ length: 5 }, () => browser.newContext()));

    try {
      const [hostCtx, ...guestCtxs] = contexts;

      const createRes = await hostCtx.request.post(`${origin}/api/rooms`, {
        headers: { origin },
        data: {
          displayName: "Host",
          deckFilter: { with_keywords: "999995" },
        },
      });
      expect(createRes.status()).toBe(201);
      const created = await createRes.json();
      const roomId: string = created.room.roomId;
      const code: string = created.room.code;

      for (let i = 0; i < guestCtxs.length; i += 1) {
        const joinRes = await guestCtxs[i].request.post(`${origin}/api/rooms/join`, {
          headers: { origin },
          data: { code, displayName: `Voter ${i + 2}` },
        });
        expect(joinRes.status()).toBe(200);
      }

      const startRes = await hostCtx.request.post(`${origin}/api/rooms/${roomId}/start`, {
        headers: { origin },
        data: {},
      });
      expect(startRes.status()).toBe(200);
      const started = await startRes.json();
      expect(started.room.status).toBe("ACTIVE");
      expect(started.room.frozenQuorum).toBe(5);
      expect(started.room.deckSize).toBe(20);

      const roundId: string = started.room.currentRoundId;
      const card0 = started.room.deck[0]!;
      const card1 = started.room.deck[1]!;

      // Card 0: 4 voters LIKE, 1 voter SKIP -> must advance deck, never majority-match
      for (let i = 0; i < 4; i += 1) {
        const ctx = i === 0 ? hostCtx : guestCtxs[i - 1]!;
        const vRes = await ctx.request.post(`${origin}/api/rooms/${roomId}/votes`, {
          headers: { origin, "Idempotency-Key": `e2e-c0-v${i}` },
          data: {
            roundId,
            candidateId: card0.candidateId,
            movieId: card0.movieId,
            vote: "LIKE",
          },
        });
        expect(vRes.status()).toBe(200);
        const vBody = await vRes.json();
        expect(vBody.isMatched).toBe(false);
        expect(vBody.room.status).toBe("ACTIVE");
      }

      const lastVoterCtx = guestCtxs[3]!;
      const skipRes = await lastVoterCtx.request.post(`${origin}/api/rooms/${roomId}/votes`, {
        headers: { origin, "Idempotency-Key": "e2e-c0-v4" },
        data: {
          roundId,
          candidateId: card0.candidateId,
          movieId: card0.movieId,
          vote: "SKIP",
        },
      });
      expect(skipRes.status()).toBe(200);
      const skipBody = await skipRes.json();
      expect(skipBody.isMatched).toBe(false);
      expect(skipBody.room.status).toBe("ACTIVE");
      expect(skipBody.room.currentCandidateIndex).toBe(1);
      expect(skipBody.room.currentCandidate.candidateId).toBe(card1.candidateId);

      // Duplicate idempotent retry on Card 0 SKIP -> same stateVersion, idempotentReplay: true
      const retrySkip = await lastVoterCtx.request.post(`${origin}/api/rooms/${roomId}/votes`, {
        headers: { origin, "Idempotency-Key": "e2e-c0-v4" },
        data: {
          roundId,
          candidateId: card0.candidateId,
          movieId: card0.movieId,
          vote: "SKIP",
        },
      });
      expect(retrySkip.status()).toBe(200);
      const retrySkipBody = await retrySkip.json();
      expect(retrySkipBody.idempotentReplay).toBe(true);
      expect(retrySkipBody.room.stateVersion).toBe(skipBody.room.stateVersion);

      // Reuse same operationId with different vote -> 409 OPERATION_ID_CONFLICT
      const conflictOp = await lastVoterCtx.request.post(`${origin}/api/rooms/${roomId}/votes`, {
        headers: { origin, "Idempotency-Key": "e2e-c0-v4" },
        data: {
          roundId,
          candidateId: card1.candidateId,
          movieId: card1.movieId,
          vote: "LIKE",
        },
      });
      expect(conflictOp.status()).toBe(409);
      expect((await conflictOp.json()).error).toBe("OPERATION_ID_CONFLICT");

      // Immutable flip SKIP -> LIKE on Card 0 -> 409 VOTE_IMMUTABLE
      const flipRes = await lastVoterCtx.request.post(`${origin}/api/rooms/${roomId}/votes`, {
        headers: { origin, "Idempotency-Key": "e2e-c0-v4-flip" },
        data: {
          roundId,
          candidateId: card0.candidateId,
          movieId: card0.movieId,
          vote: "LIKE",
        },
      });
      expect(flipRes.status()).toBe(409);
      expect((await flipRes.json()).error).toBe("VOTE_IMMUTABLE");

      // Vote confidentiality check before Card 1 votes: Host sees only own LIKE, not lastVoter's SKIP
      const hostSnapRes = await hostCtx.request.get(`${origin}/api/rooms/${roomId}`);
      expect(hostSnapRes.status()).toBe(200);
      const hostSnap = await hostSnapRes.json();
      expect(hostSnap.viewer.userVotes).toEqual({ [card0.candidateId]: "LIKE" });
      expect(JSON.stringify(hostSnap)).not.toContain('"SKIP"');

      // Card 1: All 5 contexts submit unanimous LIKE concurrently
      const allVoteResponses = await Promise.all(
        contexts.map((ctx, idx) =>
          ctx.request.post(`${origin}/api/rooms/${roomId}/votes`, {
            headers: { origin, "x-operation-id": `e2e-c1-v${idx}` },
            data: {
              roundId,
              candidateId: card1.candidateId,
              movieId: card1.movieId,
              vote: "LIKE",
            },
          })
        )
      );
      for (const r of allVoteResponses) {
        expect(r.status()).toBe(200);
      }
      const allVoteBodies = await Promise.all(allVoteResponses.map((r) => r.json()));
      const winningBodies = allVoteBodies.filter((b) => b.isMatched === true);
      expect(winningBodies.length).toBe(1);
      const winningVersion = winningBodies[0]!.room.stateVersion;

      // Every browser context observes identical MATCHED outcome on GET snapshot
      const snapshots = await Promise.all(
        contexts.map(async (ctx) => {
          const r = await ctx.request.get(`${origin}/api/rooms/${roomId}`);
          expect(r.status()).toBe(200);
          return r.json();
        })
      );
      for (const snap of snapshots) {
        expect(snap.room.status).toBe("MATCHED");
        expect(snap.room.matchedMovieId).toBe(card1.movieId);
        expect(snap.room.matchedCandidate.candidateId).toBe(card1.candidateId);
        expect(snap.room.stateVersion).toBe(winningVersion);
      }

      // Late vote on unvoted Card 2 after MATCHED -> 409 ROOM_ALREADY_MATCHED
      const card2 = started.room.deck[2]!;
      const lateVote = await hostCtx.request.post(`${origin}/api/rooms/${roomId}/votes`, {
        headers: { origin, "x-operation-id": "e2e-late-card2" },
        data: {
          roundId,
          candidateId: card2.candidateId,
          movieId: card2.movieId,
          vote: "LIKE",
        },
      });
      expect(lateVote.status()).toBe(409);
      expect((await lateVote.json()).error).toBe("ROOM_ALREADY_MATCHED");

      // Idempotent retry-after-timeout on winning Card 1 LIKE vote succeeds without advancing version
      const retryWinner = await contexts[4]!.request.post(`${origin}/api/rooms/${roomId}/votes`, {
        headers: { origin, "x-operation-id": "e2e-c1-v4" },
        data: {
          roundId,
          candidateId: card1.candidateId,
          movieId: card1.movieId,
          vote: "LIKE",
        },
      });
      expect(retryWinner.status()).toBe(200);
      const retryWinnerBody = await retryWinner.json();
      expect(retryWinnerBody.idempotentReplay).toBe(true);
      expect(retryWinnerBody.isMatched).toBe(true);
      expect(retryWinnerBody.room.stateVersion).toBe(winningVersion);
    } finally {
      await Promise.all(contexts.map((c) => c.close()));
    }
  });

  test("handles 1-card shortage exhaustion when last vote is LIKE after prior SKIP and enforces fail-closed security", async ({
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
        data: {
          displayName: "ShortageHost",
          deckFilter: { with_keywords: "999992" },
        },
      });
      expect(createRes.status()).toBe(201);
      const created = await createRes.json();
      const roomId: string = created.room.roomId;
      const code: string = created.room.code;

      const joinRes = await guestCtx.request.post(`${origin}/api/rooms/join`, {
        headers: { origin },
        data: { code, displayName: "ShortageGuest" },
      });
      expect(joinRes.status()).toBe(200);

      const startRes = await hostCtx.request.post(`${origin}/api/rooms/${roomId}/start`, {
        headers: { origin },
        data: {},
      });
      expect(startRes.status()).toBe(200);
      const started = await startRes.json();
      expect(started.room.deckSize).toBe(1);
      const onlyCard = started.room.deck[0]!;
      const roundId: string = started.room.currentRoundId;

      // Outsider unauthenticated context cannot vote (401)
      const unauthRes = await outsiderCtx.request.post(`${origin}/api/rooms/${roomId}/votes`, {
        headers: { origin },
        data: {
          roundId,
          candidateId: onlyCard.candidateId,
          movieId: onlyCard.movieId,
          vote: "LIKE",
        },
      });
      expect(unauthRes.status()).toBe(401);

      // Host skips first
      const v1 = await hostCtx.request.post(`${origin}/api/rooms/${roomId}/votes`, {
        headers: { origin, "Idempotency-Key": "e2e-shortage-1" },
        data: {
          roundId,
          candidateId: onlyCard.candidateId,
          movieId: onlyCard.movieId,
          vote: "SKIP",
        },
      });
      expect(v1.status()).toBe(200);
      expect((await v1.json()).room.status).toBe("ACTIVE");

      // Guest votes LIKE second -> must transition to EXHAUSTED because final vote resolved the deck without match
      const v2 = await guestCtx.request.post(`${origin}/api/rooms/${roomId}/votes`, {
        headers: { origin, "Idempotency-Key": "e2e-shortage-2" },
        data: {
          roundId,
          candidateId: onlyCard.candidateId,
          movieId: onlyCard.movieId,
          vote: "LIKE",
        },
      });
      expect(v2.status()).toBe(200);
      const b2 = await v2.json();
      expect(b2.isMatched).toBe(false);
      expect(b2.isExhausted).toBe(true);
      expect(b2.room.status).toBe("EXHAUSTED");

      // Idempotent retry on EXHAUSTED
      const retry = await guestCtx.request.post(`${origin}/api/rooms/${roomId}/votes`, {
        headers: { origin, "Idempotency-Key": "e2e-shortage-2" },
        data: {
          roundId,
          candidateId: onlyCard.candidateId,
          movieId: onlyCard.movieId,
          vote: "LIKE",
        },
      });
      expect(retry.status()).toBe(200);
      const retryBody = await retry.json();
      expect(retryBody.idempotentReplay).toBe(true);
      expect(retryBody.room.stateVersion).toBe(b2.room.stateVersion);
    } finally {
      await Promise.all([hostCtx.close(), guestCtx.close(), outsiderCtx.close()]);
    }
  });
});
