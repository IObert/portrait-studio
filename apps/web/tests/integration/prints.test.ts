import { describe, expect, it, vi } from "vitest";
import { newSession } from "@/lib/conversation/session";
import { EventRepo } from "@/lib/events/repo";
import { defaultConfig, type EventConfigInput } from "@/lib/events/schema";
import { JobSchema } from "@/lib/jobs/schema";
import { Messenger, type TwilioMessagingApi } from "@/lib/messaging/outbound";
import { settlePrints, STUCK_AFTER_MS } from "@/lib/pipeline/prints";
import { readStats } from "@/lib/stats";
import { eventObjects } from "@/lib/sync/names";
import { SyncStore } from "@/lib/sync/store";
import { FakeSync } from "../support/fake-sync";

const KEY = "whatsapp:+447700900123";
const NOW = new Date("2026-10-13T12:00:00Z");

async function setup(cfg: Partial<EventConfigInput> = {}, sessionOver: object = {}) {
  const fake = new FakeSync();
  const log = { info: vi.fn(), warn: vi.fn() };
  const sync = new SyncStore(fake, log, { baseDelayMs: 1, maxDelayMs: 2 });
  const events = new EventRepo(sync);
  await events.init();
  await events.create("ev", { ...defaultConfig("Ev", "+13203780782"), printingEnabled: true, maxPrintsPerPerson: 2, promo: { enabled: true, text: "Visit booth 42 for 20% off!" }, ...cfg });
  await events.setState("ev", "live");
  const ev = eventObjects("ev");
  for (const m of [ev.jobs, ev.sessions, ev.print]) await sync.ensureMap(m);
  await fake.createItem(ev.sessions, KEY, { ...newSession("en", NOW), step: "ready", optedIn: true, lastInboundAt: "2026-10-13T11:30:00Z", counters: { delivered: 1, printed: 0, printsReserved: 1, inFlight: 0 }, ...sessionOver });
  await fake.createItem(ev.jobs, "job_00000001", JobSchema.parse({ jobId: "job_00000001", address: KEY, channel: "whatsapp", style: "anime", background: "gradient", selfieBlob: "s", shareId: "S".repeat(24), state: "delivered", timestamps: {} }));
  const sent: string[] = [];
  const api: TwilioMessagingApi = { createMessage: vi.fn(async (p) => (sent.push(p.body ?? ""), { sid: "SM" + "1".repeat(32) })), createContent: vi.fn(async () => ({ sid: "HX" + "1".repeat(32) })) };
  const messenger = new Messenger(api, sync, "MG" + "0".repeat(32), log, () => NOW);
  await messenger.init();
  const deps = { sync, events, messenger, log, now: () => NOW };
  const put = (over: object) => fake.createItem(ev.print, "job_00000001", { jobId: "job_00000001", blobPath: "p.png", url: "https://x.test/m/t", who: "whatsapp:+44…23", state: "queued", attempts: 1, leaseUntil: null, error: null, reprint: false, timestamps: {}, ...over });
  const counters = async () => ((await fake.getItem(ev.sessions, KEY))!.data as { counters: Record<string, number> }).counters;
  const item = async () => (await fake.getItem(ev.print, "job_00000001"))!.data as { state: string; settledAt?: string; attempts: number };
  return { fake, sync, deps, sent, put, counters, item, log };
}

describe("print settlement (SPEC §11.2, §4.3, §5.9)", () => {
  it("printed: counts the print, releases the reservation and sends the promo once", async () => {
    const w = await setup();
    await w.put({ state: "printed" });
    expect(await settlePrints(w.deps)).toBe(1);
    expect(await w.counters()).toMatchObject({ printed: 1, printsReserved: 0 });
    expect(w.sent).toEqual(["Visit booth 42 for 20% off!"]);
    expect((await w.item()).settledAt).toBeDefined();
    expect(await readStats(w.sync, "ev")).toMatchObject({ printsSucceeded: 1 });
    // A second pass does nothing.
    expect(await settlePrints(w.deps)).toBe(0);
    expect(w.sent).toHaveLength(1);
  });

  it("two workers settling the same print count it and send the promo only once", async () => {
    const w = await setup();
    await w.put({ state: "printed" });
    await Promise.all([settlePrints(w.deps), settlePrints(w.deps)]);
    expect(w.sent).toHaveLength(1);
    expect((await w.counters()).printed).toBe(1);
  });

  it("no promo when the promo is off", async () => {
    const w = await setup({ promo: { enabled: false, text: "" } });
    await w.put({ state: "printed" });
    await settlePrints(w.deps);
    expect(w.sent).toEqual([]);
    expect((await w.counters()).printed).toBe(1);
  });

  it("failed: releases the reservation, sends nothing", async () => {
    const w = await setup();
    await w.put({ state: "failed", attempts: 3 });
    await settlePrints(w.deps);
    expect(await w.counters()).toMatchObject({ printed: 0, printsReserved: 0 });
    expect(w.sent).toEqual([]);
    expect(await readStats(w.sync, "ev")).toMatchObject({ printsFailed: 1 });
  });

  it("admin reprints neither count toward the quota nor trigger a promo (§17 Q5)", async () => {
    const w = await setup({}, { counters: { delivered: 1, printed: 1, printsReserved: 0, inFlight: 0 } });
    await w.put({ state: "printed", reprint: true });
    await settlePrints(w.deps);
    expect((await w.counters()).printed).toBe(1);
    expect(w.sent).toEqual([]);
  });

  it("promo outside the WhatsApp window is skipped and logged (§5.9)", async () => {
    const w = await setup({}, { lastInboundAt: "2026-10-11T11:00:00Z" });
    await w.put({ state: "printed" });
    await settlePrints(w.deps);
    expect(w.sent).toEqual([]);
    expect(w.log.info).toHaveBeenCalledWith(expect.objectContaining({ event: "promo_skipped", reason: "outside-24h-window" }), expect.any(String));
  });

  it("stuck print: back to queued, then failed once attempts are used (§11.2)", async () => {
    const stale = new Date(NOW.getTime() - STUCK_AFTER_MS - 1000).toISOString();
    const w = await setup();
    await w.put({ state: "printing", attempts: 1, leaseUntil: stale });
    await settlePrints(w.deps);
    expect((await w.item()).state).toBe("queued");

    const w2 = await setup();
    await w2.put({ state: "claimed", attempts: 3, leaseUntil: stale });
    await settlePrints(w2.deps);
    expect((await w2.item()).state).toBe("failed");
  });

  it("leaves a print with a recent lease alone", async () => {
    const w = await setup();
    await w.put({ state: "printing", leaseUntil: new Date(NOW.getTime() - 1000).toISOString() });
    expect(await settlePrints(w.deps)).toBe(0);
    expect((await w.item()).state).toBe("printing");
  });
});
