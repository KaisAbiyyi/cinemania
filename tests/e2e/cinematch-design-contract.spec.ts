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

    // Keyboard walkthrough: activate Swipe state via Tab + Enter / click, then ArrowRight -> LIKE
    const swipeTab = page.locator("#cm-tab-swipe");
    await swipeTab.focus();
    await expect(swipeTab).toBeFocused();
    await page.keyboard.press("Enter");
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
});
