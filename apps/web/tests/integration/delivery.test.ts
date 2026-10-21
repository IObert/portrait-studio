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

async function setup(o: { cfg?: Partial<EventConfigInput>; session?: Partial<Session>; to?: string } = {}) {
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
    printerTokenHash: null, printerToken: null,
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

  it("WhatsApp outside the 24h window: not sent, by design (D-42); logged, and the share page still works", async () => {
    const w = await setup({ session: { lastInboundAt: STALE } });
    expect(await deliver(w.deps, w.event, w.job, w.address)).toBe("skipped");
    expect(w.sent).toEqual([]);
    expect(w.log.warn).toHaveBeenCalledWith(expect.objectContaining({ reason: "outside-24h-window" }), expect.any(String));
    expect(await w.fake.getItem(Global.shares, "S".repeat(24))).not.toBeNull();
  });

  it("BUG 5: a send that throws is not lost: the job is retried, not left 'delivered' with nothing sent", async () => {
    const w = await setup();
    const create = (w.deps.messenger as unknown as { api: { createMessage: ReturnType<typeof vi.fn> } }).api.createMessage;
    create.mockRejectedValueOnce(new Error("Twilio 503"));
    await expect(deliver(w.deps, w.event, w.job, w.address)).rejects.toThrow("Twilio 503");
    const state = async () => JobSchema.parse((await w.fake.getItem(eventObjects("ev").jobs, w.job.jobId))!.data).state;
    expect(await state(), "claimable again").toBe("processing");
    expect((await w.session()).counters.delivered, "not counted as delivered").toBe(0);

    expect(await deliver(w.deps, w.event, w.job, w.address)).toBe("sent");
    expect(await state()).toBe("delivered");
    expect((await w.session()).counters.delivered).toBe(1);
  });

  it("BUG 5: when nothing could be sent (outside the window, no template) the portrait is not counted as delivered", async () => {
    const w = await setup({ session: { lastInboundAt: STALE } });
    expect(await deliver(w.deps, w.event, w.job, w.address)).toBe("skipped");
    expect((await readStats(w.sync, "ev")).imagesDelivered ?? 0).toBe(0);
  });

  it("WhatsApp: delivers from the number the person wrote to, not the event's QR number (WhatsApp rejects it otherwise, 63016)", async () => {
    // The event's QR number is +13203780782; this person messaged another booth number, so only that number has an open 24h window.
    const w = await setup({ session: { boothNumber: "+447700900600" } });
    expect(await deliver(w.deps, w.event, w.job, w.address)).toBe("sent");
    expect(w.sent[0]).toMatchObject({ from: "whatsapp:+447700900600" });
    expect(w.sent[1]).toBeDefined(); // the print/show question goes from the same number
  });

  it("WhatsApp: a session from before the number was remembered falls back to the event's QR number", async () => {
    const w = await setup();
    expect(await deliver(w.deps, w.event, w.job, w.address)).toBe("sent");
    expect(w.sent[0]).toMatchObject({ from: "whatsapp:+13203780782" });
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
    expect((await on.session()).pendingSlideshow).toMatchObject({ jobId: "job_00000001", group: false, print: true });

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
