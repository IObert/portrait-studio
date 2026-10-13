import { expect, test } from "@playwright/test";

const SHARE = "/s/e2eShareFixture0000000001";

test.describe("share page (SPEC §6.2)", () => {
  test("shows the image, copy text and download, with OpenGraph tags", async ({ browser, baseURL }) => {
    // Public: no basic auth.
    const anon = await browser.newContext({ httpCredentials: undefined });
    const page = await anon.newPage();
    await page.goto(`${baseURL}${SHARE}`);
    await expect(page.getByRole("heading", { name: "My Portrait Studio portrait from E2E Summit" })).toBeVisible();
    const img = page.getByRole("img", { name: /E2E Summit/ });
    await expect(img).toBeVisible();
    expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1200);
    await expect(page.getByRole("button", { name: "Copy text" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Download" })).toHaveAttribute("download", "image.jpg");
    const og = await page.locator('meta[property="og:image"]').getAttribute("content");
    expect(og).toMatch(/\/m\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await anon.close();
  });

  test("copies the event's share text", async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ httpCredentials: undefined, permissions: ["clipboard-read", "clipboard-write"] });
    const page = await ctx.newPage();
    await page.goto(`${baseURL}${SHARE}`);
    await page.getByRole("button", { name: "Copy text" }).click();
    await expect(page.getByRole("button", { name: "Copied!" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("My portrait from E2E Summit");
    await ctx.close();
  });

  test("unknown or malformed ids show 'no longer available'", async ({ browser, baseURL }) => {
    const anon = await browser.newContext({ httpCredentials: undefined });
    const page = await anon.newPage();
    for (const id of ["doesNotExist00000000000000", "x", "%2E%2E%2Fetc"]) {
      await page.goto(`${baseURL}/s/${id}`);
      await expect(page.locator("main").getByText("This portrait is no longer available."), id).toBeVisible();
    }
    // A traversal path never reaches the share route or leaks an image.
    const res = await page.goto(`${baseURL}/s/../../admin`);
    expect(res!.url()).not.toContain("/s/");
    await expect(page.getByRole("img")).toHaveCount(0);
    await anon.close();
  });

  test("the media link refuses tampering", async ({ request, baseURL, page }) => {
    await page.goto(SHARE);
    const og = (await page.locator('meta[property="og:image"]').getAttribute("content"))!;
    const path = new URL(og).pathname;
    expect((await request.get(`${baseURL}${path}`)).headers()["content-type"]).toBe("image/jpeg");
    expect((await request.get(`${baseURL}${path.slice(0, -2)}xx`)).status()).toBe(404);
  });
});
