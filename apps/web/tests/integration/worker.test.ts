import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { catalogs } from "@/i18n";
import { newSession } from "@/lib/conversation/session";
import { EventRepo } from "@/lib/events/repo";
import { defaultConfig, type EventConfigInput } from "@/lib/events/schema";
import { type Job, JobSchema } from "@/lib/jobs/schema";
import { Messenger, type TwilioMessagingApi } from "@/lib/messaging/outbound";
import { MAX_ATTEMPTS, workOnce, type WorkerDeps } from "@/lib/pipeline/worker";
import { eventObjects } from "@/lib/sync/names";
import { SyncStore } from "@/lib/sync/store";
import { FakeBlob } from "../support/fake-blob";
import { FakeSync } from "../support/fake-sync";

const KEY = "whatsapp:+447700900123";

/** Scripted fake OpenAI: each check returns what the test says. */
function fakeOpenAI(o: { flagged?: boolean; face?: string; scene?: string; review?: string; editError?: unknown; visionError?: unknown } = {}) {
  const png = sharp({ create: { width: 1024, height: 1536, channels: 3, background: "#55a" } }).png().toBuffer();
  const calls = { edit: 0, responses: 0 };
  const client = {
    moderations: { create: vi.fn(async () => ({ results: [{ flagged: o.flagged ?? false }] })) },
    responses: {
      create: vi.fn(async (req: { input: { content: { type: string; text?: string }[] }[] }) => {
        calls.responses++;
        if (o.visionError) throw o.visionError;
        const text = req.input[0]!.content.find((c) => c.type === "input_text")!.text!;
        if (text.startsWith("Does this image")) return { output_text: o.face ?? "YES" };
        if (text.startsWith("Analyze this photo")) return { output_text: o.scene ?? "Subjects: 1\nPets: none\nPositions: centered" };
        return { output_text: o.review ?? "PASS" };
      }),
    },
    images: {
      edit: vi.fn(async () => {
        calls.edit++;
        if (o.editError) throw o.editError;
        return { data: [{ b64_json: (await png).toString("base64") }] };
      }),
    },
  };
  return { client, calls };
}

async function setup(openai = fakeOpenAI(), cfg: Partial<EventConfigInput> = {}) {
  const fake = new FakeSync();
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const sync = new SyncStore(fake, log, { baseDelayMs: 1, maxDelayMs: 2 });
  const blob = new FakeBlob();
  const events = new EventRepo(sync);
  await events.init();
  await events.create("ev", { ...defaultConfig("Ev", "+13203780782"), ...cfg });
  await events.setState("ev", "live");
  const ev = eventObjects("ev");
  for (const m of [ev.jobs, ev.sessions]) await sync.ensureMap(m);
  const sent: string[] = [];
  const senders: (string | undefined)[] = [];
  const api: TwilioMessagingApi = { createMessage: vi.fn(async (p) => (sent.push(p.body ?? ""), senders.push(p.from), { sid: "SM" + "1".repeat(32) })), createContent: vi.fn(async () => ({ sid: "HX" + "1".repeat(32) })) };
  const messenger = new Messenger(api, sync, "MG" + "0".repeat(32), log);
  await messenger.init();
  await blob.put("events/ev/selfies/s.jpg", await sharp({ create: { width: 800, height: 1000, channels: 3, background: "#c9a" } }).jpeg().toBuffer(), "image/jpeg");
  const session = { ...newSession("en", new Date()), step: "ready" as const, optedIn: true, lastInboundAt: new Date().toISOString(), counters: { delivered: 0, printed: 0, printsReserved: 0, inFlight: 1 } };
  await fake.createItem(ev.sessions, KEY, session);
  const onReady = vi.fn(async () => {});
  const deps: WorkerDeps = {
    sync,
    events,
    messenger,
    pipeline: { openai: openai.client as never, blob, imageModel: "gpt-image-2.5-flare", vision: { model: "gpt-6.1-sol", effort: "low" }, loadFixedFrame: async () => null, loadBrandAsset: async () => Buffer.alloc(0) },
    log,
    onReady,
    workerId: "w1",
  };
  return { fake, sync, blob, deps, sent, senders, onReady, log, ev, openai };
}

