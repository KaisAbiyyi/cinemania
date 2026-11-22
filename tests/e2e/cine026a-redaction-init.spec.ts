import { expect, test } from "@playwright/test";
import { REDACTION_INIT_SCRIPT, REDACTION_STYLE_ID } from "./helpers/cine026a-realtime-evidence";

/**
 * CINE-026-A privacy regression. The hosted spec records video of rooms whose code is shown on screen, so the
 * blur style must be installed before that UI is painted. The first version of the redaction script observed
 * `document.documentElement` (null at init time), threw, and therefore never blurred anything; in WebKit the throw
 * also disabled every later init script (Firefox exposes documentElement at init time, so it was unaffected). This runs in all three engines without any room or join request.
 */
const PAGE = "/join/ABC234";
type Probe = { __laterHook?: boolean; __cmRedactionError?: string };

test.describe("CINE-026-A redaction init script", () => {
  test("installs before sensitive UI, blurs both selectors, never throws, and leaves later init scripts running", async ({ browser }) => {
    const context = await browser.newContext();
    try {
      await context.addInitScript({ content: REDACTION_INIT_SCRIPT });
      await context.addInitScript({ content: "window.__laterHook = true;" });
      const page = await context.newPage();
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.goto(PAGE);
      await expect(page.locator("#" + REDACTION_STYLE_ID)).toBeAttached();
      expect(await page.evaluate(() => (window as unknown as Probe).__laterHook), "a later init script must still run (WebKit bootstrap)").toBe(true);
      expect(await page.evaluate(() => (window as unknown as Probe).__cmRedactionError ?? null)).toBeNull();
      await page.evaluate(() => {
        document.body.insertAdjacentHTML("beforeend", '<p data-testid="cm-room-code">ABC234</p><section data-testid="cine024-voting-panel"><header><p id="header-code">Room ABC234</p></header></section>');
      });
      const filters = await page.evaluate(() => [
        getComputedStyle(document.querySelector('[data-testid="cm-room-code"]')!).filter,
        getComputedStyle(document.getElementById("header-code")!).filter,
      ]);
      expect(filters.every((filter) => filter.includes("blur"))).toBe(true);
      expect(pageErrors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("the real lobby room-code chip is blurred in the rendered page", async ({ browser }) => {
    const ORIGIN = "http://127.0.0.1:3055";
    const context = await browser.newContext();
    try {
      await context.addInitScript({ content: REDACTION_INIT_SCRIPT });
      const created = await context.request.post(`${ORIGIN}/api/rooms`, { headers: { origin: ORIGIN }, data: { displayName: "c026a-redact" } });
      expect(created.status()).toBe(201);
      const roomId = (await created.json()).room.roomId as string;
      const page = await context.newPage();
      await page.goto(`/cinematch/room/${roomId}`);
      const chip = page.getByTestId("cm-room-code");
      await expect(chip).toBeVisible();
      expect(await chip.evaluate((element) => getComputedStyle(element).filter)).toContain("blur");
      expect(await page.evaluate(() => (window as unknown as Probe).__cmRedactionError ?? null)).toBeNull();
    } finally {
      await context.close();
    }
  });

  test("negative control: the pre-fix script shape never installed the style in Chromium and WebKit", async ({ browser, browserName }) => {
    const context = await browser.newContext();
    try {
      await context.addInitScript(() => {
        const redact = () => {
          if (!document.head || document.getElementById("cine026-video-redaction")) return;
          const style = document.createElement("style");
          style.id = "cine026-video-redaction";
          document.head.append(style);
        };
        new MutationObserver(redact).observe(document.documentElement, { childList: true, subtree: true });
        redact();
      });
      const page = await context.newPage();
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.goto(PAGE);
      // Chromium and WebKit report the init-script TypeError as a page error; Firefox swallows it silently.
      if (browserName !== "firefox") expect(pageErrors.length, "observing a null documentElement must throw").toBeGreaterThan(0);
      // Firefox exposes documentElement at init time, so the old script happened to work there; Chromium and WebKit did not blur.
      await expect(page.locator("#" + REDACTION_STYLE_ID)).toHaveCount(browserName === "firefox" ? 1 : 0);
    } finally {
      await context.close();
    }
  });
});
