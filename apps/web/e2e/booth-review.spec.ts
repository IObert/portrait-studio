import { expect, test } from "@playwright/test";
import jsQR from "jsqr";
import sharp from "sharp";

const BOOTH = "/booth/e2e-booth";
const REVIEW = "/admin/events/e2e-booth/review";

test.describe.serial("booth screen and review (SPEC §10.3, §10.4)", () => {
  test("booth needs basic auth", async ({ browser, baseURL }) => {
    const anon = await browser.newContext({ httpCredentials: undefined });
    expect((await anon.request.get(`${baseURL}${BOOTH}`)).status()).toBe(401);
    expect((await anon.request.get(`${baseURL}${BOOTH}/stream`)).status()).toBe(401);
    await anon.close();
  });

  test("live: CTA, QR code and the consented slideshow", async ({ page }) => {
    await page.goto(BOOTH);
    await expect(page.locator("main[data-state]")).toHaveAttribute("data-state", "live");
    await expect(page.getByRole("heading", { name: "Get your portrait" })).toBeVisible();
    await expect(page.getByText("Send a selfie")).toBeVisible();
    await expect(page.getByTestId("qr").locator("svg")).toBeVisible();
    await expect(page.getByTestId("slide")).toBeVisible();
    expect(await page.getByTestId("slide").evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1200);
  });

  test("the QR code opens WhatsApp with the localized prefill and event code (SPEC §5.2)", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(BOOTH);
    const png = await page.getByTestId("qr").screenshot();
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const code = jsQR(new Uint8ClampedArray(data), info.width, info.height);
    expect(code, "QR must decode").not.toBeNull();
    expect(decodeURIComponent(code!.data)).toBe("https://wa.me/13203780782?text=Hi! I want my Portrait Studio portrait at E2E Booth 🎨");
  });

  test("CTA, QR and slide stay visible on landscape and portrait screens", async ({ page }) => {
    for (const [width, height] of [[1280, 720], [1920, 1080], [1080, 1920]] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(BOOTH);
      for (const t of ["qr", "slide"]) {
        // Wait for the streamed screen before measuring.
        await expect(page.getByTestId(t)).toBeVisible();
        const box = (await page.getByTestId(t).boundingBox())!;
        expect(box.width, `${t} at ${width}x${height}`).toBeGreaterThan(150);
        expect(box.x + box.width, `${t} fits horizontally`).toBeLessThanOrEqual(width);
        expect(box.y + box.height, `${t} fits vertically`).toBeLessThanOrEqual(height);
      }
      await expect(page.getByRole("heading", { name: "Get your portrait" })).toBeInViewport();
    }
  });

  test("review: flagged item shows selfie, output and the AI's reason", async ({ page }) => {
    await page.goto(REVIEW);
    const item = page.getByTestId("flagged-item");
    await expect(item).toHaveCount(1);
    await expect(item.getByText("an extra person was added")).toBeVisible();
    await expect(item.getByRole("img")).toHaveCount(2);
    // Masked address only.
    await expect(item.getByText(/whatsapp \+10…01/)).toBeVisible();
  });

  test("removing a portrait takes it off the booth screen live and turns its share link off (D-16)", async ({ browser }) => {
    const booth = await (await browser.newContext({ httpCredentials: { username: "e2e-admin", password: "e2e-password-not-secret" } })).newPage();
    await booth.goto(BOOTH);
    await expect(booth.getByTestId("slide")).toBeVisible();

    const admin = await (await browser.newContext({ httpCredentials: { username: "e2e-admin", password: "e2e-password-not-secret" } })).newPage();
    await admin.goto(`${REVIEW}?tab=delivered`);
    admin.once("dialog", (d) => d.accept()); // confirm the irreversible removal
    await admin.getByTestId("delivered-item").getByRole("button", { name: "Remove", exact: true }).click();
    await expect(admin.getByRole("status").filter({ hasText: "Removed. The share link no longer works" })).toBeVisible();
    await expect(admin.getByTestId("delivered-item")).toHaveCount(0);

    // No reload on the booth: the live update removes the slide.
    await expect(booth.getByTestId("slide")).toHaveCount(0, { timeout: 10_000 });

    // The share link now says the organizer removed it.
    const share = await (await browser.newContext({ httpCredentials: undefined })).newPage();
    await share.goto("/s/e2e_slide_01_share_000000000000");
    await expect(share.getByTestId("share-gone")).toHaveText("This portrait was removed by the event organizer.");
    await expect(share.getByRole("img")).toHaveCount(0);
  });

  test("state changes switch the booth screen without a reload", async ({ browser }) => {
    const booth = await (await browser.newContext({ httpCredentials: { username: "e2e-admin", password: "e2e-password-not-secret" } })).newPage();
    await booth.goto(BOOTH);
    const admin = await (await browser.newContext({ httpCredentials: { username: "e2e-admin", password: "e2e-password-not-secret" } })).newPage();
    await admin.goto("/admin/events/e2e-booth");

    await admin.getByRole("button", { name: "Break" }).click();
    await expect(booth.locator("main[data-state]")).toHaveAttribute("data-state", "break", { timeout: 10_000 });
    await expect(booth.getByTestId("status-message")).toHaveText("We'll be right back! Portrait Studio is taking a short break.");

    await admin.getByRole("button", { name: "Go live" }).click();
    await expect(booth.locator("main[data-state]")).toHaveAttribute("data-state", "live", { timeout: 10_000 });

    await admin.getByRole("button", { name: "End" }).click();
    await expect(booth.locator("main[data-state]")).toHaveAttribute("data-state", "ended", { timeout: 10_000 });
    await expect(booth.getByTestId("status-message")).toHaveText("This event has ended. Thanks for stopping by!");
  });

  test("review: discard a flagged image", async ({ page }) => {
    await page.goto(REVIEW);
    const item = page.getByTestId("flagged-item");
    await item.getByPlaceholder("Your name (optional, logged)").fill("E2E Admin");
    await item.getByRole("button", { name: "Discard" }).click();
    await expect(page.getByTestId("flagged-item")).toHaveCount(0);
    await expect(page.getByText("Nothing flagged.")).toBeVisible();
  });
});
