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
    uploads: { frame: null, background: null }, printerTokenHash: null, printerTokenCreatedAt: null, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
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
  return { fake, ev, go };
}

describe("requestPrint (D-24, D-26)", () => {
  it("queues the print against the owner's quota and does not touch the booth screen", async () => {
    const w = await setup(2);
    expect(await w.go()).toEqual({ status: "queued", printsLeft: 1 });
    expect((await w.fake.getItem(w.ev.print, "job_share_01"))!.data).toMatchObject({ state: "queued", reprint: false });
    expect(((await w.fake.getItem(w.ev.sessions, KEY))!.data as { counters: { printsReserved: number } }).counters.printsReserved).toBe(1);
    expect(await w.fake.getItem(w.ev.slideshow, "job_share_01").catch(() => null)).toBeNull();
  });

  it("refuses once the owner's prints are used", async () => {
    const w = await setup(1, 1);
    expect(await w.go()).toEqual({ status: "none-left" });
  });

  it("two taps at once still print once", async () => {
    const w = await setup(3);
    const results = await Promise.all([w.go(), w.go()]);
    expect(results.map((r) => r.status).sort()).toEqual(["already", "queued"]);
    expect(((await w.fake.getItem(w.ev.sessions, KEY))!.data as { counters: { printsReserved: number } }).counters.printsReserved).toBe(1);
  });
});
