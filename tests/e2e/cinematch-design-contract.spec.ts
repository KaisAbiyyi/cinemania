import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const SCREEN_STATES = [
  "create",
  "join",
  "lobby",
  "swipe",
  "vote-wait",
  "match",
  "no-match",
  "error",
  "offline",
] as const;

const VIEWPORTS = [
  { name: "mobile-375", width: 375, height: 812 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1440", width: 1440, height: 900 },
] as const;

const ARTIFACT_DIR = path.join(process.cwd(), "docs", "artifacts", "CINE-022");

test.describe("CINE-022: CineMatch Visual Direction & Interaction Contract", () => {
  test.beforeAll(() => {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  });

  test("renders all 9 screen states cleanly with zero overflow and >= 44px touch targets at 375px, 768px, and 1440px", async ({
    page,
  }) => {
    const runtimeErrors: string[] = [];
    page.on("pageerror", (err) => runtimeErrors.push(`pageerror: ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") runtimeErrors.push(`console.error: ${msg.text()}`);
    });
    page.on("response", (res) => {
      if (res.status() >= 400) {
        runtimeErrors.push(`http_${res.status()}: ${res.url()}`);
      }
    });

    for (const vp of VIEWPORTS) {
      await test.step(`Verify viewport ${vp.name} (${vp.width}x${vp.height})`, async () => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        const response = await page.goto("/cinematch", { waitUntil: "networkidle" });
        expect(response?.status()).toBe(200);

        const studio = page.getByTestId("cinematch-contract-studio");
        await expect(studio).toBeVisible();

        for (const stateId of SCREEN_STATES) {
          const tab = page.locator(`#cm-tab-${stateId}`);
          await tab.click();
          const stage = page.getByTestId(`cm-stage-${stateId}`);
          await expect(stage).toBeVisible();

          // Assert zero horizontal overflow on document and studio container
          const overflowMetrics = await page.evaluate(() => {
            const docEl = document.documentElement;
            const mainEl = document.querySelector("main");
            return {
              docScrollWidth: docEl.scrollWidth,
              docClientWidth: docEl.clientWidth,
              mainScrollWidth: mainEl ? mainEl.scrollWidth : 0,
              mainClientWidth: mainEl ? mainEl.clientWidth : 0,
            };
          });

          expect(
            overflowMetrics.docScrollWidth,
            `Document horizontal overflow at ${vp.name} / state=${stateId}`
          ).toBeLessThanOrEqual(overflowMetrics.docClientWidth);
          expect(
            overflowMetrics.mainScrollWidth,
            `Main container horizontal overflow at ${vp.name} / state=${stateId}`
          ).toBeLessThanOrEqual(overflowMetrics.mainClientWidth + 1);

          // Verify interactive buttons inside active stage meet >= 44px minimum target height
          const stageButtonHeights = await stage.locator("button:visible").evaluateAll((els) =>
            els.map((el) => ({
              text: (el.textContent ?? "").trim(),
              height: Math.round(el.getBoundingClientRect().height),
            }))
          );
          for (const btn of stageButtonHeights) {
            expect(
              btn.height,
              `Button "${btn.text}" in ${stateId} at ${vp.name} must be >= 44px`
            ).toBeGreaterThanOrEqual(44);
          }
        }

        // Capture settled screenshots for key interactive states at each breakpoint
        await page.locator("#cm-tab-lobby").click();
        await expect(page.locator("#cm-tab-lobby")).toHaveAttribute("aria-selected", "true");
        const lobbyStage = page.getByTestId("cm-stage-lobby");
        await expect(lobbyStage).toBeVisible();
        await lobbyStage.scrollIntoViewIfNeeded();
        await lobbyStage.screenshot({
          path: path.join(ARTIFACT_DIR, `cinematch-${vp.name}-lobby.png`),
          animations: "disabled",
        });

        await page.locator("#cm-tab-swipe").click();
        await expect(page.locator("#cm-tab-swipe")).toHaveAttribute("aria-selected", "true");
        const swipeStage = page.getByTestId("cm-stage-swipe");
        await expect(swipeStage).toBeVisible();
        await swipeStage.scrollIntoViewIfNeeded();
        await swipeStage.screenshot({
          path: path.join(ARTIFACT_DIR, `cinematch-${vp.name}-swipe.png`),
          animations: "disabled",
        });

        await page.locator("#cm-tab-match").click();
        await expect(page.locator("#cm-tab-match")).toHaveAttribute("aria-selected", "true");
        const matchStage = page.getByTestId("cm-stage-match");
        await expect(matchStage).toBeVisible();
        await matchStage.scrollIntoViewIfNeeded();
        await matchStage.screenshot({
          path: path.join(ARTIFACT_DIR, `cinematch-${vp.name}-match.png`),
          animations: "disabled",
        });

        if (vp.name === "desktop-1440") {
          // Verify Velvet Screening Room (dark mode) swipe stage rendering
          await page.getByRole("button", { name: /toggle theme/i }).click();
          await page.getByRole("menuitem", { name: "Dark" }).click();
          await expect(page.locator("html")).toHaveClass(/dark/);
          await page.locator("#cm-tab-swipe").click();
          await expect(page.locator("#cm-tab-swipe")).toHaveAttribute("aria-selected", "true");
          await page.screenshot({
            path: path.join(ARTIFACT_DIR, `cinematch-${vp.name}-swipe-dark.png`),
            fullPage: false,
            animations: "disabled",
          });
        }
      });
    }

    expect(runtimeErrors).toEqual([]);
  });

  test("honors prefers-reduced-motion: reduce and supports keyboard tab-order & swipe shortcuts", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/cinematch", { waitUntil: "networkidle" });

    // Switch to Match state and verify glow animation is disabled under prefers-reduced-motion
    await page.locator("#cm-tab-match").click();
    const matchCard = page.getByTestId("cm-stage-match").locator("article.cm-match-glow");
    await expect(matchCard).toBeVisible();

    const reducedStyles = await matchCard.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return {
        animationName: style.animationName,
        transitionDuration: style.transitionDuration,
      };
    });
    expect(reducedStyles.animationName).toBe("none");
    expect(parseFloat(reducedStyles.transitionDuration)).toBeLessThanOrEqual(0.001);

    // Keyboard walkthrough: WAI-ARIA roving tabindex & ArrowRight/ArrowLeft/Home/End across tablist
    const matchTab = page.locator("#cm-tab-match");
    const createTab = page.locator("#cm-tab-create");
    const joinTab = page.locator("#cm-tab-join");
    const offlineTab = page.locator("#cm-tab-offline");

    // Currently on Match tab from reduced-motion check above
    await expect(matchTab).toHaveAttribute("tabindex", "0");
    await expect(createTab).toHaveAttribute("tabindex", "-1");
    await matchTab.focus();
    await expect(matchTab).toBeFocused();

    // Home jumps to first tab (Create)
    await page.keyboard.press("Home");
    await expect(createTab).toBeFocused();
    await expect(createTab).toHaveAttribute("aria-selected", "true");
    await expect(createTab).toHaveAttribute("tabindex", "0");
    await expect(matchTab).toHaveAttribute("tabindex", "-1");
    await expect(joinTab).toHaveAttribute("tabindex", "-1");

    // ArrowRight advances to Join
    await page.keyboard.press("ArrowRight");
    await expect(joinTab).toBeFocused();
    await expect(joinTab).toHaveAttribute("aria-selected", "true");
    await expect(joinTab).toHaveAttribute("tabindex", "0");
    await expect(createTab).toHaveAttribute("tabindex", "-1");
    await expect(page.getByTestId("cm-stage-join")).toBeVisible();

    // End jumps to last tab (Offline)
    await page.keyboard.press("End");
    await expect(offlineTab).toBeFocused();
    await expect(offlineTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("cm-stage-offline")).toBeVisible();

    // ArrowRight wraps from last tab (Offline) back to first tab (Create), ArrowLeft wraps back to Offline
    await page.keyboard.press("ArrowRight");
    await expect(createTab).toBeFocused();
    await expect(createTab).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("ArrowLeft");
    await expect(offlineTab).toBeFocused();
    await expect(offlineTab).toHaveAttribute("aria-selected", "true");

    // Navigate via ArrowRight/click to Swipe stage and verify ArrowRight -> LIKE
    const swipeTab = page.locator("#cm-tab-swipe");
    await swipeTab.click();
    await expect(page.getByTestId("cm-stage-swipe")).toBeVisible();

    // Tab forward until reaching the active swipe deck region, then press ArrowRight
    const swipeDeckRegion = page
      .getByTestId("cm-stage-swipe")
      .locator('[aria-label*="Active movie voting deck"]');
    await swipeDeckRegion.focus();
    await expect(swipeDeckRegion).toBeFocused();
    await page.keyboard.press("ArrowRight");

    const liveFeedback = page
      .getByTestId("cm-stage-swipe")
      .locator('[role="status"]')
      .filter({ hasText: "Recorded intent LIKE" });
    await expect(liveFeedback).toBeVisible();

    // Verify Error state uses scoped role="alert" distinct from #__next-route-announcer__
    await page.locator("#cm-tab-error").click();
    const scopedAlert = page.locator('[role="alert"]:not(#__next-route-announcer__)');
    await expect(scopedAlert).toBeVisible();
    await expect(scopedAlert).toContainText("RATE_LIMITED");
  });

  test("handles real clipboard success and rejection accurately in Lobby RoomCodeChip and Match Copy Match Title", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    // Stub clipboard cleanly before navigation to assert real writeText calls and rejection handling
    await page.addInitScript(() => {
      const state = { shouldReject: false, copied: [] as string[] };
      (window as unknown as { __cmClipboardTest: typeof state }).__cmClipboardTest = state;
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            if (state.shouldReject) {
              throw new Error("Clipboard rejected in test");
            }
            state.copied.push(text);
          },
        },
      });
    });

    await page.goto("/cinematch", { waitUntil: "networkidle" });

    // 1. Lobby RoomCodeChip: success then rejection
    await page.locator("#cm-tab-lobby").click();
    await page.getByRole("button", { name: /^Copy Code$/i }).click();
    await expect(page.getByRole("button", { name: /Code Copied/i })).toBeVisible();

    await page.evaluate(() => {
      (window as unknown as { __cmClipboardTest: { shouldReject: boolean } }).__cmClipboardTest.shouldReject = true;
    });
    await page.getByRole("button", { name: /^Copy Invite Link$/i }).click();
    const copyError = page.getByTestId("cm-copy-error");
    await expect(copyError).toBeVisible();
    await expect(copyError).toContainText("Clipboard permission was denied.");
    await expect(page.getByRole("button", { name: /Invite Copied/i })).toHaveCount(0);

    // 2. Match Copy Match Title: rejection then success
    await page.locator("#cm-tab-match").click();
    await page.getByRole("button", { name: /Copy Match Title/i }).click();
    const matchShareError = page.getByTestId("cm-match-share-error");
    await expect(matchShareError).toBeVisible();
    await expect(matchShareError).toContainText("Movie Night Match: Inception (2010)");
    await expect(page.getByRole("button", { name: /Match Title Copied/i })).toHaveCount(0);

    await page.evaluate(() => {
      (window as unknown as { __cmClipboardTest: { shouldReject: boolean } }).__cmClipboardTest.shouldReject = false;
    });
    await page.getByRole("button", { name: /Copy Match Title/i }).click();
    await expect(page.getByTestId("cm-match-share-success")).toBeVisible();
    await expect(page.getByRole("button", { name: /Match Title Copied/i })).toBeVisible();

    const copiedTexts = await page.evaluate(
      () => (window as unknown as { __cmClipboardTest: { copied: string[] } }).__cmClipboardTest.copied
    );
    expect(copiedTexts).toEqual(["CNM482", "Movie Night Match: Inception (2010)"]);
  });
});
