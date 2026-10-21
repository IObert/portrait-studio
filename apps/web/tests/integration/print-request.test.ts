import { describe, expect, it, vi } from "vitest";
import { newSession } from "@/lib/conversation/session";
import { requestPrint } from "@/lib/delivery/print-request";
import { defaultConfig, type PortraitEvent } from "@/lib/events/schema";
import { JobSchema } from "@/lib/jobs/schema";
import { parseAddress } from "@/lib/messaging/address";
import { eventObjects } from "@/lib/sync/names";
import { SyncStore } from "@/lib/sync/store";
import { FakeSync } from "../support/fake-sync";

const NOW = new Date("2026-10-14T12:00:00Z");
const KEY = "whatsapp:+447700900123";

async function setup(maxPrints: number, printed = 0) {
  const fake = new FakeSync();
  const sync = new SyncStore(fake, { warn: vi.fn() }, { baseDelayMs: 1, maxDelayMs: 2 });
  const event: PortraitEvent = {
    slug: "ev", state: "live", config: { ...defaultConfig("Ev", "+13203780782"), printingEnabled: true, maxPrintsPerPerson: maxPrints },
    uploads: { frame: null, background: null }, printerTokenHash: null, printerToken: null, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
  };
  const ev = eventObjects("ev");
  for (const m of [ev.jobs, ev.sessions]) await sync.ensureMap(m);
  await fake.createItem(ev.sessions, KEY, { ...newSession("en", NOW), step: "ready", optedIn: true, counters: { delivered: 1, printed, printsReserved: 0, inFlight: 0 } });
  await fake.createItem(ev.jobs, "job_share_01", JobSchema.parse({
    jobId: "job_share_01", address: KEY, channel: "whatsapp", style: "anime", background: "gradient", selfieBlob: "s",
    outputBlobs: { printPng: "events/ev/generated/job_share_01.print.png", deliveryJpeg: "events/ev/generated/job_share_01.jpg" }, shareId: "S".repeat(24), state: "delivered", timestamps: {},
  }));
  const deps = { sync, mediaUrl: (p: string) => `https://booth.test/m/${encodeURIComponent(p)}` };
  const go = () => requestPrint(deps, event, KEY, parseAddress(KEY)!, "job_share_01", NOW);
  /** What the print agent's heartbeat says; without one, no agent has ever connected. */
  const heartbeat = (over: Partial<{ status: string; mode: string; at: Date }> = {}) =>
    fake.putDocument(ev.printer, { agentVersion: "0.1.0", mode: over.mode ?? "cups", queue: "DNP_DS620", status: over.status ?? "idle", detail: "", heartbeatAt: (over.at ?? NOW).toISOString() });
  return { fake, ev, go, heartbeat };
}

describe("requestPrint (D-24, D-26)", () => {
  it("queues the print against the owner's quota and does not touch the booth screen", async () => {
    const w = await setup(2);
    expect(await w.go()).toEqual({ status: "queued", printsLeft: 1, printerReady: false });
    expect((await w.fake.getItem(w.ev.print, "job_share_01"))!.data).toMatchObject({ state: "queued", reprint: false });
    expect(((await w.fake.getItem(w.ev.sessions, KEY))!.data as { counters: { printsReserved: number } }).counters.printsReserved).toBe(1);
    expect(await w.fake.getItem(w.ev.slideshow, "job_share_01").catch(() => null)).toBeNull();
  });

  it("refuses once the owner's prints are used", async () => {
    const w = await setup(1, 1);
    expect(await w.go()).toEqual({ status: "none-left" });
  });

  it("a finished print can be printed again once it is counted; another copy uses another print", async () => {
    const w = await setup(3);
    expect(await w.go()).toMatchObject({ status: "queued" });
    const item = (await w.fake.getItem(w.ev.print, "job_share_01"))!.data as object;
    // Printed but not yet counted by the server: still blocked, so no print escapes the quota.
    await w.fake.updateItem(w.ev.print, "job_share_01", { ...item, state: "printed" });
    expect(await w.go()).toEqual({ status: "already" });
    // Counted (settled): another copy is allowed, as a fresh item.
    await w.fake.updateItem(w.ev.print, "job_share_01", { ...item, state: "printed", settledAt: NOW.toISOString() });
    expect(await w.go()).toEqual({ status: "queued", printsLeft: 1, printerReady: false });
    expect((await w.fake.getItem(w.ev.print, "job_share_01"))!.data).toMatchObject({ state: "queued", attempts: 0 });
    expect(((await w.fake.getItem(w.ev.print, "job_share_01"))!.data as { settledAt?: string }).settledAt).toBeUndefined();
  });

  it("two taps at once still print once", async () => {
    const w = await setup(3);
    const results = await Promise.all([w.go(), w.go()]);
    expect(results.map((r) => r.status).sort()).toEqual(["already", "queued"]);
    expect(((await w.fake.getItem(w.ev.sessions, KEY))!.data as { counters: { printsReserved: number } }).counters.printsReserved).toBe(1);
  });

  it("BUG 15: asking again for a failed print that was not settled yet does not leak the old reservation", async () => {
    const w = await setup(3);
    expect(await w.go()).toMatchObject({ status: "queued" });
    const item = (await w.fake.getItem(w.ev.print, "job_share_01"))!.data as object;
    // The agent reported a failure; the server has not settled it (released the reservation) yet.
    await w.fake.updateItem(w.ev.print, "job_share_01", { ...item, state: "failed", error: "out of paper" });
    expect(await w.go()).toMatchObject({ status: "queued" }); // a failed print may be asked for again
    const counters = ((await w.fake.getItem(w.ev.sessions, KEY))!.data as { counters: { printsReserved: number } }).counters;
    expect(counters.printsReserved, "the failed print's reservation was given back; one print, one reservation").toBe(1);
  });

  it("tells the caller whether the printer looks ready, but queues the print either way", async () => {
    const w = await setup(5);
    await w.heartbeat();
    expect(await w.go()).toEqual({ status: "queued", printsLeft: 4, printerReady: true });
  });

  it("no agent has ever connected: queued, printer not ready", async () => {
    const w = await setup(5);
    expect(await w.go()).toMatchObject({ status: "queued", printerReady: false });
    expect((await w.fake.getItem(w.ev.print, "job_share_01"))!.data).toMatchObject({ state: "queued" });
  });

  it("the agent went quiet more than 45 s ago: not ready", async () => {
    const w = await setup(5);
    await w.heartbeat({ at: new Date(NOW.getTime() - 60_000) });
    expect(await w.go()).toMatchObject({ status: "queued", printerReady: false });
  });

  it("the agent is there but the printer is out of paper: not ready", async () => {
    const w = await setup(5);
    await w.heartbeat({ status: "out_of_paper" });
    expect(await w.go()).toMatchObject({ status: "queued", printerReady: false });
  });
});
