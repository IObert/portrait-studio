import { expect, test } from "@playwright/test";

const SHARE = "/s/e2eShareFixture0000000001";

test.describe("share page (SPEC §6.2)", () => {
  test("shows the image, copy text and download, with OpenGraph tags", async ({ browser, baseURL }) => {
    // Public: no basic auth.
    const anon = await browser.newContext({ httpCredentials: undefined });
    const page = await anon.newPage();
    await page.goto(`${baseURL}${SHARE}`);
    await expect(page.getByRole("heading", { name: "Made with Portrait Studio at E2E Summit" })).toBeVisible();
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

test.describe("print from the share page (D-26)", () => {
  const PRINT_SHARE = "/s/e2ePrintShareFixture000001";

  test("anyone with the link can print (queued, printer offline); a second tap while it is on its way does nothing", async ({ browser, baseURL }) => {
    const anon = await browser.newContext({ httpCredentials: undefined });
    const page = await anon.newPage();
    await page.goto(`${baseURL}${PRINT_SHARE}`);
    await page.getByRole("button", { name: "Print at the booth (1 left)" }).click();
    // No print agent is connected in this server, so the print is queued but the person is told the printer seems offline.
    await expect(page.getByRole("status")).toHaveText("Your print is queued, but the printer seems to be offline right now. It will print as soon as it is back; ask the booth team if it takes long. Prints left: 0.");
    await expect(page.getByTestId("share-print-done")).toBeVisible();
    // After a reload it stays marked, and there is no second print button.
    await page.reload();
    await expect(page.getByTestId("share-print-done")).toBeVisible();
    await expect(page.getByTestId("share-print")).toHaveCount(0);
    await anon.close();
  });

  test("events without printing show no print button", async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/s/e2eShareFixture0000000001`);
    await expect(page.getByRole("heading", { name: /E2E Summit/ })).toBeVisible();
    await expect(page.getByTestId("share-print")).toHaveCount(0);
  });
});