async function queue(fake: FakeSync, over: Partial<Job> = {}) {
  const job: Job = JobSchema.parse({
    jobId: "job_00000001",
    address: KEY,
    channel: "whatsapp",
    style: "anime",
    background: "gradient",
    selfieBlob: "events/ev/selfies/s.jpg",
    shareId: "s".repeat(24),
    state: "queued",
    subjects: 1,
    timestamps: { queued: new Date().toISOString() },
    ...over,
  });
  await fake.createItem(eventObjects("ev").jobs, job.jobId, job);
  return job;
}
const getJob = async (fake: FakeSync, id = "job_00000001") => JobSchema.parse((await fake.getItem(eventObjects("ev").jobs, id))!.data);
const inFlight = async (fake: FakeSync) => ((await fake.getItem(eventObjects("ev").sessions, KEY))!.data as { counters: { inFlight: number } }).counters.inFlight;

describe("worker pipeline (SPEC §9)", () => {
  it("runs a passing job: outputs stored, reviewed, handed to delivery", async () => {
    const { fake, blob, deps, onReady } = await setup();
    await queue(fake);
    expect(await workOnce(deps)).toBe(1);
    const job = await getJob(fake);
    expect(job.aiReview).toEqual({ reason: "" });
    expect(job.subjects).toBe(1);
    expect(blob.blobs.has(job.outputBlobs!.printPng)).toBe(true);
    expect(blob.blobs.has(job.outputBlobs!.deliveryJpeg)).toBe(true);
    expect(onReady).toHaveBeenCalledTimes(1);
    const meta = await sharp((await blob.get(job.outputBlobs!.printPng))!).metadata();
    expect([meta.width, meta.height, meta.density]).toEqual([1200, 1800, 300]);
  });

  it.each([
    ["AI review FAIL", { review: "FAIL: 1. likeness" }, "flagged", catalogs.en.job.reviewFlagged],
    ["generation refused", { editError: Object.assign(new Error("blocked"), { code: "moderation_blocked" }) }, "rejected", catalogs.en.job.moderationRejected],
  ])("%s → %s with the §5.6 message, quota slot released", async (_n, o, state, message) => {
    const { fake, deps, sent, onReady } = await setup(fakeOpenAI(o));
    await queue(fake);
    await workOnce(deps);
    expect((await getJob(fake)).state).toBe(state);
    expect(sent).toEqual([message]);
    expect(onReady).not.toHaveBeenCalled();
    expect(await inFlight(fake)).toBe(0);
  });

  it("generation reuses the stored scene: no second vision call", async () => {
    const o = fakeOpenAI();
    const { fake, deps } = await setup(o);
    await queue(fake, { subjects: 3 });
    await workOnce(deps);
    expect(o.client.moderations.create).not.toHaveBeenCalled();
    expect(o.client.images.edit).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining("exactly 3 HUMAN subjects") }), expect.anything());
  });

  it("fails closed: an unparseable review is retried, never passed", async () => {
    const { fake, deps, onReady } = await setup(fakeOpenAI({ review: "Looks lovely!" }));
    await queue(fake);
    await workOnce(deps);
    const job = await getJob(fake);
    expect(job.state).toBe("queued");
    expect(job.error).toMatch(/review/);
    expect(onReady).not.toHaveBeenCalled();
  });

  it("retries transient errors, then fails after MAX_ATTEMPTS with an apology", async () => {
    const { fake, deps, sent } = await setup(fakeOpenAI({ visionError: Object.assign(new Error("Service Unavailable"), { status: 503 }) }));
    await queue(fake);
    let now = Date.now();
    deps.now = () => new Date(now);
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await workOnce(deps);
      now += 5 * 60 * 1000; // past any backoff
    }
    const job = await getJob(fake);
    expect(job.state).toBe("failed");
    expect(job.attempts).toBe(MAX_ATTEMPTS);
    expect(sent).toEqual([catalogs.en.job.failed]);
    expect(await inFlight(fake)).toBe(0);
  });

  it("respects the retry backoff (never retries instantly, even with zero jitter)", async () => {
    const { fake, deps } = await setup(fakeOpenAI({ visionError: Object.assign(new Error("429"), { status: 429 }) }));
    await queue(fake);
    const t = Date.now();
    deps.now = () => new Date(t);
    const random = vi.spyOn(Math, "random").mockReturnValue(0); // worst case: no jitter delay
    try {
      await workOnce(deps);
      expect((await getJob(fake)).attempts).toBe(1);
      expect(await workOnce(deps)).toBe(0); // still backing off at the same instant
      deps.now = () => new Date(t + 4_000);
      expect(await workOnce(deps)).toBe(0); // under the 5 s floor
      deps.now = () => new Date(t + 6_000);
      expect(await workOnce(deps)).toBe(1); // eligible again
    } finally {
      random.mockRestore();
    }
  });

  it("two workers never run the same job", async () => {
    const o = fakeOpenAI();
    const { fake, deps } = await setup(o);
    await queue(fake);
    const [a, b] = await Promise.all([workOnce(deps), workOnce({ ...deps, workerId: "w2" })]);
    expect(a + b).toBe(1);
    expect(o.calls.edit).toBe(1);
  });

  it("takes back a job whose lease expired (worker died)", async () => {
    const { fake, deps } = await setup();
    await queue(fake, { state: "processing", attempts: 1, leaseUntil: new Date(Date.now() - 1000).toISOString() });
    expect(await workOnce(deps)).toBe(1);
    expect((await getJob(fake)).attempts).toBe(2);
  });

  it("leaves a job with a live lease alone", async () => {
    const { fake, deps } = await setup();
    await queue(fake, { state: "processing", attempts: 1, leaseUntil: new Date(Date.now() + 60_000).toISOString() });
    expect(await workOnce(deps)).toBe(0);
  });

  it("composites onto the uploaded background with a transparent generation", async () => {
    const o = fakeOpenAI();
    const { fake, deps, blob, sync } = await setup(o);
    await blob.put("assets/events/ev/background.jpg", await sharp({ create: { width: 1024, height: 1536, channels: 3, background: "#0f0" } }).jpeg().toBuffer(), "image/jpeg");
    const events = new EventRepo(sync);
    await events.setUpload("ev", "background", { blobPath: "assets/events/ev/background.jpg", contentType: "image/jpeg", width: 1024, height: 1536, uploadedAt: new Date().toISOString() });
    await queue(fake, { background: "uploaded" });
    await workOnce(deps);
    expect(o.client.images.edit).toHaveBeenCalledWith(expect.objectContaining({ background: "transparent" }), expect.anything());
    expect((await getJob(fake)).aiReview).toEqual({ reason: "" });
  });
});

