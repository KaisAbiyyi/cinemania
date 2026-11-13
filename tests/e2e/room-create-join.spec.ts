import { expect, test } from "@playwright/test";

test.describe("CINE-014: Room Create, Invite Join, and Concurrent Capacity E2E", () => {
  test("creates a room with short code, joins via normalized invite link, and rejects concurrent 6th+ join over live HTTP", async ({
    browser,
    baseURL,
  }) => {
    const origin = baseURL ?? "http://localhost:3055";
    const hostContext = await browser.newContext();
    const guestContexts = await Promise.all(
      Array.from({ length: 6 }, () => browser.newContext())
    );

    try {
      const hostPage = await hostContext.newPage();
      await hostPage.goto("/");

      const created = await hostPage.evaluate(async () => {
        const res = await fetch("/api/rooms", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ displayName: "E2E Host" }),
        });
        return { status: res.status, body: await res.json() };
      });

      expect(created.status).toBe(201);
      const roomId: string = created.body.room.roomId;
      const roomCode: string = created.body.room.code;
      expect(roomCode).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
      expect(created.body.room.invitePath).toBe(`/join/${roomCode}`);
      expect(created.body.room.canStart).toBe(false);

      const cookieName = `cm_guest_${roomId}`;
      const hostCookies = await hostContext.cookies();
      expect(hostCookies.find((c) => c.name === cookieName)?.httpOnly).toBe(true);
      expect(await hostPage.evaluate(() => document.cookie)).not.toContain(cookieName);

      // Concurrent guest joins across 6 distinct browser request contexts (host + 4 succeed = 5 max, 2 fail 409 ROOM_FULL)
      const inviteLink = `/join/${roomCode.slice(0, 3).toLowerCase()}-${roomCode
        .slice(3)
        .toLowerCase()}`;

      const joinResults = await Promise.all(
        guestContexts.map(async (ctx, idx) => {
          const res = await ctx.request.post("/api/rooms/join", {
            headers: {
              origin,
              "content-type": "application/json",
            },
            data: {
              inviteLink,
              displayName: `Guest ${idx + 2}`,
            },
          });
          return {
            status: res.status(),
            body: await res.json(),
            setCookie: res.headers()["set-cookie"] ?? "",
          };
        })
      );

      const accepted = joinResults.filter((r) => r.status === 200);
      const rejected = joinResults.filter((r) => r.status === 409);
      expect(accepted).toHaveLength(4);
      expect(rejected).toHaveLength(2);
      for (const fail of rejected) {
        expect(fail.body.error).toBe("ROOM_FULL");
        expect(fail.setCookie).toBe("");
      }

      // Host fetches authenticated snapshot via HttpOnly cookie and observes exact 5/5 capacity
      const snapshotRes = await hostPage.evaluate(async (rid: string) => {
        const res = await fetch(`/api/rooms/${rid}`);
        return { status: res.status, body: await res.json() };
      }, roomId);
      expect(snapshotRes.status).toBe(200);
      expect(snapshotRes.body.room.participantCount).toBe(5);
      expect(snapshotRes.body.room.canStart).toBe(true);

      // Invalid code check over live HTTP
      const invalidRes = await hostPage.evaluate(async () => {
        const res = await fetch("/api/rooms/join", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code: "000-000" }),
        });
        return { status: res.status, body: await res.json() };
      });
      expect(invalidRes.status).toBe(400);
      expect(invalidRes.body.error).toBe("INVALID_ROOM_CODE");
    } finally {
      await hostContext.close();
      await Promise.all(guestContexts.map((c) => c.close()));
    }
  });
});
