import { expect, test, type APIResponse, type Browser, type BrowserContext, type Page, type Response } from "@playwright/test";

/**
 * CINE-026-A — the sixth-player UI rejection must come from the server.
 *
 * Root cause (reproduced in Chromium by delaying the JS chunks, and naturally in WebKit): input typed
 * before React commits hydration is reset to the empty controlled state, so the client-side name
 * check produced INVALID_DISPLAY_NAME without any request; a click before hydration fell through
 * to a native GET submission that put the name and room code in the URL. The form is now locked
 * until hydration commits (RoomEntry useHydrated).
 *
 * Joins share one server-wide rate-limit bucket outside Vercel (30 per 60 s), so setup joins and the
 * UI submission honour the server's Retry-After instead of failing on a 429 from earlier suites.
 */
const ORIGIN = "http://127.0.0.1:3055";

function retryAfterMs(response: { headers(): Record<string, string> }) {
  return Math.min(60000, Math.max(1000, Number(response.headers()["retry-after"] ?? "1") * 1000));
}

async function joinViaApi(context: BrowserContext, code: string, displayName: string): Promise<APIResponse> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await context.request.post(`${ORIGIN}/api/rooms/join`, { headers: { origin: ORIGIN }, data: { code, displayName } });
    if (response.status() !== 429) return response;
    await new Promise((resolve) => setTimeout(resolve, retryAfterMs(response)));
  }
  throw new Error("join stayed rate limited");
}

async function fullRoom(browser: Browser) {
  const host = await browser.newContext();
  const create = await host.request.post(`${ORIGIN}/api/rooms`, { headers: { origin: ORIGIN }, data: { displayName: "c026a-host" } });
  expect(create.status()).toBe(201);
  const code = (await create.json()).room.code as string;
  const contexts: BrowserContext[] = [host];
  for (let index = 2; index <= 5; index += 1) {
    const context = await browser.newContext();
    contexts.push(context);
    expect((await joinViaApi(context, code, `c026a-p${index}`)).status()).toBe(200);
  }
  return { code, contexts };
}

/** Records the POST /api/rooms/join requests the page really sent (provenance), by status and name length. */
function watchJoin(page: Page) {
  const seen: { requests: number; nameLengths: number[]; responses: Response[] } = { requests: 0, nameLengths: [], responses: [] };
  page.on("request", (request) => {
    if (request.method() !== "POST" || new URL(request.url()).pathname !== "/api/rooms/join") return;
    seen.requests += 1;
    seen.nameLengths.push(String((JSON.parse(request.postData() ?? "{}") as { displayName?: string }).displayName ?? "").length);
  });
  page.on("response", (response) => {
    if (response.request().method() === "POST" && new URL(response.url()).pathname === "/api/rooms/join") seen.responses.push(response);
  });
  return seen;
}

/** Clicks submit; if the shared rate limit answers 429, waits the server-directed delay and submits again. */
async function submitUntilAnswered(page: Page, seen: ReturnType<typeof watchJoin>) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const before = seen.responses.length;
    await page.getByTestId("cm-room-submit").click();
    await expect.poll(() => seen.responses.length, { timeout: 15000, message: "the UI never sent POST /api/rooms/join" }).toBeGreaterThan(before);
    const last = seen.responses[seen.responses.length - 1]!;
    if (last.status() !== 429) return last;
    await new Promise((resolve) => setTimeout(resolve, retryAfterMs(last)));
    await expect(page.getByTestId("cm-room-submit")).toBeEnabled();
  }
  throw new Error("join stayed rate limited");
}

test.describe("CINE-026-A join form request provenance", () => {
  // One full room per browser project: setup joins are the scarce rate-limited resource.
  test.describe.configure({ mode: "serial" });
  test.setTimeout(120000);
  let room: Awaited<ReturnType<typeof fullRoom>>;
  test.beforeAll(async ({ browser }) => { room = await fullRoom(browser); });
  test.afterAll(async () => { await Promise.all(room.contexts.map((context) => context.close().catch(() => undefined))); });

  test("sixth member: a real POST is rejected by the server with 409 ROOM_FULL", async ({ browser }) => {
    const sixth = await browser.newContext();
    try {
      const page = await sixth.newPage();
      const seen = watchJoin(page);
      await page.goto("/join/" + room.code);
      const name = page.getByLabel("Your display name");
      await name.fill("c026a-sixth");
      await expect(name).toHaveValue("c026a-sixth");
      const answer = await submitUntilAnswered(page, seen);
      expect(answer.status(), "the server, not the client, must reject the sixth member").toBe(409);
      expect((await answer.json()).error).toBe("ROOM_FULL");
      await expect(page.getByTestId("cm-scoped-alert")).toContainText("ROOM_FULL");
      expect(seen.nameLengths.every((length) => length === "c026a-sixth".length), "every submitted name carried the typed value").toBe(true);
    } finally {
      await sixth.close();
    }
  });

  test("input typed while hydration is delayed is neither lost nor submitted natively", async ({ browser }) => {
    const late = await browser.newContext();
    const page = await late.newPage();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route(/\/_next\/static\/.*\.js/, async (route) => { await gate; await route.continue().catch(() => undefined); });
    const seen = watchJoin(page);
    try {
      await page.goto("/join/" + room.code, { waitUntil: "domcontentloaded" });
      const form = page.getByTestId("cm-room-form");
      await expect(form).toHaveAttribute("data-hydrated", "false");
      const name = page.getByLabel("Your display name");
      await expect(name).toBeDisabled();
      await expect(page.getByTestId("cm-room-submit")).toBeDisabled();
      // fill() waits for the field to become editable, i.e. for hydration to commit.
      const filling = name.fill("c026a-late");
      release();
      await filling;
      await expect(form).toHaveAttribute("data-hydrated", "true");
      await expect(name).toHaveValue("c026a-late");
      const answer = await submitUntilAnswered(page, seen);
      expect(answer.status()).toBe(409);
      await expect(page.getByTestId("cm-scoped-alert")).toContainText("ROOM_FULL");
      expect(new URL(page.url()).search, "no native GET submission may leak the name or room code").toBe("");
    } finally {
      release();
      await late.close().catch(() => undefined);
    }
  });
});