describe("a reviewed job whose hand-off to delivery failed", () => {
  it("BUG 6: is picked up again and delivered, not stranded in processing", async () => {
    const { fake, deps, onReady } = await setup();
    await queue(fake);
    onReady.mockRejectedValueOnce(new Error("Twilio unreachable")); // the hand-off fails once (or the worker dies here)
    await expect(workOnce(deps)).rejects.toThrow("Twilio unreachable");
    expect((await getJob(fake)).state).toBe("processing"); // reviewed and stored, not yet delivered

    const t = Date.now() + 10 * 60 * 1000; // past any lease
    deps.now = () => new Date(t);
    expect(await workOnce(deps)).toBe(1);
    expect(onReady).toHaveBeenCalledTimes(2);
  });

  it("BUG 6: the retry delivers the stored result without generating (and paying for) another image", async () => {
    const ai = fakeOpenAI();
    const { fake, deps, onReady } = await setup(ai);
    await queue(fake);
    onReady.mockRejectedValueOnce(new Error("Twilio unreachable"));
    await expect(workOnce(deps)).rejects.toThrow();
    deps.now = () => new Date(Date.now() + 10 * 60 * 1000);
    await workOnce(deps);
    expect(ai.calls.edit).toBe(1);
  });
});

describe("screening before the menus (D-18)", () => {
  const screening = (fake: FakeSync) => queue(fake, { state: "screening", subjects: null, style: null, background: null, timestamps: { screening: new Date().toISOString() } });

  it.each([
    ["moderation", { flagged: true }, catalogs.en.job.moderationRejected],
    ["no face", { face: "NO" }, catalogs.en.job.noFace],
    ["0 subjects", { scene: "Subjects: 0\nPets: none\nPositions: centered" }, catalogs.en.job.noFace],
    ["5 people", { scene: "Subjects: 5\nPets: none\nPositions: group" }, catalogs.en.job.tooManyPeople],
  ])("%s → rejected right after the photo, before any menu", async (_n, o, message) => {
    const ai = fakeOpenAI(o);
    const { fake, deps, sent } = await setup(ai);
    await screening(fake);
    await workOnce(deps);
    expect((await getJob(fake)).state).toBe("rejected");
    expect(sent).toEqual([message]); // the rejection only; no style menu
    expect(ai.calls.edit).toBe(0);
    expect(await inFlight(fake)).toBe(0);
  });

  it("passes: stores the scene, opens the style menu, does not generate yet", async () => {
    const ai = fakeOpenAI({ scene: "Subjects: 2\nPets: dog\nPositions: left-right pair" });
    const { fake, deps, sent, ev } = await setup(ai);
    await screening(fake);
    await workOnce(deps);
    const job = await getJob(fake);
    expect(job).toMatchObject({ state: "awaiting_choice", subjects: 2, pet: "dog", style: null });
    expect(ai.calls.edit).toBe(0);
    expect(sent).toHaveLength(1); // the style menu (interactive, so no body)
    expect(((await fake.getItem(ev.sessions, KEY))!.data as { step: string; pendingJobId: string }).step).toBe("awaiting_style");
  });

  it("one style and one background: goes straight to generation after screening", async () => {
    const ai = fakeOpenAI();
    const { fake, deps } = await setup(ai, { styles: ["anime"], backgrounds: ["gradient"] });
    await screening(fake);
    await workOnce(deps); // screen
    expect((await getJob(fake))).toMatchObject({ state: "queued", style: "anime", background: "gradient" });
    await workOnce(deps); // generate
  });

  it("one style and one background: the session leaves 'screening' once the photo passed, so the person is not stuck", async () => {
    const ai = fakeOpenAI();
    const { fake, deps, ev } = await setup(ai, { styles: ["anime"], backgrounds: ["gradient"] });
    await screening(fake);
    // As inbound leaves the session when it queues the photo for screening.
    const cur = (await fake.getItem(ev.sessions, KEY))!;
    await fake.updateItem(ev.sessions, KEY, { ...(cur.data as object), step: "screening", pendingJobId: "job_00000001" });
    await workOnce(deps); // screening passes, no menu to show, the job goes straight to generation
    expect((await getJob(fake)).state).toBe("queued");
    const session = (await fake.getItem(ev.sessions, KEY))!.data as { step: string; pendingJobId: string | null };
    expect(session.step, "nobody is waiting for a menu").toBe("ready");
    expect(session.pendingJobId).toBeNull();
  });

  it("one style and one background: a newer photo that took over the session is left alone", async () => {
    const ai = fakeOpenAI();
    const { fake, deps, ev } = await setup(ai, { styles: ["anime"], backgrounds: ["gradient"] });
    await screening(fake);
    const cur = (await fake.getItem(ev.sessions, KEY))!;
    // The person sent a second photo meanwhile: the session now waits for job_00000002, not for this one.
    await fake.updateItem(ev.sessions, KEY, { ...(cur.data as object), step: "screening", pendingJobId: "job_00000002" });
    await workOnce(deps);
    const session = (await fake.getItem(ev.sessions, KEY))!.data as { step: string; pendingJobId: string | null };
    expect(session).toMatchObject({ step: "screening", pendingJobId: "job_00000002" });
  });

  it("BUG 1: rejection resets session step and pendingJobId so next photo isn't stuck", async () => {
    const ai = fakeOpenAI({ face: "NO" });
    const { fake, deps, ev } = await setup(ai);
    await screening(fake);
    // As inbound leaves the session when it queues the photo for screening.
    const cur = (await fake.getItem(ev.sessions, KEY))!;
    await fake.updateItem(ev.sessions, KEY, { ...(cur.data as object), step: "screening", pendingJobId: "job_00000001" });
    await workOnce(deps);
    expect((await getJob(fake)).state).toBe("rejected");
    const session = (await fake.getItem(ev.sessions, KEY))!.data as { step: string; pendingJobId: string; counters: { inFlight: number } };
    expect(session.step).toBe("ready");
    expect(session.pendingJobId).toBeNull();
    expect(session.counters.inFlight).toBe(0);
  });


  it("BUG 2: a screening result for a job that was superseded meanwhile is dropped, the session is left alone", async () => {
    const ai = fakeOpenAI();
    const { fake, deps, ev, sent } = await setup(ai);
    await screening(fake);
    // While the worker screens (the vision call), the attendee sends a newer photo.
    const original = ai.client.responses.create.getMockImplementation()!;
    ai.client.responses.create.mockImplementationOnce(async (req) => {
      const cur = await getJob(fake);
      await fake.updateItem(ev.jobs, cur.jobId, { ...cur, state: "rejected", error: "superseded" });
      const s = (await fake.getItem(ev.sessions, KEY))!;
      await fake.updateItem(ev.sessions, KEY, { ...(s.data as object), step: "screening", pendingJobId: "job_00000002" });
      return original(req);
    });
    await workOnce(deps);
    expect((await getJob(fake)).state).toBe("rejected");
    expect(sent).toEqual([]); // no menu for the old photo
    expect(((await fake.getItem(ev.sessions, KEY))!.data as { pendingJobId: string }).pendingJobId).toBe("job_00000002");
  });

  it("retries a failed screening back to screening, not to generation", async () => {
    const { fake, deps } = await setup(fakeOpenAI({ visionError: Object.assign(new Error("503"), { status: 503 }) }));
    await screening(fake);
    await workOnce(deps);
    expect((await getJob(fake))).toMatchObject({ state: "screening", attempts: 1, subjects: null });
  });
});

