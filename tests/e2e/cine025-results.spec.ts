import { expect, test, type BrowserContext } from "@playwright/test";

const ROOM_ID = "7e1249e6-a564-45c8-91fb-1a1dada1bd12";
const ROUND_ID = "f99371e1-d5c8-4e1a-adb6-6c6ac7653f6b";
const PATH = `/cinematch/result/${ROOM_ID}`;
const CANDIDATE = {
  candidateId: "c1",
  position: 0,
  movieId: 27205,
  title: "Inception",
  releaseDate: "2010-07-16",
  posterPath: null,
  posterUrl: null,
  overview: "A team explores dreams.",
  voteAverage: 8.2,
};

type Phase = "MATCHED" | "EXHAUSTED" | "ACTIVE" | "LOBBY" | "EXPIRED";

function fixture(
  phase: Phase,
  role: "HOST" | "MEMBER" = "HOST",
  version = 11
) {
  const code =
    phase === "MATCHED" ? "MATCH_FOUND" :
    phase === "EXHAUSTED" ? "DECK_EXHAUSTED" :
    phase === "EXPIRED" ? "ROOM_EXPIRED" :
    phase === "ACTIVE" ? "ROUND_ACTIVE" : "LOBBY_READY";
  return {
    room: {
      roomId: ROOM_ID,
      code: "ABC123",
      status: phase,
      stateVersion: version,
      currentRoundId: ROUND_ID,
      deckSize: 20,
      matchedMovieId: phase === "MATCHED" ? CANDIDATE.movieId : null,
      matchedCandidate: phase === "MATCHED" ? CANDIDATE : null,
      canRetry: phase === "EXHAUSTED",
      finishState: {
        code,
        status: phase,
        message: phase === "EXPIRED" ? "Room expired and cannot be rejoined." : "Room state confirmed.",
        matchedMovieId: phase === "MATCHED" ? CANDIDATE.movieId : null,
        retryAvailable: phase === "EXHAUSTED",
      },
    },
    viewer: {
      participantId: "PRIVATE_PARTICIPANT_TOKEN_NOT_SHAREABLE",
      displayName: "Test Guest",
      role,
      canRetry: role === "HOST" && phase === "EXHAUSTED",
    },
  };
}

async function mockRoom(
  context: BrowserContext,
  current: () => ReturnType<typeof fixture>,
  onRetry?: (input: Record<string, unknown>) => void
) {
  await context.route(`**/api/rooms/${ROOM_ID}**`, async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.url().endsWith("/retry")) {
      const input = request.postDataJSON() as Record<string, unknown>;
      onRetry?.(input);
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "cache-control": "no-store" },
      body: JSON.stringify(current()),
    });
  });
}

