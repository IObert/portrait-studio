import { expect, test } from "@playwright/test";

const REVIEW = "/admin/events/e2e-pending/review";

test.describe("Review tabs for work that is not done (D-54)", () => {
  test("the tabs show how many prints and portraits are waiting", async ({ page }) => {
    await page.goto(REVIEW);
    const nav = page.getByRole("navigation").filter({ hasText: "Flagged" });
    await expect(nav.getByRole("link", { name: /Flagged/ })).toContainText("(0)");
    await expect(nav.getByRole("link", { name: /Delivered/ })).toContainText("(3)");
    await expect(nav.getByRole("link", { name: /Printing/ })).toContainText("(2)"); // the printed one is not pending
    await expect(nav.getByRole("link", { name: /In progress/ })).toContainText("(4)");
  });

  test("Printing lists prints that have not come out, explains the waiting one and offers the right buttons", async ({ page }) => {
    await page.goto(`${REVIEW}?tab=printing`);
    await expect(page.getByTestId("printing-agent")).toContainText("Print agent online: idle");
    const items = page.getByTestId("printing-item");
    await expect(items).toHaveCount(2);
    // Oldest first: the print queued 3 hours ago, then the one that failed.
    const waiting = items.nth(0);
    await expect(waiting).toContainText("Waiting for the print agent");
    await expect(waiting).toContainText("Asked for 3 h ago");
    await expect(waiting.getByTestId("printing-hint")).toContainText("nothing picked this up");
    await expect(waiting.getByRole("button", { name: "Remove from print queue" })).toBeVisible();
    await expect(waiting.getByRole("button", { name: "Reprint" })).toHaveCount(0); // a pending print cannot be printed twice
    const failed = items.nth(1);
    await expect(failed).toContainText("Print failed");
    await expect(failed).toContainText("Printer cancelled the job");
    await expect(failed.getByRole("button", { name: "Reprint" })).toBeVisible();
    await expect(failed.getByTestId("printing-hint")).toHaveCount(0);
  });

  test("In progress lists unfinished portraits, the longest-waiting first, and marks the slow and failed ones", async ({ page }) => {
    await page.goto(`${REVIEW}?tab=progress`);
    const items = page.getByTestId("progress-item");
    await expect(items).toHaveCount(4);
    // 40 min (attendee's choice), 30 min (generating), 20 min (failed), 12 min (checking).
    await expect(items.nth(0)).toContainText("Waiting for the attendee to pick");
    await expect(items.nth(0)).toHaveAttribute("data-slow", "false");
    await expect(items.nth(1)).toContainText("Generating");
    await expect(items.nth(1)).toHaveAttribute("data-slow", "true");
    await expect(items.nth(2)).toContainText("image model refused the request");
    await expect(items.nth(2)).toHaveAttribute("data-slow", "true");
    await expect(items.nth(3)).toContainText("Checking the photo");
    await expect(items.nth(3)).toHaveAttribute("data-slow", "true");
  });

  test("the print button says Print for a portrait never printed, Reprint after one was, and none while one is on its way (D-54)", async ({ page }) => {
    await page.goto(`${REVIEW}?tab=delivered`);
    const card = (style: string) => page.getByTestId("delivered-item").filter({ hasText: style });
    await expect(card("Sketch").getByRole("button", { name: "Print", exact: true })).toBeVisible(); // never printed
    await expect(card("Sketch").getByRole("button", { name: "Reprint" })).toHaveCount(0);
    await expect(card("Pop Art").getByRole("button", { name: "Reprint" })).toBeVisible(); // its print failed
    await expect(card("Anime").getByRole("button", { name: /^(re)?print$/i })).toHaveCount(0); // a print is waiting; only "Remove from print queue"
    await expect(card("Anime").getByRole("button", { name: "Remove from print queue" })).toBeVisible();
  });

  test("Hide from booth screen only hides it, and it can be shown again; Remove stays a separate, final button (D-54)", async ({ page }) => {
    await page.goto(`${REVIEW}?tab=delivered`);
    const card = () => page.getByTestId("delivered-item").filter({ hasText: "Pop Art" });
    await expect(card()).toContainText("On the booth screen");
    await expect(card().getByRole("button", { name: "Remove", exact: true })).toBeVisible();
    await card().getByRole("button", { name: "Hide from booth screen" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Done" })).toBeVisible();

    await page.goto(`${REVIEW}?tab=delivered`);
    await expect(card()).toContainText("Hidden from the booth screen");
    await expect(card().getByRole("button", { name: "Hide from booth screen" })).toHaveCount(0);
    await expect(page.getByTestId("delivered-item")).toHaveCount(3); // still delivered: nothing was removed
    await card().getByRole("button", { name: "Show on booth screen again" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Done" })).toBeVisible();
    await page.goto(`${REVIEW}?tab=delivered`);
    await expect(card()).toContainText("On the booth screen");
  });

  test("the existing tabs still work", async ({ page }) => {
    await page.goto(`${REVIEW}?tab=delivered`);
    await expect(page.getByTestId("delivered-item")).toHaveCount(3);
    await page.goto(`${REVIEW}?tab=nonsense`); // an unknown tab falls back to Flagged
    await expect(page.getByText("Nothing flagged.")).toBeVisible();
  });

  // Last: it changes the seeded data (the waiting print is gone afterwards).
  test("removing the waiting print takes it off the Printing tab", async ({ page }) => {
    await page.goto(`${REVIEW}?tab=printing`);
    await page.getByTestId("printing-item").nth(0).getByRole("button", { name: "Remove from print queue" }).click();
    // The card leaves the list (and its message with it), and the count follows.
    await expect(page.getByTestId("printing-item")).toHaveCount(1);
    await expect(page.getByRole("link", { name: /Printing/ })).toContainText("(1)");
    await page.goto(`${REVIEW}?tab=printing`);
    await expect(page.getByTestId("printing-item")).toHaveCount(1);
    await expect(page.getByTestId("printing-item")).toContainText("Print failed");
  });
});