describe("messages from the worker come from the number the person wrote to (D-43)", () => {
  const withBooth = async (ev: ReturnType<typeof eventObjects>, fake: FakeSync) => {
    const cur = (await fake.getItem(ev.sessions, KEY))!;
    await fake.updateItem(ev.sessions, KEY, { ...(cur.data as object), boothNumber: "+447700900600" });
  };

  it("a rejected photo is answered from that number", async () => {
    const { fake, deps, ev, senders } = await setup(fakeOpenAI({ face: "NO" }));
    await withBooth(ev, fake);
    await queue(fake, { state: "screening", subjects: null, style: null, background: null, timestamps: { screening: new Date().toISOString() } });
    await workOnce(deps);
    expect(senders).toEqual(["whatsapp:+447700900600"]);
  });

  it("the style menu after screening is sent from that number", async () => {
    const { fake, deps, ev, senders } = await setup(fakeOpenAI());
    await withBooth(ev, fake);
    await queue(fake, { state: "screening", subjects: null, style: null, background: null, timestamps: { screening: new Date().toISOString() } });
    await workOnce(deps);
    expect(senders).toEqual(["whatsapp:+447700900600"]);
  });

  it("without a remembered number it falls back to the event's QR number", async () => {
    const { fake, deps, senders } = await setup(fakeOpenAI({ face: "NO" }));
    await queue(fake, { state: "screening", subjects: null, style: null, background: null, timestamps: { screening: new Date().toISOString() } });
    await workOnce(deps);
    expect(senders).toEqual(["whatsapp:+13203780782"]);
  });
});