test.describe("CINE-025 private result UI (seeded, browser-level transport fixtures)", () => {
  for (const phase of ["MATCHED", "EXHAUSTED"] as const) {
    test(`finished voting screen navigates to authenticated ${phase} result without local match inference`, async ({ page, context }) => {
      const canonical = fixture(phase);
      await context.route(`**/api/rooms/${ROOM_ID}**`, async (route) => {
        if (route.request().method() !== "GET" || new URL(route.request().url()).pathname !== `/api/rooms/${ROOM_ID}`) {
          await route.continue();
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "cache-control": "no-store" },
          body: JSON.stringify({
            room: { ...canonical.room, participants: [], currentCandidate: null },
            viewer: { ...canonical.viewer, isEligibleVoter: true, userVotes: {}, nextCandidateIndex: null },
          }),
        });
      });
      await page.goto(`/cinematch/vote/${ROOM_ID}`);
      await expect(page.getByTestId("cine026-open-result")).toBeVisible();
      await page.getByTestId("cine026-open-result").click();
      await expect(page).toHaveURL(PATH);
      await expect(page.getByTestId(phase === "MATCHED" ? "cine025-match" : "cine025-no-match")).toBeVisible();
    });
  }

  for (const phase of ["MATCHED", "EXHAUSTED"] as const) {
    test(`five independent clients converge on server ${phase} without client match inference`, async ({ browser }) => {
      const contexts: BrowserContext[] = [];
      try {
        for (let i = 0; i < 5; i++) {
          const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
          contexts.push(context);
          await mockRoom(context, () => fixture(phase, i === 0 ? "HOST" : "MEMBER"));
          const page = await context.newPage();
          const response = await page.goto(PATH);
          expect(response?.status()).toBe(200);
          await expect(page.getByTestId(phase === "MATCHED" ? "cine025-match" : "cine025-no-match")).toBeVisible();
          if (phase === "MATCHED") {
            await expect(page.getByRole("heading", { name: "Inception" })).toBeVisible();
            await expect(page.getByText("Streaming availability has not been verified.")).toBeVisible();
          } else {
            await expect(page.getByTestId("cine025-match")).toHaveCount(0);
            await expect(page.getByTestId("cine025-start-fresh")).toHaveCount(i === 0 ? 1 : 0);
          }
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
            .toBe(true);
        }
      } finally {
        await Promise.all(contexts.map((context) => context.close()));
      }
    });
  }

  test("duplicate/reordered snapshot and refresh never replay match reveal", async ({ page, context }) => {
    let activeVersion = 12;
    await mockRoom(context, () => fixture("MATCHED", "HOST", activeVersion));
    await page.goto(PATH);
    await expect(page.getByText("Server-confirmed state v12")).toBeVisible();
    await expect(page.getByTestId("cine025-reveal")).toHaveAttribute("data-reveal-once", "true");

    activeVersion = 8; // stale delivery; strictly reject, even if transport reorders hints
    await page.getByTestId("cine025-resync").click();
    await expect(page.getByText("Server-confirmed state v12")).toBeVisible();

    activeVersion = 12;
    await page.reload();
    await expect(page.getByTestId("cine025-match")).toBeVisible();
    await expect(page.getByTestId("cine025-reveal")).toHaveAttribute("data-reveal-once", "false");
  });

  test("host can safely retry a non-unanimous round; guests cannot", async ({ browser }) => {
    let phase: Phase = "EXHAUSTED";
    const operationIds: string[] = [];
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    try {
      await mockRoom(hostContext, () => fixture(phase, "HOST", phase === "EXHAUSTED" ? 11 : 12), (data) => {
        expect(data.startRound).toBe(true);
        expect(typeof data.operationId).toBe("string");
        operationIds.push(String(data.operationId));
        phase = "ACTIVE";
      });
      await mockRoom(guestContext, () => fixture("EXHAUSTED", "MEMBER"));
      const host = await hostContext.newPage();
      const guest = await guestContext.newPage();
      await Promise.all([host.goto(PATH), guest.goto(PATH)]);
      await expect(guest.getByTestId("cine025-start-fresh")).toHaveCount(0);
      await host.getByTestId("cine025-start-fresh").click();
      await expect(host.getByTestId("cine025-not-finished")).toBeVisible();
      expect(operationIds).toHaveLength(1);
      expect(operationIds[0]).toContain(ROUND_ID);
    } finally {
      await hostContext.close();
      await guestContext.close();
    }
  });

  test("a dropped retry request is surfaced and recovery reuses its operation ID", async ({ page, context }) => {
    let phase: Phase = "EXHAUSTED";
    const operationIds: string[] = [];
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await mockRoom(context, () => fixture(phase, "HOST", phase === "EXHAUSTED" ? 11 : 12));
    await context.route(`**/api/rooms/${ROOM_ID}/retry`, async (route) => {
      const request = route.request().postDataJSON() as Record<string, unknown>;
      operationIds.push(String(request.operationId));
      if (operationIds.length <= 4) {
        await route.abort("failed");
        return;
      }
      phase = "ACTIVE";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(fixture("ACTIVE", "HOST", 12)),
      });
    });

    await page.goto(PATH);
    await page.getByTestId("cine025-start-fresh").click();
    const warning = page.getByTestId("cine025-error");
    await expect(warning).toContainText("The connection was interrupted.");
    await expect(warning).toContainText("same operation ID");
    await expect(page.getByTestId("cine025-start-fresh")).toBeEnabled();
    expect(operationIds).toHaveLength(4);

    await page.getByTestId("cine025-start-fresh").click();
    await expect(page.getByTestId("cine025-not-finished")).toBeVisible();
    expect(new Set(operationIds).size).toBe(1);
    expect(pageErrors).toEqual([]);
  });

  test("a committed retry with unreadable response is recovered by authoritative resync", async ({ page, context }) => {
    let phase: Phase = "EXHAUSTED";
    const operationIds: string[] = [];
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await mockRoom(context, () => fixture(phase, "HOST", phase === "EXHAUSTED" ? 11 : 12));
    await context.route(`**/api/rooms/${ROOM_ID}/retry`, async (route) => {
      const request = route.request().postDataJSON() as Record<string, unknown>;
      operationIds.push(String(request.operationId));
      // The server committed the transition, but all idempotent replies were corrupted.
      phase = "ACTIVE";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "unreadable-json",
      });
    });

    await page.goto(PATH);
    await page.getByTestId("cine025-start-fresh").click();
    await expect(page.getByTestId("cine025-not-finished")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Room state changed after the retry." })).toBeVisible();
    await expect(page.getByTestId("cine025-error")).toHaveCount(0);
    expect(operationIds).toHaveLength(4);
    expect(new Set(operationIds).size).toBe(1);
    expect(pageErrors).toEqual([]);
  });

  test("clipboard rejection exposes only manually copyable title/year", async ({ page, context }) => {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async () => { throw new Error("denied"); } },
      });
    });
    await mockRoom(context, () => fixture("MATCHED"));
    await page.goto(PATH);
    await page.getByTestId("cine025-copy-match").click();
    const alert = page.getByTestId("cine025-copy-failure");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("CineMatch Movie Night: Inception (2010)");
    await expect(alert).not.toContainText("PRIVATE_PARTICIPANT_TOKEN");
    await expect(alert).not.toContainText(ROOM_ID);
  });

  test("HTTP 410 produces an explicit expired state and never leaks prior results", async ({ page, context }) => {
    await context.route(`**/api/rooms/${ROOM_ID}`, (route) => route.fulfill({
      status: 410,
      contentType: "application/json",
      body: JSON.stringify({ error: "ROOM_EXPIRED" }),
    }));
    await page.goto(PATH);
    await expect(page.getByRole("heading", { name: "Room expired" })).toBeVisible();
    await expect(page.getByTestId("cine025-match")).toHaveCount(0);
    await expect(page.getByTestId("cine025-start-fresh")).toHaveCount(0);
  });

  test("keyboard and reduced motion remain usable at mobile width", async ({ page, context }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockRoom(context, () => fixture("MATCHED"));
    await page.goto(PATH);
    await expect(page.getByTestId("cine025-match")).toBeVisible();
    const poster = page.getByTestId("cine025-reveal").locator("article");
    await expect(poster).toBeVisible();
    expect(await poster.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
    await page.getByTestId("cine025-copy-match").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("cine025-copy-match")).toBeVisible();
    const buttonHeight = await page.getByTestId("cine025-copy-match").evaluate((element) => element.getBoundingClientRect().height);
    expect(buttonHeight).toBeGreaterThanOrEqual(44);
  });
});
