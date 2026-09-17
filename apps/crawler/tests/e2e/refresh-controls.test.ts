import { mfUrls } from "@mf-dashboard/meta/urls";
import type { Browser, BrowserContext } from "playwright";
import { afterAll, beforeAll, expect, test } from "vitest";
import { ADVERTISEMENT_CLOSE_SELECTOR, BULK_REFRESH_SELECTOR } from "../../src/scrapers/refresh.js";
import { launchLoggedInContext, withNewPage } from "./helpers.js";

let browser: Browser;
let context: BrowserContext;
beforeAll(async () => {
  ({ browser, context } = await launchLoggedInContext());
});
afterAll(async () => {
  await context?.close();
  await browser?.close();
});

test("一括更新リンクの実ページ構造を読み取り専用で確認する", async () => {
  await withNewPage(context, async (page) => {
    await page.goto(mfUrls.home, { waitUntil: "domcontentloaded", timeout: 30000 });
    const refresh = page.locator(BULK_REFRESH_SELECTOR);
    await refresh.waitFor({ state: "visible", timeout: 15000 });
    expect(await refresh.count()).toBe(1);
    expect(await refresh.getAttribute("href")).toBe("/aggregation_queue");
    // The actionability check may wait for an advertisement; this test never clicks
    // the refresh link or starts financial-institution updates.
  });
});

test("広告が配信されている場合だけ閉じるボタンの構造を確認する", async (testContext) => {
  await withNewPage(context, async (page) => {
    await page.goto(mfUrls.home, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.locator(BULK_REFRESH_SELECTOR).waitFor({ state: "visible", timeout: 15000 });
    const close = page.locator(ADVERTISEMENT_CLOSE_SELECTOR).first();
    // Advertisement delivery is nondeterministic. Do not force a campaign or edit
    // service data to make this structure-only E2E show a popup.
    if (!(await close.isVisible())) {
      testContext.skip();
      return;
    }
    expect(await close.getAttribute("class")).toContain("ab-close-button");
  });
});
