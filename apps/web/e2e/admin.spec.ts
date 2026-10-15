import { expect, test } from "@playwright/test";
import sharp from "sharp";

// The ID is derived from the name (D-35): a unique name per run gives a predictable ID.
const run = Date.now().toString(36);
const eventName = `E2E Event ${run}`;
const slug = `e2e-event-${run}`;

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
    await page.getByLabel("Name", { exact: true }).fill(eventName);
    // There is no ID field: it is generated and never shown.
    await expect(page.getByLabel(/event code|^ID/i)).toHaveCount(0);
    await page.getByLabel("QR sender number").fill("not-a-number");
    for (const box of await page.locator('input[name="styles"]').all()) await box.uncheck();
    await page.getByRole("button", { name: "Create event" }).click();
    await expect(page.getByText("Enable at least one style")).toBeVisible();
    await expect(page.getByText("E.164")).toBeVisible();

    await page.getByLabel("QR sender number").fill("+13203780782");
    await page.getByLabel("Anime").check();
    await page.getByRole("button", { name: "Create event" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/events/${slug}$`));
    await expect(page.getByRole("heading", { name: eventName })).toBeVisible();
    await expect(page.getByTestId("state")).toHaveText("draft");
  });

  test("a second event with the same name gets its own ID", async ({ page }) => {
    await page.goto("/admin/events/new");
    await page.getByLabel("Name", { exact: true }).fill(eventName);
    await page.getByLabel("QR sender number").fill("+13203780782");
    await page.getByRole("button", { name: "Create event" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/events/${slug}-2$`));
    await expect(page.getByRole("heading", { name: eventName })).toBeVisible();
  });

  test("edits settings; renaming keeps the same event", async ({ page }) => {
    await page.goto(`/admin/events/${slug}`);
    await page.getByLabel("Name", { exact: true }).fill(`${eventName} (renamed)`);
    await page.getByLabel("Printing enabled").check();
    await page.getByLabel("Send promo (needs printing)").check();
    await page.getByPlaceholder("Promo text, in the event language").fill("Visit our booth for 20% off");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: `${eventName} (renamed)` })).toBeVisible();
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
    const frameBox = page.locator("div", { has: page.getByRole("heading", { name: "Custom frame", exact: true }) }).last();
    await frameBox.locator('input[type="file"]').setInputFiles({ name: "bad.png", mimeType: "image/png", buffer: await sharp({ create: { width: 100, height: 100, channels: 4, background: "#000" } }).png().toBuffer() });
    await frameBox.getByRole("button", { name: "Upload" }).click();
    await expect(frameBox.getByText("exactly 1200×1800")).toBeVisible();

    await frameBox.locator('input[type="file"]').setInputFiles(await frameFile());
    await frameBox.getByRole("button", { name: "Upload" }).click();
    await expect(frameBox.getByText("Frame uploaded")).toBeVisible();
    await expect(page.getByAltText("Uploaded frame")).toBeVisible();
    // The frame choice is a set of radio tiles; "Your own" becomes selectable once uploaded.
    await expect(page.locator('input[name="frame"][value="uploaded"]')).toBeEnabled();
  });

  test("shows a short printer token, kept on the page, with the agent command (D-33)", async ({ page }) => {
    await page.goto(`/admin/events/${slug}`);
    await page.getByRole("button", { name: "Generate token" }).click();
    const token = page.getByTestId("agent-token");
    await expect(token).toHaveText(new RegExp(`^${slug}\\.[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$`));
    const value = (await token.textContent())!;
    await expect(page.getByTestId("agent-command")).toContainText(`node agent.mjs --url http://localhost:`);
    await expect(page.getByTestId("agent-command")).toContainText(`--token ${value}`);
    // Still there after a reload: the operator types it in on the printer laptop.
    await page.reload();
    await expect(page.getByTestId("agent-token")).toHaveText(value);
  });

  test("deletes only after typing the event name", async ({ page }) => {
    await page.goto("/admin/events");
    await expect(page).toHaveURL(/\/admin$/);
    await page.getByRole("listitem").filter({ hasText: `${eventName} (renamed)` }).getByRole("button", { name: "Delete" }).click();
    const dialog = page.getByRole("dialog");
    const del = dialog.getByRole("button", { name: "Delete event" });
    await expect(del).toBeDisabled();
    await dialog.getByLabel(/to confirm/).fill("wrong");
    await expect(del).toBeDisabled();
    // The internal ID is never asked for (or shown).
    await expect(dialog.getByText(slug)).toHaveCount(0);
    await dialog.getByLabel(/to confirm/).fill(slug);
    await expect(del).toBeDisabled();
    await dialog.getByLabel(/to confirm/).fill(`${eventName} (renamed)`);
    await del.click();
    await expect(page).toHaveURL(/\/admin\?deleted=1$/);
    await expect(page.getByText("Event deleted")).toBeVisible();
    await expect(page.getByRole("link", { name: `${eventName} (renamed)` })).toHaveCount(0);
    // notFound() after streaming keeps status 200 by design (Next.js docs); the 404 UI renders.
    await page.goto(`/admin/events/${slug}`);
    await expect(page.getByText(/could not be found|404/i).first()).toBeVisible();
  });
});

test.describe("event overview", () => {
  test("each card says whether printing is on and whether a print agent is connected", async ({ page }) => {
    await page.goto("/admin");
    const card = (name: string) => page.getByRole("listitem").filter({ has: page.getByRole("link", { name, exact: true }) });
    await expect(card("E2E Print Fair").getByTestId("printer-summary")).toHaveText("Printing on, no print agent connected yet");
    await expect(card("E2E Summit").getByTestId("printer-summary")).toHaveText("Printing off");
  });
});

test.describe("event tabs", () => {
  test("switching tabs keeps the header mounted and moves the active tab", async ({ page }) => {
    await page.goto("/admin/events/e2e-share");
    const tabs = page.getByRole("navigation", { name: "Event" });
    await expect(page.getByRole("heading", { level: 1, name: "E2E Summit" })).toBeVisible();
    // The layout persists: the same <h1> node survives every switch.
    await page.evaluate(() => (document.querySelector("h1")!.dataset.probe = "kept"));
    for (const [tab, url] of [["Review", /\/review$/], ["Stats", /\/stats$/], ["Settings", /e2e-share$/]] as const) {
      await tabs.getByRole("link", { name: new RegExp(`^${tab}`) }).click();
      await expect(page).toHaveURL(url);
      await expect(tabs.locator('[aria-current="page"]')).toHaveText(new RegExp(`^${tab}`));
      await expect(page.locator('h1[data-probe="kept"]')).toHaveCount(1);
    }
  });
});

test.describe("start page, logout and 404", () => {
  test("the start page links to the admin", async ({ browser, baseURL }) => {
    const anon = await browser.newContext({ httpCredentials: undefined });
    const page = await anon.newPage();
    await page.goto(`${baseURL}/`);
    await expect(page.getByRole("heading", { name: "Portrait Studio" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in to the admin" })).toHaveAttribute("href", "/admin");
    await anon.close();
  });
  test("log out drops the browser's basic auth login", async ({ page }) => {
    await page.goto("/admin");
    await page.getByRole("link", { name: "Log out" }).click();
    await expect(page.getByRole("heading", { name: "You're signed out" })).toBeVisible();
  });
  test("unknown pages get the branded 404", async ({ page }) => {
    await page.goto("/no-such-page");
    await expect(page.getByRole("heading", { name: "This one didn’t develop" })).toBeVisible();
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
