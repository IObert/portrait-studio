import { describe, expect, it, vi } from "vitest";
import { catalogs } from "@/i18n";
import { newSession, type Session } from "@/lib/conversation/session";
import { deliver, type DeliveryDeps } from "@/lib/delivery/deliver";
import { defaultConfig, type EventConfigInput, type PortraitEvent } from "@/lib/events/schema";
import { type Job, JobSchema } from "@/lib/jobs/schema";
import { parseAddress } from "@/lib/messaging/address";
import { Messenger, type TwilioMessagingApi } from "@/lib/messaging/outbound";
import { readStats } from "@/lib/stats";
import { eventObjects, Global } from "@/lib/sync/names";
import { SyncStore } from "@/lib/sync/store";
import { FakeSync } from "../support/fake-sync";

const NOW = new Date("2026-10-12T12:00:00Z");
const RECENT = "2026-10-12T11:30:00Z";
const STALE = "2026-10-10T11:30:00Z";

async function setup(o: { cfg?: Partial<EventConfigInput>; session?: Partial<Session>; templates?: DeliveryDeps["templates"]; to?: string } = {}) {
  const fake = new FakeSync();
  const log = { info: vi.fn(), warn: vi.fn() };
  const sync = new SyncStore(fake, log, { baseDelayMs: 1, maxDelayMs: 2 });
  const sent: { to: string; from?: string; body?: string; mediaUrl?: string[]; contentSid?: string; contentVariables?: string }[] = [];
  const api: TwilioMessagingApi = {
    createMessage: vi.fn(async (p) => (sent.push(p), { sid: "SM" + "1".repeat(32) })),
    createContent: vi.fn(async () => ({ sid: "HX" + "c".repeat(32) })),
  };
  const messenger = new Messenger(api, sync, "MG" + "0".repeat(32), log, () => NOW);
  await messenger.init();
  const event: PortraitEvent = {
    slug: "ev",
    state: "live",
    config: { ...defaultConfig("Ev", "+13203780782"), ...o.cfg },
    uploads: { frame: null, background: null },
    printerTokenHash: null,
    printerTokenCreatedAt: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
  const address = parseAddress(o.to ?? "whatsapp:+447700900123")!;
  const key = `${address.channel}:${address.e164}`;
  const ev = eventObjects("ev");
  for (const m of [ev.jobs, ev.sessions]) await sync.ensureMap(m);
  await fake.createItem(ev.sessions, key, { ...newSession("en", NOW), step: "ready", optedIn: true, lastInboundAt: RECENT, counters: { delivered: 0, printed: 0, printsReserved: 0, inFlight: 1 }, ...o.session });
  const job: Job = JobSchema.parse({
    jobId: "job_00000001",
    address: key,
    channel: address.channel,
    style: "anime",
    background: "gradient",
    selfieBlob: "events/ev/selfies/s.jpg",
    outputBlobs: { printPng: "events/ev/generated/job_00000001.print.png", deliveryJpeg: "events/ev/generated/job_00000001.jpg" },
    shareId: "S".repeat(24),
    subjects: 1,
    state: "processing",
    timestamps: { queued: "2026-10-12T11:59:00Z" },
  });
  await fake.createItem(ev.jobs, job.jobId, job);
  const deps: DeliveryDeps = {
    sync,
    messenger,
    mediaUrl: (p) => `https://booth.test/m/${encodeURIComponent(p)}`,
    publicBaseUrl: "https://booth.test",
    templates: o.templates ?? {},
    log,
    now: () => NOW,
  };
  const session = async () => (await fake.getItem(ev.sessions, key))!.data as Session;
  const printJob = async () => (await fake.getItem(ev.print, job.jobId))?.data;
  return { fake, sync, deps, event, job, address, sent, session, printJob, log };
}

describe("delivery (SPEC §6.1)", () => {
  it("WhatsApp in window: image + caption + share link from the booth number, then the slideshow question", async () => {
    const w = await setup();
    expect(await deliver(w.deps, w.event, w.job, w.address)).toBe("sent");
    expect(w.sent[0]).toMatchObject({
      to: "whatsapp:+447700900123",
      from: "whatsapp:+13203780782",
      body: expect.stringContaining("https://booth.test/s/" + "S".repeat(24)),
      mediaUrl: ["https://booth.test/m/events%2Fev%2Fgenerated%2Fjob_00000001.jpg"],
    });
    expect(w.sent[0]!.body).toContain("Anime portrait");
    expect(w.sent[1]!.contentSid).toBeDefined(); // slideshow quick reply
    expect((await w.fake.getItem(Global.shares, "S".repeat(24)))!.data).toMatchObject({ eventSlug: "ev", jobId: "job_00000001" });
  });

  it("SMS to a US number: MMS with the JPEG", async () => {
    const w = await setup({ to: "+12025550123" });
    await deliver(w.deps, w.event, w.job, w.address);
    expect(w.sent[0]).toMatchObject({ to: "+12025550123", mediaUrl: [expect.any(String)] });
    expect(w.sent[0]!.from).toBeUndefined();
  });

  it("SMS outside US/CA/AU: link only, no media", async () => {
    const w = await setup({ to: "+447700900456" });
    await deliver(w.deps, w.event, w.job, w.address);
    expect(w.sent[0]!.mediaUrl).toBeUndefined();
    expect(w.sent[0]!.body).toBe(catalogs.en.delivery.linkOnly({ styleName: "Anime", shareUrl: "https://booth.test/s/" + "S".repeat(24) }));
    expect(w.sent[1]!.body).toContain("(YES / NO)"); // SMS slideshow question with keywords
  });

  it("WhatsApp outside the window: uses the approved template (SPEC §5.7, §6.3)", async () => {
    const tpl = "HX" + "d".repeat(32);
    const w = await setup({ session: { lastInboundAt: STALE }, templates: { en: tpl } });
    expect(await deliver(w.deps, w.event, w.job, w.address)).toBe("sent");
    expect(w.sent).toHaveLength(1); // no free-form slideshow question outside the window
    expect(w.sent[0]).toMatchObject({ contentSid: tpl, from: "whatsapp:+13203780782" });
    expect(JSON.parse(w.sent[0]!.contentVariables!)).toEqual({ "1": expect.stringContaining("/m/"), "2": "S".repeat(24) });
  });

  it("WhatsApp outside the window without a template: skipped and logged, share page still works", async () => {
    const w = await setup({ session: { lastInboundAt: STALE } });
    expect(await deliver(w.deps, w.event, w.job, w.address)).toBe("skipped");
    expect(w.sent).toEqual([]);
    expect(w.log.warn).toHaveBeenCalledWith(expect.objectContaining({ reason: "no-delivery-template" }), expect.any(String));
    expect(await w.fake.getItem(Global.shares, "S".repeat(24))).not.toBeNull();
  });

  it("counts quota once, releases the in-flight slot and records stats", async () => {
    const w = await setup();
    await deliver(w.deps, w.event, w.job, w.address);
    expect((await w.session()).counters).toMatchObject({ delivered: 1, inFlight: 0 });
    expect(await readStats(w.sync, "ev")).toMatchObject({ imagesDelivered: 1, deliveryCount: 1, deliveryMsTotal: 60_000 });
  });

  it("is idempotent: a second call sends nothing and counts nothing", async () => {
    const w = await setup();
    await deliver(w.deps, w.event, w.job, w.address);
    const n = w.sent.length;
    expect(await deliver(w.deps, w.event, w.job, w.address)).toBe("skipped");
    expect(w.sent.length).toBe(n);
    expect((await w.session()).counters.delivered).toBe(1);
  });

  it("admin approval delivers but does not count toward quota (SPEC §4.3, §5.7)", async () => {
    const w = await setup({ session: { counters: { delivered: 2, printed: 0, printsReserved: 0, inFlight: 0 } } });
    await w.fake.updateItem(eventObjects("ev").jobs, w.job.jobId, { ...w.job, state: "approved_by_admin" });
    expect(await deliver(w.deps, w.event, { ...w.job, state: "approved_by_admin" }, w.address, { approvedByAdmin: true })).toBe("sent");
    expect((await w.session()).counters.delivered).toBe(2);
    expect(await readStats(w.sync, "ev")).toMatchObject({ approvedByAdmin: 1 });
  });

  it("never prints by itself; offers print + show only while prints remain (D-24)", async () => {
    const on = await setup({ cfg: { printingEnabled: true, maxPrintsPerPerson: 2 }, to: "+447700900456" });
    await deliver(on.deps, on.event, on.job, on.address);
    expect(await on.printJob()).toBeUndefined();
    expect((await on.session()).counters.printsReserved).toBe(0);
    expect(on.sent[1]!.body).toBe(`${catalogs.en.delivery.printQuestion({ printsLeft: 2 })} ${catalogs.en.delivery.printSmsHint}`);
    expect((await on.session()).pendingSlideshow).toEqual({ jobId: "job_00000001", group: false, print: true });

    // No prints left (printed + reserved): the plain slideshow question.
    const full = await setup({ cfg: { printingEnabled: true, maxPrintsPerPerson: 2 }, to: "+447700900456", session: { counters: { delivered: 1, printed: 1, printsReserved: 1, inFlight: 1 } } });
    await deliver(full.deps, full.event, full.job, full.address);
    expect(full.sent[1]!.body).toContain("(YES / NO)");
    expect((await full.session()).pendingSlideshow).toMatchObject({ print: false });

    const off = await setup({ to: "+447700900456" });
    await deliver(off.deps, off.event, off.job, off.address);
    expect(off.sent[1]!.body).toContain("(YES / NO)");
  });

  it("asks group photos for everyone's agreement (SPEC §5.8)", async () => {
    const w = await setup({ to: "+447700900456" });
    await deliver(w.deps, w.event, { ...w.job, subjects: 3 }, w.address);
    expect(w.sent[1]!.body).toContain("everyone in the photo agrees");
  });
});
