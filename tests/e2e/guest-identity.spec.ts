import { expect, test } from "@playwright/test";

test.describe("CINE-013: Anonymous Guest Identity Two-Browser-Context E2E", () => {
  test("maintains isolated HttpOnly room capabilities, safe rejoin, host privilege enforcement, and rotation across two browser contexts", async ({
    browser,
  }) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();

    try {
      const hostPage = await hostContext.newPage();
      const guestPage = await guestContext.newPage();

      await hostPage.goto("/");
      await guestPage.goto("/");

      // 1. Browser Context 1 creates an anonymous room as HOST (no login required)
      const created = await hostPage.evaluate(async () => {
        const res = await fetch("/api/guest/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ displayName: "BrowserHost" }),
        });
        return { status: res.status, body: await res.json() };
      });

      expect(created.status).toBe(201);
      expect(created.body.role).toBe("HOST");
      expect(created.body.capabilities.isHost).toBe(true);
      const roomId: string = created.body.roomId;
      const roomCode: string = created.body.roomCode;
      const cookieName = `cm_guest_${roomId}`;

      // Verify HttpOnly cookie is present in browser jar but inaccessible from document.cookie JS
      const hostCookies = await hostContext.cookies();
      const hostRoomCookie = hostCookies.find((c) => c.name === cookieName);
      expect(hostRoomCookie).toBeDefined();
      expect(hostRoomCookie?.httpOnly).toBe(true);
      expect(hostRoomCookie?.sameSite).toBe("Lax");

      const hostDocumentCookie = await hostPage.evaluate(() => document.cookie);
      expect(hostDocumentCookie).not.toContain(cookieName);

      // 2. Refresh Browser Context 1 and confirm server session identity & role persist via HttpOnly cookie
      await hostPage.reload();
      const hostAfterReload = await hostPage.evaluate(async (rid: string) => {
        const res = await fetch(`/api/guest/session?roomId=${rid}`);
        return { status: res.status, body: await res.json() };
      }, roomId);
      expect(hostAfterReload.status).toBe(200);
      expect(hostAfterReload.body.participantId).toBe(created.body.participantId);
      expect(hostAfterReload.body.role).toBe("HOST");

      // 3. Browser Context 2 joins the same room, attempting to spoof host participantId & HOST role
      const joined = await guestPage.evaluate(
        async (params: { code: string; spoofParticipantId: string }) => {
          const res = await fetch("/api/guest/session", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              roomCode: params.code,
              participantId: params.spoofParticipantId,
              role: "HOST",
              displayName: "BrowserGuest",
            }),
          });
          return { status: res.status, body: await res.json() };
        },
        { code: roomCode, spoofParticipantId: created.body.participantId }
      );

      expect(joined.status).toBe(201);
      expect(joined.body.roomId).toBe(roomId);
      expect(joined.body.participantId).not.toBe(created.body.participantId);
      expect(joined.body.role).toBe("MEMBER");
      expect(joined.body.participantCount).toBe(2);

      // Verify Browser Context 2 cookie is also HttpOnly and isolated from JS
      const guestCookies = await guestContext.cookies();
      const guestRoomCookie = guestCookies.find((c) => c.name === cookieName);
      expect(guestRoomCookie).toBeDefined();
      expect(guestRoomCookie?.httpOnly).toBe(true);
      expect(guestRoomCookie?.value).not.toBe(hostRoomCookie?.value);

      // 4. Server enforces host-only capability check: Context 2 gets 403, Context 1 gets 200
      const guestHostCheck = await guestPage.evaluate(async (rid: string) => {
        const res = await fetch("/api/guest/host-check", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ roomId: rid }),
        });
        return { status: res.status, body: await res.json() };
      }, roomId);
      expect(guestHostCheck.status).toBe(403);
      expect(guestHostCheck.body.error).toBe("HOST_ONLY_ACTION");

      const hostCheck = await hostPage.evaluate(async (rid: string) => {
        const res = await fetch("/api/guest/host-check", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ roomId: rid }),
        });
        return { status: res.status, body: await res.json() };
      }, roomId);
      expect(hostCheck.status).toBe(200);
      expect(hostCheck.body.authorized).toBe(true);

      // 5. Rotate host capability in Context 1 and confirm rotated HttpOnly cookie works across reload
      const preRotateCookieValue = hostRoomCookie?.value;
      const rotated = await hostPage.evaluate(async (rid: string) => {
        const res = await fetch("/api/guest/session/rotate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ roomId: rid }),
        });
        return { status: res.status, body: await res.json() };
      }, roomId);
      expect(rotated.status).toBe(200);
      expect(rotated.body.generation).toBe(2);
      expect(rotated.body.participantId).toBe(created.body.participantId);

      const postRotateCookies = await hostContext.cookies();
      const postRotateRoomCookie = postRotateCookies.find((c) => c.name === cookieName);
      expect(postRotateRoomCookie?.value).toBeDefined();
      expect(postRotateRoomCookie?.value).not.toBe(preRotateCookieValue);

      await hostPage.reload();
      const verifiedRotated = await hostPage.evaluate(async (rid: string) => {
        const res = await fetch(`/api/guest/session?roomId=${rid}`);
        return { status: res.status, body: await res.json() };
      }, roomId);
      expect(verifiedRotated.status).toBe(200);
      expect(verifiedRotated.body.generation).toBe(2);
      expect(verifiedRotated.body.role).toBe("HOST");
    } finally {
      await hostContext.close();
      await guestContext.close();
    }
  });
});
