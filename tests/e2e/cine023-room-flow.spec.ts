import { expect, test, type BrowserContext, type Page } from "@playwright/test";

async function createHost(page: Page, displayName = "Host") {
  await page.goto("/cinematch/room");
  await page.getByLabel("Your display name").fill(displayName);
  await page.getByRole("button", { name: "Create Screening Room" }).click();
  await expect(page).toHaveURL(/\/cinematch\/room\/[a-f0-9-]{36}$/i);
  return (await page.getByTestId("cm-room-code").innerText()).trim();
}

async function joinByLink(page: Page, code: string, displayName: string) {
  await page.goto("/join/" + code);
  await expect(page.getByLabel("Six-character room code or invite link")).toHaveValue(code);
  await page.getByLabel("Your display name").fill(displayName);
  await page.getByRole("button", { name: "Join Screening Room" }).click();
  await expect(page).toHaveURL(/\/cinematch\/room\/[a-f0-9-]{36}$/i);
}

test.describe("CINE-023 real create / invite / lobby workflow", () => {
  test("two distinct browser contexts can join; host-only start and refresh preserve membership", async ({ browser }) => {
    test.setTimeout(90000);
    const contexts: BrowserContext[] = [];
    try {
      const host = await browser.newContext();
      const guest = await browser.newContext();
      contexts.push(host, guest);
      const hostPage = await host.newPage();
      const guestPage = await guest.newPage();
      const code = await createHost(hostPage);
      await expect(hostPage.getByTestId("cm-start-round")).toBeDisabled();
      await joinByLink(guestPage, code, "Guest two");
      await expect(hostPage.getByTestId("cm-participant-count")).toHaveText("2 / 5", { timeout: 20000 });
      await expect(guestPage.getByTestId("cm-participant-count")).toHaveText("2 / 5", { timeout: 20000 });
      await expect(hostPage.getByTestId("cm-start-round")).toBeEnabled({ timeout: 20000 });
      await expect(guestPage.getByTestId("cm-start-round")).toHaveCount(0);
      await expect(guestPage.getByTestId("cm-guest-wait")).toBeVisible();
      await guestPage.reload();
      await expect(guestPage.getByText("Guest two (You)")).toBeVisible({ timeout: 20000 });
      await expect(guestPage.getByTestId("cm-participant-count")).toHaveText("2 / 5");
      await hostPage.getByTestId("cm-start-round").click();
      await expect(hostPage.getByText("Round started. Voting interaction is being delivered separately in CINE-024; room state remains server-authoritative.")).toBeVisible({ timeout: 20000 });
      await expect(guestPage.getByText("Round started. Voting interaction is being delivered separately in CINE-024; room state remains server-authoritative.")).toBeVisible({ timeout: 20000 });
    } finally {
      await Promise.all(contexts.map((c) => c.close()));
    }
  });

  test("all five browser contexts converge on the authoritative roster; sixth join rejected", async ({ browser }) => {
    test.setTimeout(120000);
    const contexts: BrowserContext[] = [];
    try {
      const host = await browser.newContext();
      contexts.push(host);
      const hostPage = await host.newPage();
      const code = await createHost(hostPage, "Host five");
      for (let index = 1; index <= 4; index++) {
        const ctx = await browser.newContext();
        contexts.push(ctx);
        await joinByLink(await ctx.newPage(), code, "Guest " + index);
      }
      await expect(hostPage.getByTestId("cm-participant-count")).toHaveText("5 / 5", { timeout: 25000 });
      for (const ctx of contexts) {
        const page = ctx.pages()[0];
        await expect(page.getByTestId("cm-participant-count")).toHaveText("5 / 5", { timeout: 25000 });
        await expect(page.getByRole("region", { name: "Room participants" }).getByRole("listitem").filter({ hasText: "Guest 4" })).toBeVisible();
      }
      const extra = await browser.newContext();
      contexts.push(extra);
      const extraPage = await extra.newPage();
      await extraPage.goto("/join/" + code);
      await extraPage.getByLabel("Your display name").fill("Guest sixth");
      await extraPage.getByRole("button", { name: "Join Screening Room" }).click();
      await expect(extraPage.getByTestId("cm-scoped-alert")).toContainText("ROOM_FULL");
      await expect(extraPage).toHaveURL(new RegExp("/join/" + code + "$"));
    } finally {
      await Promise.all(contexts.map((c) => c.close()));
    }
  });

  test("invalid code is distinct from loading; expired code from server is actionable", async ({ page }) => {
    await page.goto("/cinematch/room");
    await page.getByRole("button", { name: "Join", exact: true }).click();
    await page.getByLabel("Your display name").fill("Guest invalid");
    await page.getByLabel("Six-character room code or invite link").fill("INVALID");
    await page.getByRole("button", { name: "Join Screening Room" }).click();
    await expect(page.getByTestId("cm-scoped-alert")).toContainText("INVALID_ROOM_CODE");
    await expect(page.getByTestId("cm-room-submit")).toBeEnabled();
    await page.route("**/api/rooms/join", (route) =>
      route.fulfill({
        status: 410,
        contentType: "application/json",
        body: JSON.stringify({ error: "ROOM_EXPIRED", message: "Expired" }),
      })
    );
    await page.getByLabel("Six-character room code or invite link").fill("ABC234");
    await page.getByRole("button", { name: "Join Screening Room" }).click();
    await expect(page.getByTestId("cm-scoped-alert")).toContainText("ROOM_EXPIRED");
    await expect(page.getByTestId("cm-scoped-alert")).toContainText("expired");
  });


  for (const { status, code } of [
    { status: 401, code: "SESSION_REQUIRED" },
    { status: 403, code: "ROOM_FORBIDDEN" },
    { status: 410, code: "ROOM_EXPIRED" },
  ]) {
    test(`revoked membership ${status} clears authorized roster and disables actions on resync`, async ({ page }) => {
      const displayName = "Privacy host " + status;
      await createHost(page, displayName);
      await expect(page.getByRole("region", { name: "Room participants" })).toBeVisible();
      await expect(page.getByText(displayName + " (You)")).toBeVisible();
      await expect(page.getByTestId("cm-room-code")).toBeVisible();
      const roomId = new URL(page.url()).pathname.split("/").at(-1);
      await page.route("**/api/rooms/*", (route) => {
        const request = route.request();
        if (request.method() === "GET" && new URL(request.url()).pathname === "/api/rooms/" + roomId) {
          return route.fulfill({
            status,
            contentType: "application/json",
            body: JSON.stringify({ error: code, message: "Membership no longer valid" }),
          });
        }
        return route.continue();
      });
      await page.getByRole("button", { name: "Refresh snapshot" }).click();
      await expect(page.getByText("Your private room membership has ended.")).toBeVisible();
      await expect(page.getByRole("region", { name: "Room participants" })).toHaveCount(0);
      await expect(page.getByTestId("cm-room-code")).toHaveCount(0);
      await expect(page.getByTestId("cm-start-round")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Share invitation" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Create or join another room" })).toBeVisible();
      await expect(page.getByTestId("cm-scoped-alert")).toBeVisible();
      // An explicit successful re-authorization can restore the room; polling must not do so blindly.
      await page.unroute("**/api/rooms/*");
      await page.getByRole("button", { name: "Refresh snapshot" }).click();
      await expect(page.getByRole("region", { name: "Room participants" })).toBeVisible();
      await expect(page.getByText(displayName + " (You)")).toBeVisible();
    });
  }

  test("mobile keyboard flow has visible controls and no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/cinematch/room");
    await expect(page.getByRole("heading", { name: "Your next movie, chosen together." })).toBeVisible();
    await page.getByLabel("Your display name").focus();
    await page.keyboard.type("Keyboard guest");
    await expect(page.getByLabel("Your display name")).toHaveValue("Keyboard guest");
    await page.getByRole("button", { name: "Join", exact: true }).click();
    await expect(page.getByLabel("Six-character room code or invite link")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const button of await page.getByTestId("cm-room-entry").getByRole("button").all()) {
      const size = await button.boundingBox();
      if (size && size.width > 0) expect(size.height).toBeGreaterThanOrEqual(44);
    }
  });
});