describe("retry-after from an OpenAI error", () => {
  it("is read from a Headers object (OpenAI SDK v7) and from a plain object", async () => {
    const { retryAfterOf } = await import("@/lib/pipeline/worker");
    expect(retryAfterOf({ headers: new Headers({ "retry-after": "17" }) })).toBe(17_000);
    expect(retryAfterOf({ headers: { "retry-after": "3" } })).toBe(3_000);
  });
  it("is ignored when absent or not a positive number", async () => {
    const { retryAfterOf } = await import("@/lib/pipeline/worker");
    expect(retryAfterOf(new Error("x"))).toBeUndefined();
    expect(retryAfterOf({ headers: new Headers() })).toBeUndefined();
    expect(retryAfterOf({ headers: new Headers({ "retry-after": "soon" }) })).toBeUndefined();
    expect(retryAfterOf(null)).toBeUndefined();
  });
  it("makes the worker wait at least that long before retrying", async () => {
    const { fake, deps } = await setup(fakeOpenAI({ visionError: Object.assign(new Error("429"), { status: 429, headers: new Headers({ "retry-after": "50" }) }) }));
    await queue(fake);
    const t = Date.now();
    deps.now = () => new Date(t);
    await workOnce(deps);
    deps.now = () => new Date(t + 40_000); // past the 5 s floor, before the 50 s the server asked for
    expect(await workOnce(deps)).toBe(0);
    deps.now = () => new Date(t + 51_000);
    expect(await workOnce(deps)).toBe(1);
  });
});
