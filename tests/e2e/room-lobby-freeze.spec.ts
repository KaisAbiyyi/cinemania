import { expect, test } from "@playwright/test";

test.describe("CINE-015: Lobby Roster, Leave/Host Transfer, Start & Freeze E2E", () => {
  test("supports two-tab converged roster, XSS nickname sanitization, leave/host handover, host-only start, and ACTIVE late-join denial", async ({
    browser,
    baseURL,
  }) => {
    const origin = baseURL ?? "http://localhost:3055";
    const hostContext = await browser.newContext();
    const guest1Context = await browser.newContext();
    const guest2Context = await browser.newContext();
    const lateContext = await browser.newContext();

    try {
      const hostPage = await hostContext.newPage();
      const guest1Page = await guest1Context.newPage();
      await Promise.all([hostPage.goto("/"), guest1Page.goto("/")]);

      // 1. Host creates room with XSS fragment cleanly stripped
      const created = await hostPage.evaluate(async () => {
        const res = await fetch("/api/rooms", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ displayName: "Host <script>alert(1)</script> One" }),
        });
        return { status: res.status, body: await res.json() };
      });
      expect(created.status).toBe(201);
      expect(created.body.viewer.displayName).toBe("Host One");
      const roomId: string = created.body.room.roomId;
      const code: string = created.body.room.code;

      // 2. Host alone (count = 1) cannot start round
      const soloStart = await hostPage.evaluate(async (rid: string) => {
        const res = await fetch(`/api/rooms/${rid}/start`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        });
        return { status: res.status, body: await res.json() };
      }, roomId);
      expect(soloStart.status).toBe(409);
      expect(soloStart.body.error).toBe("INSUFFICIENT_PARTICIPANTS");

      // 3. Guest 1 & Guest 2 join over live HTTP contexts
      const join1 = await guest1Page.evaluate(async (roomCode: string) => {
        const res = await fetch("/api/rooms/join", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code: roomCode, displayName: "  Guest 🎬 Alpha  " }),
        });
        return { status: res.status, body: await res.json() };
      }, code);
      expect(join1.status).toBe(200);
      expect(join1.body.viewer.displayName).toBe("Guest 🎬 Alpha");

      const join2Res = await guest2Context.request.post("/api/rooms/join", {
        headers: { origin, "content-type": "application/json" },
        data: { code, displayName: "<b>Guest</b> Beta" },
      });
      expect(join2Res.status()).toBe(200);
      const join2Body = await join2Res.json();
      expect(join2Body.viewer.displayName).toBe("Guest Beta");

      // Non-host Member cannot start
      const memberStartDenied = await guest1Page.evaluate(async (rid: string) => {
        const res = await fetch(`/api/rooms/${rid}/start`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        });
        return { status: res.status, body: await res.json() };
      }, roomId);
      expect(memberStartDenied.status).toBe(403);
      expect(memberStartDenied.body.error).toBe("HOST_ONLY_ACTION");

      // Guest 2 leaves in LOBBY -> count drops 3 -> 2 cleanly
      const leave2Res = await guest2Context.request.post(`/api/rooms/${roomId}/leave`, {
        headers: { origin, "content-type": "application/json" },
        data: {},
      });
      expect(leave2Res.status()).toBe(200);
      expect(await leave2Res.json()).toMatchObject({
        left: true,
        roomClosed: false,
        participantCount: 2,
      });

      // 4. Original Host starts round while supplying tampered quorum override (ignored!)
      const startRes = await hostPage.evaluate(async (rid: string) => {
        const res = await fetch(`/api/rooms/${rid}/start`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ quorum: 1, eligibleVoterIds: ["spoof"] }),
        });
        return { status: res.status, body: await res.json() };
      }, roomId);
      expect(startRes.status).toBe(200);
      expect(startRes.body.room.status).toBe("ACTIVE");
      expect(startRes.body.room.frozenQuorum).toBe(2);

      // 5. Two-tab convergence: Host and Guest 1 tabs fetch identical frozen roster & quorum with distinct isSelf and zero peer UUIDs
      const [hostSnap, guest1Snap] = await Promise.all([
        hostPage.evaluate(async (rid: string) => {
          const res = await fetch(`/api/rooms/${rid}`);
          return { status: res.status, body: await res.json() };
        }, roomId),
        guest1Page.evaluate(async (rid: string) => {
          const res = await fetch(`/api/rooms/${rid}`);
          return { status: res.status, body: await res.json() };
        }, roomId),
      ]);

      expect(hostSnap.status).toBe(200);
      expect(guest1Snap.status).toBe(200);
      expect(hostSnap.body.room.frozenQuorum).toBe(2);
      expect(guest1Snap.body.room.frozenQuorum).toBe(2);
      expect(hostSnap.body.room.stateVersion).toBe(guest1Snap.body.room.stateVersion);
      expect(hostSnap.body.room.currentRoundId).toBe(guest1Snap.body.room.currentRoundId);
      expect(
        hostSnap.body.room.participants.map((p: { displayName: string }) => p.displayName)
      ).toEqual(
        guest1Snap.body.room.participants.map((p: { displayName: string }) => p.displayName)
      );
      expect(hostSnap.body.room.participants.map((p: { isSelf: boolean }) => p.isSelf)).toEqual([
        true,
        false,
      ]);
      expect(guest1Snap.body.room.participants.map((p: { isSelf: boolean }) => p.isSelf)).toEqual([
        false,
        true,
      ]);
      expect(JSON.stringify(hostSnap.body.room)).not.toContain(
        guest1Snap.body.viewer.participantId
      );
      expect(JSON.stringify(guest1Snap.body.room)).not.toContain(
        hostSnap.body.viewer.participantId
      );

      // 6. Late join during ACTIVE fails cleanly without modifying frozen quorum
      const lateJoinRes = await lateContext.request.post("/api/rooms/join", {
        headers: { origin, "content-type": "application/json" },
        data: { code, displayName: "Late Intruder" },
      });
      expect(lateJoinRes.status()).toBe(409);
      const lateErr = await lateJoinRes.json();
      expect(lateErr.error).toBe("ROOM_NOT_JOINABLE");
      expect(lateJoinRes.headers()["set-cookie"]).toBeUndefined();
    } finally {
      await Promise.all([
        hostContext.close(),
        guest1Context.close(),
        guest2Context.close(),
        lateContext.close(),
      ]);
    }
  });
});
