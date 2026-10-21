import { expect, test } from "@playwright/test";

const SLUG = "e2e-print"; // printing on, no print agent connected (lib/testing/e2e-seed.ts)
const HEADER = (page: import("@playwright/test").Page) => page.getByTestId("printer-summary");
const online = (over: Record<string, unknown> = {}) => ({ kind: "online", agentVersion: "0.1.0", mode: "cups", queue: "DNP_DS620", status: "idle", detail: "", heartbeatAt: new Date().toISOString(), ...over });

test.describe("printer status endpoint", () => {
  test("answers an admin with the current status", async ({ request }) => {
    const res = await request.get(`/admin/events/${SLUG}/printer`);
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toContain("no-store");
    expect(await res.json()).toEqual({ kind: "none" }); // no agent has connected to this fixture
  });

  test("is not available without the admin login, and rejects a bad id", async ({ browser, baseURL, request }) => {
    const anon = await browser.newContext({ httpCredentials: undefined });
    expect((await anon.request.get(`${baseURL}/admin/events/${SLUG}/printer`)).status()).toBe(401);
    await anon.close();
    expect((await request.get(`/admin/events/Not%20A%20Slug!/printer`)).status()).toBe(404);
  });
});

test.describe("live printer indicator in the event header", () => {
  test("starts with the server's value, then follows the status without a reload", async ({ page }) => {
    await page.clock.install();
    let status: unknown = { kind: "none" };
    await page.route(`**/admin/events/${SLUG}/printer`, (route) => route.fulfill({ json: status }));
    await page.goto(`/admin/events/${SLUG}`);
    await expect(HEADER(page)).toHaveText("Printing on, no print agent connected yet");

    status = online();
    await page.clock.fastForward(31_000);
    await expect(HEADER(page)).toHaveText("Ready: printer DNP_DS620");

    status = online({ status: "out_of_paper" });
    await page.clock.fastForward(31_000);
    await expect(HEADER(page)).toHaveText("Out of paper: printer DNP_DS620");

    status = { kind: "offline", lastSeen: new Date(Date.now() - 120_000).toISOString() };
    await page.clock.fastForward(31_000);
    await expect(HEADER(page)).toContainText("Print agent offline, last seen");
  });

  test("a failing refresh keeps the last status, and says so after the second failure", async ({ page }) => {
    await page.clock.install();
    let ok = true;
    await page.route(`**/admin/events/${SLUG}/printer`, (route) => (ok ? route.fulfill({ json: online() }) : route.fulfill({ status: 503, body: "Unavailable" })));
    await page.goto(`/admin/events/${SLUG}`);
    await expect(HEADER(page)).toHaveText("Printing on, no print agent connected yet"); // hydrated and polling before the clock moves
    await page.clock.fastForward(31_000);
    await expect(HEADER(page)).toHaveText("Ready: printer DNP_DS620");

    ok = false;
    await page.clock.fastForward(31_000);
    await expect(HEADER(page)).toHaveText("Ready: printer DNP_DS620"); // one failure: still the last known status, not 'offline'
    await page.clock.fastForward(31_000);
    await expect(HEADER(page)).toContainText("(not refreshing)");
    await expect(HEADER(page)).toContainText("Ready: printer DNP_DS620");

    ok = true; // recovers on its own
    await page.clock.fastForward(31_000);
    await expect(HEADER(page)).not.toContainText("(not refreshing)");
  });

  test("does not ask while the tab is hidden, and asks again as soon as it is shown", async ({ page }) => {
    await page.clock.install();
    let calls = 0;
    await page.route(`**/admin/events/${SLUG}/printer`, (route) => {
      calls++;
      return route.fulfill({ json: online() });
    });
    await page.goto(`/admin/events/${SLUG}`);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    });
    await page.clock.fastForward(95_000);
    expect(calls).toBe(0);

    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => calls).toBe(1);
    await expect(HEADER(page)).toHaveText("Ready: printer DNP_DS620");
  });
});
