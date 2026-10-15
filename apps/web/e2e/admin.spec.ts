import { expect, test } from "@playwright/test";
import sharp from "sharp";

const slug = `e2e-${Date.now().toString(36)}`;

async function frameFile() {
  const svg = `<svg width="1200" height="1800" xmlns="http://www.w3.org/2000/svg"><defs><mask id="m"><rect width="1200" height="1800" fill="white"/><rect x="60" y="60" width="1080" height="1560" fill="black"/></mask></defs><rect width="1200" height="1800" fill="#e11d48" mask="url(#m)"/></svg>`;
  return { name: "frame.png", mimeType: "image/png", buffer: await sharp(Buffer.from(svg)).png().toBuffer() };
}

test.describe.serial("admin events", () => {
  test("requires basic auth", async ({ browser, baseURL }) => {
    const anon = await browser.newContext({ httpCredentials: undefined });
    const res = await anon.request.get(`${baseURL}/admin/events`);
    expect(res.status()).toBe(401);
    expect(res.headers()["www-authenticate"]).toContain("Basic");
    const wrong = await browser.newContext({ httpCredentials: { username: "e2e-admin", password: "wrong" } });
    expect((await wrong.request.get(`${baseURL}/admin/events`)).status()).toBe(401);
    expect((await anon.request.get(`${baseURL}/healthz`)).status()).toBe(200);
    await anon.close();
    await wrong.close();
  });

  test("creates an event with validation errors first", async ({ page }) => {
    await page.goto("/admin/events/new");
    await page.getByLabel("Name", { exact: true }).fill("E2E Event");
    await page.getByLabel("Event code").fill(slug);
    await page.getByLabel("QR sender number").fill("not-a-number");
    for (const box of await page.locator('input[name="styles"]').all()) await box.uncheck();
    await page.getByRole("button", { name: "Create event" }).click();
    await expect(page.getByText("Enable at least one style")).toBeVisible();
    await expect(page.getByText("E.164")).toBeVisible();

    await page.getByLabel("QR sender number").fill("+13203780782");
    await page.getByLabel("Anime").check();
    await page.getByRole("button", { name: "Create event" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/events/${slug}$`));
    await expect(page.getByRole("heading", { name: "E2E Event" })).toBeVisible();
    await expect(page.getByTestId("state")).toHaveText("draft");
  });

  test("rejects a duplicate event code", async ({ page }) => {
    await page.goto("/admin/events/new");
    await page.getByLabel("Name", { exact: true }).fill("Duplicate");
    await page.getByLabel("Event code").fill(slug);
    await page.getByLabel("QR sender number").fill("+13203780782");
    await page.getByRole("button", { name: "Create event" }).click();
    await expect(page.getByText("already exists")).toBeVisible();
  });

  test("edits settings and keeps the slug fixed", async ({ page }) => {
    await page.goto(`/admin/events/${slug}`);
    await expect(page.getByLabel("Event code")).toBeDisabled();
    await page.getByLabel("Name", { exact: true }).fill("E2E Event (renamed)");
    await page.getByLabel("Printing enabled").check();
    await page.getByLabel("Send promo (needs printing)").check();
    await page.getByPlaceholder("Promo text, in the event language").fill("Visit our booth for 20% off");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "E2E Event (renamed)" })).toBeVisible();
    await expect(page.getByLabel("Printing enabled")).toBeChecked();
  });

  test("switches state through the allowed buttons", async ({ page }) => {
    await page.goto(`/admin/events/${slug}`);
    await expect(page.getByRole("button", { name: "Break" })).toHaveCount(0);
    await page.getByRole("button", { name: "Go live" }).click();
    await expect(page.getByTestId("state")).toHaveText("live");
    await page.getByRole("button", { name: "Break" }).click();
    await expect(page.getByTestId("state")).toHaveText("break");
    await page.getByRole("button", { name: "Go live" }).click();
    await expect(page.getByTestId("state")).toHaveText("live");
  });

  test("uploads a frame, rejects an invalid one and previews it", async ({ page }) => {
    await page.goto(`/admin/events/${slug}`);
    const frameBox = page.locator("div", { has: page.getByRole("heading", { name: "frame", exact: true }) }).last();
    await frameBox.locator('input[type="file"]').setInputFiles({ name: "bad.png", mimeType: "image/png", buffer: await sharp({ create: { width: 100, height: 100, channels: 4, background: "#000" } }).png().toBuffer() });
    await frameBox.getByRole("button", { name: "Upload" }).click();
    await expect(frameBox.getByText("exactly 1200×1800")).toBeVisible();

    await frameBox.locator('input[type="file"]').setInputFiles(await frameFile());
    await frameBox.getByRole("button", { name: "Upload" }).click();
    await expect(frameBox.getByText("Frame uploaded")).toBeVisible();
    await expect(page.getByAltText("Uploaded frame")).toBeVisible();
    await expect(page.locator('select[name="frame"] option[value="uploaded"]')).toBeEnabled();
  });

  test("shows the printer token once with the agent command", async ({ page }) => {
    await page.goto(`/admin/events/${slug}`);
    await page.getByRole("button", { name: "Generate token" }).click();
    const cmd = page.getByTestId("agent-command");
    await expect(cmd).toContainText(`--token pst_${slug}_`);
    await expect(cmd).toContainText("node agent.mjs --url http://localhost:");
    const token = (await cmd.textContent())!.match(/--token (\S+)/)![1]!;
    await page.reload();
    await expect(page.getByTestId("agent-command")).toHaveCount(0);
    expect(await page.content()).not.toContain(token);
    await expect(page.getByText("A token is active.")).toBeVisible();
  });

  test("deletes only after typing the slug", async ({ page }) => {
    await page.goto("/admin/events");
    await expect(page).toHaveURL(/\/admin$/);
    await page.getByRole("row", { name: /E2E Event/ }).getByRole("button", { name: "Delete" }).click();
    const dialog = page.getByRole("dialog");
    const del = dialog.getByRole("button", { name: "Delete event" });
    await expect(del).toBeDisabled();
    await dialog.getByLabel(/to confirm/).fill("wrong");
    await expect(del).toBeDisabled();
    await dialog.getByLabel(/to confirm/).fill(slug);
    await del.click();
    await expect(page).toHaveURL(/\/admin\?deleted=1$/);
    await expect(page.getByText("Event deleted")).toBeVisible();
    await expect(page.getByRole("link", { name: /E2E Event/ })).toHaveCount(0);
    // notFound() after streaming keeps status 200 by design (Next.js docs); the 404 UI renders.
    await page.goto(`/admin/events/${slug}`);
    await expect(page.getByText(/could not be found|404/i).first()).toBeVisible();
  });
});

test.describe("stats (SPEC §10.5)", () => {
  test("shows the counters and printer state; leads cannot be downloaded", async ({ page, baseURL, request }) => {
    await page.goto("/admin/events/e2e-share/stats");
    await expect(page.getByRole("heading", { name: "Stats" })).toBeVisible();
    await expect(page.getByTestId("last-reset")).toHaveText("Never reset");
    await expect(page.getByText("No print agent has connected yet.")).toBeVisible();

    // Leads are exported only with the leads:export script (user decision, D-31).
    await expect(page.getByRole("link", { name: /csv/i })).toHaveCount(0);
    expect((await request.get(`${baseURL}/admin/events/e2e-share/leads.csv`)).status()).toBe(404);
  });
});
