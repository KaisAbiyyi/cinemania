import { expect, test } from "@playwright/test";

test.describe("CINE-024 — simulated interaction preview (NOT live backend certification)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/cinematch/vote/preview", { waitUntil: "networkidle" });
    await expect(page.getByTestId("cine024-preview")).toContainText("NOT a real room");
    await expect(page.getByTestId("cine024-swipe-region")).toBeVisible();
  });

  test("mouse double-click submits once, waits for server ack and never announces an optimistic match", async ({ page }) => {
    await page.getByRole("combobox", { name: "Ack delay" }).selectOption("1500");
    await page.getByTestId("cine024-like").evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await expect(page.getByTestId("cine024-preview-calls")).toHaveText("Requests: 1");
    await expect(page.getByTestId("cine024-submission")).toContainText("Sending LIKE to server");
    await expect(page.getByTestId("cine024-like")).toBeDisabled();
    await expect(page.getByTestId("cine024-progress")).toContainText("Card 01 / 2");
    await expect(page.getByTestId("cine024-server-phase")).toHaveCount(0);
    await expect(page.getByTestId("cine024-waiting")).toContainText("Your LIKE vote is locked");
    await expect(page.getByTestId("cine024-preview-calls")).toHaveText("Requests: 1");
    // No match can appear until a second voter has provided server-side consensus.
    await expect(page.getByTestId("cine024-server-phase")).toHaveCount(0);
    await page.getByRole("button", { name: "Simulate other voter" }).click();
    await expect(page.getByTestId("cine024-server-phase")).toContainText("Server phase: MATCHED");
  });

  test("keyboard arrows and letter equivalents skip and advance only after authoritative state transition", async ({ page }) => {
    const region = page.getByTestId("cine024-swipe-region");
    await region.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("cine024-waiting")).toContainText("SKIP vote is locked");
    await expect(page.getByTestId("cine024-preview-calls")).toHaveText("Requests: 1");
    await page.getByRole("button", { name: "Simulate other voter" }).click();
    await expect(page.getByTestId("cine024-progress")).toHaveText("Card 02 / 2");
    await region.focus();
    await page.keyboard.press("l");
    await expect(page.getByTestId("cine024-waiting")).toContainText("LIKE vote is locked");
    await expect(page.getByTestId("cine024-preview-calls")).toHaveText("Requests: 2");
  });

  test("touch-style pointer swipe, lost ack retry, and disconnect keep vote intent single-flight", async ({ page }) => {
    await page.getByRole("button", { name: "Toggle disconnect" }).click();
    await expect(page.getByTestId("cine024-like")).toBeDisabled();
    await expect(page.getByTestId("cine024-skip")).toBeDisabled();
    await expect(page.getByTestId("cine024-preview-calls")).toHaveText("Requests: 0");
    await page.getByRole("button", { name: "Toggle disconnect" }).click();

    await page.getByRole("checkbox", { name: "Simulate lost ack" }).check();
    const region = page.getByTestId("cine024-swipe-region");
    await region.dispatchEvent("pointerdown", { pointerId: 44, pointerType: "touch", button: 0, clientX: 320, clientY: 250 });
    await region.dispatchEvent("pointermove", { pointerId: 44, pointerType: "touch", button: 0, clientX: 100, clientY: 250 });
    await region.dispatchEvent("pointerup", { pointerId: 44, pointerType: "touch", button: 0, clientX: 100, clientY: 250 });

    await expect(page.getByTestId("cine024-preview-calls")).toHaveText("Requests: 1");
    await expect(page.getByTestId("cine024-submission")).toContainText("Sending SKIP");
    await expect(page.getByTestId("cine024-submission")).toContainText("outcome is uncertain");
    await expect(page.getByTestId("cine024-skip")).toBeDisabled();

    await page.getByRole("checkbox", { name: "Simulate lost ack" }).uncheck();
    await page.getByRole("button", { name: "Retry same SKIP vote" }).click();
    await expect(page.getByTestId("cine024-preview-calls")).toHaveText("Requests: 2");
    await expect(page.getByTestId("cine024-waiting")).toContainText("SKIP vote is locked");
  });

  test("explicit 429 rejection unlocks only after successful server snapshot resync, then accepts one vote", async ({ page }) => {
    await page.getByRole("checkbox", { name: "Simulate 429 rejection" }).check();
    await page.getByTestId("cine024-like").click();
    await expect(page.getByTestId("cine024-submission")).toContainText("rate-limited");
    await expect(page.getByTestId("cine024-preview-calls")).toHaveText("Requests: 1");
    await expect(page.getByTestId("cine024-like")).toBeDisabled();
    await expect(page.getByTestId("cine024-skip")).toBeDisabled();

    // Failed GET may not authorize any new decision.
    await page.getByRole("checkbox", { name: "Simulate failed resync" }).check();
    await page.getByRole("button", { name: "Resync", exact: true }).click();
    await expect(page.getByTestId("cine024-like")).toBeDisabled();
    await expect(page.getByText("Could not retrieve the latest authoritative room snapshot", { exact: false })).toBeVisible();

    await page.getByRole("checkbox", { name: "Simulate failed resync" }).uncheck();
    await page.getByRole("button", { name: "Resync", exact: true }).click();
    await expect(page.getByTestId("cine024-submission")).toHaveCount(0);
    await expect(page.getByTestId("cine024-skip")).toBeEnabled();

    await page.getByTestId("cine024-skip").evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await expect(page.getByTestId("cine024-preview-calls")).toHaveText("Requests: 2");
    await expect(page.getByTestId("cine024-waiting")).toContainText("SKIP vote is locked");
  });

  test("a resynced server-recorded vote is never unlocked or submitted again", async ({ page }) => {
    await page.getByRole("checkbox", { name: "Simulate 429 rejection" }).check();
    await page.getByTestId("cine024-like").click();
    await expect(page.getByTestId("cine024-submission")).toContainText("rate-limited");
    await page.getByRole("checkbox", { name: "Server recorded vote on resync" }).check();
    await page.getByRole("button", { name: "Resync", exact: true }).click();
    await expect(page.getByTestId("cine024-waiting")).toContainText("LIKE vote is locked");
    await expect(page.getByTestId("cine024-preview-calls")).toHaveText("Requests: 1");
    await expect(page.getByTestId("cine024-like")).toHaveCount(0);
    await expect(page.getByTestId("cine024-skip")).toHaveCount(0);
  });

  test("definitive 403 permission denial cannot be unlocked by an unchanged room snapshot", async ({ page }) => {
    await page.getByRole("checkbox", { name: "Simulate 403 denial" }).check();
    await page.getByTestId("cine024-like").click();
    await expect(page.getByTestId("cine024-submission")).toContainText("Vote rejected by server");
    await expect(page.getByTestId("cine024-preview-calls")).toHaveText("Requests: 1");
    await page.getByRole("button", { name: "Resync", exact: true }).click();
    await expect(page.getByTestId("cine024-like")).toBeDisabled();
    await expect(page.getByTestId("cine024-preview-calls")).toHaveText("Requests: 1");
  });

  test("reduced motion, screen-reader labels, minimum 44px targets and mobile overflow", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 375, height: 812 });
    const region = page.getByRole("group", { name: /Active movie voting deck/i });
    await expect(region).toBeVisible();
    await expect(page.getByRole("group", { name: "Choose a movie vote" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Skip Film" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Like Film" })).toBeVisible();
    await region.dispatchEvent("pointerdown", { pointerId: 5, pointerType: "touch", button: 0, clientX: 320, clientY: 250 });
    await region.dispatchEvent("pointermove", { pointerId: 5, pointerType: "touch", button: 0, clientX: 90, clientY: 250 });
    const card = region.locator("article.cm-motion-surface");
    await expect(card).toBeVisible();
    const metrics = await card.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return { transition: parseFloat(style.transitionDuration), transform: style.transform };
    });
    expect(metrics.transition).toBeLessThanOrEqual(0.001);
    expect(metrics.transform).toBe("none");
    await region.dispatchEvent("pointercancel", { pointerId: 5, pointerType: "touch" });

    const heights = await page.locator('[data-testid="cine024-like"], [data-testid="cine024-skip"]').evaluateAll((items) =>
      items.map((el) => Math.round(el.getBoundingClientRect().height))
    );
    expect(heights).toHaveLength(2);
    for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
