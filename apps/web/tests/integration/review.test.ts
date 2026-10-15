import { describe, expect, it, vi } from "vitest";
import { newSession } from "@/lib/conversation/session";
import type { DeliveryDeps } from "@/lib/delivery/deliver";
import { defaultConfig, type EventConfigInput, type PortraitEvent } from "@/lib/events/schema";
import { JobSchema, type Job } from "@/lib/jobs/schema";
import { Messenger, type TwilioMessagingApi } from "@/lib/messaging/outbound";
import { approveFlagged, discardFlagged, removeFromPrintQueue, removePortrait, reprint, ReviewError } from "@/lib/review/actions";
import { FakeBlob } from "../support/fake-blob";
import { eventObjects } from "@/lib/sync/names";
import { SyncStore } from "@/lib/sync/store";
import { FakeSync } from "../support/fake-sync";

const KEY = "whatsapp:+447700900123";

async function setup(cfg: Partial<EventConfigInput> = {}, jobOver: Partial<Job> = {}) {
  const fake = new FakeSync();
  const log = { info: vi.fn(), warn: vi.fn() };
  const sync = new SyncStore(fake, log, { baseDelayMs: 1, maxDelayMs: 2 });
  const sent: { body?: string; mediaUrl?: string[] }[] = [];
  const api: TwilioMessagingApi = { createMessage: vi.fn(async (p) => (sent.push(p), { sid: "SM" + "1".repeat(32) })), createContent: vi.fn(async () => ({ sid: "HX" + "1".repeat(32) })) };
  const messenger = new Messenger(api, sync, "MG" + "0".repeat(32), log);
  await messenger.init();
  const event: PortraitEvent = {
    slug: "ev", state: "live", config: { ...defaultConfig("Ev", "+13203780782"), ...cfg },
    uploads: { frame: null, background: null }, printerTokenHash: null, printerToken: null, printerTokenCreatedAt: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  const ev = eventObjects("ev");
  for (const m of [ev.jobs, ev.sessions, ev.slideshow, ev.print]) await sync.ensureMap(m);
  await fake.createItem(ev.sessions, KEY, { ...newSession("en", new Date()), step: "ready", optedIn: true, lastInboundAt: new Date().toISOString(), counters: { delivered: 1, printed: 0, printsReserved: 1, inFlight: 0 } });
  const job = JobSchema.parse({
    jobId: "job_00000001", address: KEY, channel: "whatsapp", style: "anime", background: "gradient", selfieBlob: "s",
    outputBlobs: { printPng: "events/ev/generated/job_00000001.print.png", deliveryJpeg: "events/ev/generated/job_00000001.jpg" },
    shareId: "S".repeat(24), state: "flagged", aiReview: { result: "fail", reason: "1. likeness" }, timestamps: {}, ...jobOver,
  });
  await fake.createItem(ev.jobs, job.jobId, job);
  const delivery: DeliveryDeps = { sync, messenger, mediaUrl: (p) => `https://booth.test/m/${p}`, publicBaseUrl: "https://booth.test", templates: {}, log };
  const getJob = async () => JobSchema.parse((await fake.getItem(ev.jobs, "job_00000001"))!.data);
  const counters = async () => ((await fake.getItem(ev.sessions, KEY))!.data as { counters: Record<string, number> }).counters;
  return { fake, sync, log, sent, event, delivery, getJob, counters, ev };
}

describe("admin review (SPEC §10.3)", () => {
  it("approve & send delivers a flagged image without counting quota, and logs the admin", async () => {
    const w = await setup();
    expect(await approveFlagged({ sync: w.sync, delivery: w.delivery, log: w.log }, w.event, "job_00000001")).toBe("sent");
    const job = await w.getJob();
    expect(job.state).toBe("delivered");
    expect(job.timestamps.approved_by_admin).toBeDefined();
    expect(w.sent[0]!.mediaUrl).toBeDefined();
    expect((await w.counters()).delivered).toBe(1); // unchanged (SPEC §4.3)
    expect(w.log.info).toHaveBeenCalledWith(expect.objectContaining({ event: "review_action", action: "approve" }), expect.any(String));
  });

  it("refuses to approve or discard anything that is not flagged", async () => {
    const w = await setup({}, { state: "delivered" });
    await expect(approveFlagged({ sync: w.sync, delivery: w.delivery, log: w.log }, w.event, "job_00000001")).rejects.toBeInstanceOf(ReviewError);
    await expect(discardFlagged({ sync: w.sync, log: w.log }, w.event, "job_00000001")).rejects.toBeInstanceOf(ReviewError);
    expect(w.sent).toEqual([]);
  });

  it("approving twice sends once", async () => {
    const w = await setup();
    const deps = { sync: w.sync, delivery: w.delivery, log: w.log };
    await approveFlagged(deps, w.event, "job_00000001");
    const n = w.sent.length;
    await expect(approveFlagged(deps, w.event, "job_00000001")).rejects.toBeInstanceOf(ReviewError);
    expect(w.sent.length).toBe(n);
  });

  it("discard ends the job as rejected with the admin's reason, and sends nothing", async () => {
    const w = await setup();
    await discardFlagged({ sync: w.sync, log: w.log }, w.event, "job_00000001");
    expect(await w.getJob()).toMatchObject({ state: "rejected", error: "discarded_by_admin" });
    expect(w.sent).toEqual([]);
  });

  it("remove takes the portrait down: off the slideshow, files deleted now, job removed_by_admin (D-16)", async () => {
    const w = await setup({ printingEnabled: true }, { state: "delivered" });
    const blob = new FakeBlob();
    for (const p of ["s", "events/ev/generated/job_00000001.print.png", "events/ev/generated/job_00000001.jpg"]) await blob.put(p, Buffer.from("x"), "image/jpeg");
    await w.fake.createItem(w.ev.slideshow, "job_00000001", { blobPath: "x.jpg", addedAt: new Date().toISOString() });
    await w.fake.createItem(w.ev.print, "job_00000001", { jobId: "job_00000001", blobPath: "p.png", url: "https://x.test/m/t", who: "x", state: "queued", attempts: 0, leaseUntil: null, error: null, reprint: false, timestamps: {} });

    expect(await removePortrait({ sync: w.sync, blob, log: w.log }, w.event, "job_00000001")).toEqual({ printing: false });
    expect((await w.getJob()).state).toBe("removed_by_admin");
    expect(blob.blobs.size).toBe(0); // selfie, print PNG and delivery JPEG gone immediately
    expect(await w.fake.getItem(w.ev.slideshow, "job_00000001")).toBeNull();
    expect(await w.fake.getItem(w.ev.print, "job_00000001")).toBeNull();
    expect((await w.counters()).printsReserved).toBe(0);
    expect(w.log.info).toHaveBeenCalledWith(expect.objectContaining({ action: "portrait_remove", filesDeleted: 3 }), expect.any(String));
  });

  it("remove reports a print already in progress, and still takes the portrait down", async () => {
    const w = await setup({ printingEnabled: true }, { state: "delivered" });
    await w.fake.createItem(w.ev.print, "job_00000001", { jobId: "job_00000001", blobPath: "p.png", url: "https://x.test/m/t", who: "x", state: "printing", attempts: 1, leaseUntil: null, error: null, reprint: false, timestamps: {} });
    expect(await removePortrait({ sync: w.sync, blob: new FakeBlob(), log: w.log }, w.event, "job_00000001")).toEqual({ printing: true });
    expect((await w.getJob()).state).toBe("removed_by_admin");
  });

  it("only delivered portraits can be removed", async () => {
    const w = await setup(); // flagged
    await expect(removePortrait({ sync: w.sync, blob: new FakeBlob(), log: w.log }, w.event, "job_00000001")).rejects.toBeInstanceOf(ReviewError);
  });

  it("removes a queued print and releases the quota reservation, but not a printing one", async () => {
    const w = await setup({ printingEnabled: true }, { state: "delivered" });
    const item = { jobId: "job_00000001", blobPath: "p.png", url: "https://x.test/m/t", who: "x", state: "queued", attempts: 0, leaseUntil: null, error: null, reprint: false, timestamps: {} };
    await w.fake.createItem(w.ev.print, "job_00000001", item);
    await removeFromPrintQueue({ sync: w.sync, log: w.log }, w.event, "job_00000001");
    expect(await w.fake.getItem(w.ev.print, "job_00000001")).toBeNull();
    expect((await w.counters()).printsReserved).toBe(0);

    await w.fake.createItem(w.ev.print, "job_00000001", { ...item, state: "printing" });
    await expect(removeFromPrintQueue({ sync: w.sync, log: w.log }, w.event, "job_00000001")).rejects.toThrow(/printing/);
  });

  it("reprint queues a print marked as a reprint, without touching the quota (§17 Q5)", async () => {
    const w = await setup({ printingEnabled: true }, { state: "delivered" });
    const before = await w.counters();
    await reprint({ sync: w.sync, log: w.log, mediaUrl: (p: string) => `https://x.test/m/${p}` }, w.event, "job_00000001");
    expect((await w.fake.getItem(w.ev.print, "job_00000001"))!.data).toMatchObject({ state: "queued", reprint: true });
    expect(await w.counters()).toEqual(before);
    await expect(reprint({ sync: w.sync, log: w.log, mediaUrl: (p: string) => `https://x.test/m/${p}` }, w.event, "job_00000001")).rejects.toThrow(/already pending/);
  });

  it("refuses reprints when printing is off", async () => {
    const w = await setup({ printingEnabled: false }, { state: "delivered" });
    await expect(reprint({ sync: w.sync, log: w.log, mediaUrl: (p: string) => `https://x.test/m/${p}` }, w.event, "job_00000001")).rejects.toThrow(/Printing is off/);
  });
});
