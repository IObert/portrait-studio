import { describe, expect, it } from "vitest";
import type { PrinterView } from "@/lib/admin/printer-status";
import { formatWait, isSlow, PRINT_PICKUP_MS, printWaitHint, sinceMs } from "@/lib/review/pending";

const NOW = new Date("2026-11-10T12:00:00Z");
const MIN = 60_000;
const online = (status = "idle"): PrinterView => ({ kind: "online", agentVersion: "0.1.0", mode: "cups", queue: "DNP_DS620", status, detail: "", heartbeatAt: NOW.toISOString() });

describe("Review tabs: waiting times (D-54)", () => {
  it("formats how long something has waited", () => {
    expect(formatWait(null)).toBe("just now");
    expect(formatWait(30_000)).toBe("just now");
    expect(formatWait(5 * MIN)).toBe("5 min");
    expect(formatWait(60 * MIN)).toBe("1 h");
    expect(formatWait(130 * MIN)).toBe("2 h 10 min");
  });

  it("measures from an ISO time, and never goes negative", () => {
    expect(sinceMs("2026-11-10T11:55:00Z", NOW)).toBe(5 * MIN);
    expect(sinceMs("2026-11-10T12:05:00Z", NOW)).toBe(0);
    expect(sinceMs(undefined, NOW)).toBeNull();
    expect(sinceMs("not a time", NOW)).toBeNull();
  });
});

describe("Review tabs: what counts as slow (D-54)", () => {
  it("a failed job always needs a look; the attendee's own choice never does", () => {
    expect(isSlow("failed", 0)).toBe(true);
    expect(isSlow("awaiting_choice", 600 * MIN)).toBe(false);
  });
  it("checking and queued after 5 minutes, generating after 10", () => {
    expect(isSlow("screening", 4 * MIN)).toBe(false);
    expect(isSlow("screening", 5 * MIN)).toBe(true);
    expect(isSlow("queued", 5 * MIN)).toBe(true);
    expect(isSlow("processing", 9 * MIN)).toBe(false);
    expect(isSlow("processing", 10 * MIN)).toBe(true);
    expect(isSlow("processing", null)).toBe(false); // unknown time: no claim
  });
});

describe("Review tabs: why a print is waiting (D-54)", () => {
  it("says nothing in the first minute, or for a print that is already moving", () => {
    expect(printWaitHint("queued", 30_000, online())).toBeNull();
    expect(printWaitHint("queued", null, online())).toBeNull();
    for (const state of ["claimed", "printing", "failed"] as const) expect(printWaitHint(state, 10 * MIN, online())).toBeNull();
  });
  it("names the reason the print cannot start", () => {
    expect(printWaitHint("queued", 2 * MIN, { kind: "none" })).toMatch(/No print agent has connected/);
    expect(printWaitHint("queued", 2 * MIN, { kind: "offline", lastSeen: NOW.toISOString() })).toMatch(/offline/);
    expect(printWaitHint("queued", 2 * MIN, online("out_of_paper"))).toBe("The printer is out of paper, so prints wait.");
  });
  it("a ready printer and an online agent give the explanation only after the pickup time (the case of D-53)", () => {
    expect(printWaitHint("queued", PRINT_PICKUP_MS - 1, online())).toBeNull();
    expect(printWaitHint("queued", PRINT_PICKUP_MS, online())).toMatch(/nothing picked this up\. Restart the print agent/);
  });
});
