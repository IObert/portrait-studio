import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { catalogs } from "@/i18n";
import { ACTION } from "@/lib/conversation/consent";
import { type Deps, handleInbound, type InboundMessage, initInbound } from "@/lib/conversation/inbound";
import { EventRepo } from "@/lib/events/repo";
import { defaultConfig, type EventConfigInput } from "@/lib/events/schema";
import { JobSchema } from "@/lib/jobs/schema";
import { parseAddress } from "@/lib/messaging/address";
import { Messenger, type TwilioMessagingApi } from "@/lib/messaging/outbound";
import { readStats } from "@/lib/stats";
import { eventObjects, Global } from "@/lib/sync/names";
import { SyncStore } from "@/lib/sync/store";
import type { ChatModel } from "@/lib/conversation/chat";
import type { MemoryClient } from "@/lib/twilio/memory";
import type { EmailVerifier } from "@/lib/twilio/verify";
import { FakeBlob } from "../support/fake-blob";
import { FakeSync } from "../support/fake-sync";

const WA = parseAddress("whatsapp:+447700900123")!;
const SMS = parseAddress("+447700900456")!;
let sid = 0;
const nextSid = () => `SM${(++sid).toString(16).padStart(32, "0")}`;

async function jpeg() {
  return sharp({ create: { width: 640, height: 800, channels: 3, background: "#c9a" } }).jpeg().toBuffer();
}

interface World {
  deps: Deps;
  fake: FakeSync;
  sync: SyncStore;
  blob: FakeBlob;
  events: EventRepo;
  sent: { to: string; body?: string; contentSid?: string }[];
  content: Map<string, Record<string, unknown>>;
  memory: { lookup: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn>; deleteProfile: ReturnType<typeof vi.fn> };
  /** What the fake chat model returns next: a reply, a deletion tool call, or a failure. */
  chat: { next: "reply" | "delete" | "fail"; text: string; calls: { developer: string; user: string }[] };
  verifier: { send: ReturnType<typeof vi.fn>; check: ReturnType<typeof vi.fn> };
  log: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  /** Sends a message and returns the reply texts (interactive messages resolve to their body). */
  say(from: typeof WA, text: string, extra?: Partial<InboundMessage>): Promise<string[]>;
}

async function world(): Promise<World> {
  const fake = new FakeSync();
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const sync = new SyncStore(fake, log, { baseDelayMs: 1, maxDelayMs: 2 });
  const blob = new FakeBlob();
  const events = new EventRepo(sync);
  await events.init();
  const sent: World["sent"] = [];
  const content = new Map<string, Record<string, unknown>>();
  const api: TwilioMessagingApi = {
    createMessage: vi.fn(async (p) => {
      sent.push({ to: p.to, body: p.body, contentSid: p.contentSid });
      return { sid: nextSid() };
    }),
    createContent: vi.fn(async (p) => {
      const id = `HX${(content.size + 1).toString(16).padStart(32, "0")}`;
      content.set(id, p.types);
      return { sid: id };
    }),
  };
  const messenger = new Messenger(api, sync, `MG${"0".repeat(32)}`, log);
  await messenger.init();
  await initInbound(sync);
  const memory = { lookup: vi.fn(async () => null), get: vi.fn(async () => null), upsert: vi.fn(async () => "mem_profile_new"), deleteProfile: vi.fn(async () => {}) };
  const verifier = { send: vi.fn(async () => "sent" as const), check: vi.fn(async () => "wrong" as const) };
  const image = await jpeg();
  const chat: World["chat"] = { next: "reply", text: "Hi! Send us a selfie.", calls: [] };
  const fakeChat = {
    responses: {
      create: vi.fn(async (p: { input: { role: string; content: string }[] }) => {
        chat.calls.push({ developer: p.input[0]!.content, user: p.input[1]!.content });
        if (chat.next === "fail") throw new Error("timeout");
        if (chat.next === "delete") return { output: [{ type: "function_call", name: "request_data_deletion", call_id: "c1", arguments: "{}" }], output_text: "" };
        return { output: [{ type: "message" }], output_text: chat.text };
      }),
    },
  };
  const deps: Deps = {
    sync,
    blob,
    events,
    messenger,
    memory: memory as unknown as MemoryClient,
    verifier: verifier as unknown as EmailVerifier,
    fetchMedia: async () => new Response(image, { headers: { "content-type": "image/jpeg" } }),
    slideUrl: (p: string) => `https://booth.test/m/${encodeURIComponent(p)}`,
    mediaUrl: (p: string) => `https://booth.test/m/${encodeURIComponent(p)}`,
    chat: { model: "fake-chat", client: fakeChat as unknown as ChatModel["client"] },
    log,
  };
  const w: World = {
    deps, fake, sync, blob, events, sent, content, memory, verifier, log, chat,
    async say(from, text, extra = {}) {
      const before = sent.length;
      await handleInbound(deps, { messageSid: nextSid(), from, text, media: [], ...extra });
      return sent.slice(before).map((m) => {
        if (m.body !== undefined) return m.body;
        const types = content.get(m.contentSid!)!;
        const t = (types["twilio/quick-reply"] ?? types["twilio/list-picker"]) as { body: string };
        return t.body;
      });
    },
  };
  return w;
}

const selfieMsg = { media: [{ url: "https://api.twilio.com/2010-04-01/Accounts/AC1/Messages/MM1/Media/ME1", contentType: "image/jpeg" }] };

async function liveEvent(w: World, slug: string, over: Partial<EventConfigInput> = {}) {
  await w.events.create(slug, { ...defaultConfig(`Event ${slug}`, "+13203780782"), ...over });
  await w.events.setState(slug, "live");
}

/** Plays the worker's role: the photo passed screening, menus open (D-18). */
async function passScreening(w: World, slug: string, key: string, subjects = 1) {
  const ev = eventObjects(slug);
  const [job] = (await jobs(w, slug)).filter((j) => j.state === "screening");
  expect(job, "a screening job exists").toBeDefined();
  await w.fake.updateItem(ev.jobs, job!.jobId, { ...job!, state: "awaiting_choice", subjects, pet: null });
  const cur = (await w.fake.getItem(ev.sessions, key))!;
  await w.fake.updateItem(ev.sessions, key, { ...(cur.data as object), step: "awaiting_style", pendingJobId: job!.jobId });
  return job!;
}

/** A print agent that is connected and has a ready printer, the normal condition at an event. Without it a print waits and the attendee is told the printer seems offline. */
async function printerOnline(w: World, slug: string, status = "idle") {
  await w.fake.putDocument(eventObjects(slug).printer, { agentVersion: "0.1.0", mode: "cups", queue: "DNP_DS620", status, detail: "", heartbeatAt: new Date().toISOString() });
}

async function jobs(w: World, slug: string) {
  const out = [];
  for await (const it of w.fake.listItems(eventObjects(slug).jobs)) out.push(JobSchema.parse(it.data));
  return out;
}

describe("inbound webhook handler (integration, mocked Twilio + Sync)", () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
  });

  it("no live event: standard reply", async () => {
    expect(await w.say(WA, "hello")).toEqual([catalogs.en.routing.noActiveEvent]);
  });

  it("Case C end to end: agree, selfie screened first, then menus, job queued", async () => {
    await liveEvent(w, "ev", { leadCollection: false, backgrounds: ["gradient", "solid-white"] });
    const first = await w.say(WA, "Hi! I want my portrait ev");
    expect(first[0]).toContain("Event ev");

    // A selfie before consent is kept as pending, but nothing proceeds.
    const early = await w.say(WA, "", selfieMsg);
    expect(early[0]).toBe(catalogs.en.consent.agreeReminder);
    expect(await jobs(w, "ev")).toEqual([]);

    const agreed = await w.say(WA, "", { selection: ACTION.agree });
    // The photo is checked before any menu (D-18).
    expect(agreed).toEqual([catalogs.en.selfie.usingPending, catalogs.en.selfie.checking]);
    expect((await jobs(w, "ev"))[0]).toMatchObject({ state: "screening", style: null });
    expect(await w.say(WA, "hello?")).toEqual([catalogs.en.selfie.stillChecking]);
    await passScreening(w, "ev", "whatsapp:+447700900123");

    expect(await w.say(WA, "2")).toEqual([catalogs.en.menus.backgroundBody]); // Pop Art
    expect(await w.say(WA, "white")).toEqual([catalogs.en.job.started]);

    const [job] = await jobs(w, "ev");
    expect(job).toMatchObject({ state: "queued", style: "pop-art", background: "solid-white", channel: "whatsapp", address: "whatsapp:+447700900123" });
    expect(job!.shareId.length).toBeGreaterThanOrEqual(22);
    expect(w.blob.blobs.has(job!.selfieBlob)).toBe(true);
    expect(w.memory.upsert).not.toHaveBeenCalled(); // no profile in Case C

    const lead = await w.fake.getItem(eventObjects("ev").leads, "whatsapp:+447700900123");
    expect(lead!.data).toMatchObject({ method: "agree_only", memoryProfileId: null });
  });

  it("Case B end to end over SMS: name, email, code, then selfie", async () => {
    await liveEvent(w, "ev", { styles: ["anime"], backgrounds: ["original"] });
    expect((await w.say(SMS, "#ev"))[0]).toContain("What's your full name?");
    expect((await w.say(SMS, "Ana Souza"))[0]).toContain("Thanks, Ana!");
    const askCode = await w.say(SMS, "ana@example.com");
    expect(askCode[0]).toContain("6-digit code to ana@example.com");
    expect(w.verifier.send).toHaveBeenCalledWith(expect.objectContaining({ email: "ana@example.com", locale: "en", substitutions: { event_name: "Event ev", show_snippet: "true" } }));

    expect((await w.say(SMS, "111111"))[0]).toContain("didn't work");
    w.verifier.check.mockResolvedValueOnce("approved");
    expect(await w.say(SMS, "123456")).toEqual([catalogs.en.selfie.ask]);
    expect(w.memory.upsert).toHaveBeenCalledWith({ firstName: "Ana", lastName: "Souza", email: "ana@example.com", phone: "+447700900456" });
    expect((await w.fake.getItem(Global.profileLinks, "mem_profile_new"))!.data).toEqual({ events: ["ev"] });

    // The photo is screened first; with one style and one background the worker then generates.
    expect(await w.say(SMS, "", selfieMsg)).toEqual([catalogs.en.selfie.checking]);
    expect(await jobs(w, "ev")).toHaveLength(1);
  });

  it("Case A: a returning profile only taps I agree", async () => {
    await liveEvent(w, "ev");
    w.memory.lookup.mockResolvedValueOnce({ id: "mem_profile_ana", contact: { firstName: "Ana" } });
    expect((await w.say(WA, "#ev"))[0]).toContain("Welcome back, Ana!");
    expect(w.memory.lookup).toHaveBeenCalledWith("whatsapp", "+447700900123");
    await w.say(WA, "", { selection: ACTION.agree });
    expect((await w.fake.getItem(eventObjects("ev").leads, "whatsapp:+447700900123"))!.data).toMatchObject({ method: "returning", memoryProfileId: "mem_profile_ana" });
    expect(w.verifier.send).not.toHaveBeenCalled();
  });

  it("falls back to the full flow if Memory is down", async () => {
    await liveEvent(w, "ev");
    w.memory.lookup.mockRejectedValueOnce(new Error("503"));
    expect((await w.say(WA, "#ev"))[0]).toContain("full name");
    expect(w.log.warn).toHaveBeenCalledWith(expect.objectContaining({ event: "memory_lookup_failed" }), expect.any(String));
  });

  it("ignores a duplicate MessageSid", async () => {
    await liveEvent(w, "ev");
    const msg = { messageSid: nextSid(), from: WA, text: "#ev", media: [] };
    await handleInbound(w.deps, msg);
    const count = w.sent.length;
    await handleInbound(w.deps, msg);
    expect(w.sent.length).toBe(count);
  });

  it("several live events: picker, then the answer binds", async () => {
    await liveEvent(w, "aaa", { leadCollection: false });
    await liveEvent(w, "bbb", { leadCollection: false });
    expect(await w.say(WA, "hello")).toEqual([catalogs.en.routing.pickEvent]);
    const r = await w.say(WA, "", { selection: "event:bbb" });
    expect(r[0]).toContain("Event bbb");
    expect((await w.fake.getItem(Global.bindings, "whatsapp:+447700900123"))!.data).toMatchObject({ eventSlug: "bbb" });
    // Bound now: later messages go to bbb without asking again.
    expect((await w.say(WA, "hi"))[0]).toBe(catalogs.en.consent.agreeReminder);
  });

  it("SMS picker uses a numbered list and accepts the number", async () => {
    await liveEvent(w, "aaa", { leadCollection: false });
    await liveEvent(w, "bbb", { leadCollection: false });
    await w.say(SMS, "hello");
    expect(w.sent.at(-1)!.body).toMatch(/1\. Event aaa\n2\. Event bbb/);
    expect((await w.say(SMS, "1"))[0]).toContain("Event aaa");
  });

  it("break and ended replies for the bound event", async () => {
    await liveEvent(w, "ev", { leadCollection: false });
    await w.say(WA, "#ev");
    await w.events.setState("ev", "break");
    expect(await w.say(WA, "hi")).toEqual([catalogs.en.routing.onBreak]);
    await w.events.setState("ev", "ended");
    expect(await w.say(WA, "hi")).toEqual([catalogs.en.routing.ended]);
  });

  it("an ended event keeps its attendees: any message gets the ended reply until another event is live (SPEC §4.1, D-13)", async () => {
    await liveEvent(w, "ev", { leadCollection: false });
    await w.say(WA, "#ev");
    await w.events.setState("ev", "ended");
    expect(await w.say(WA, "what now?")).toEqual([catalogs.en.routing.ended]);
    await liveEvent(w, "next", { leadCollection: false });
    expect((await w.say(WA, "hi"))[0]).toContain("Welcome to Portrait Studio");
  });

  it("replies in the event language (pt_BR)", async () => {
    await liveEvent(w, "rio", { language: "pt_BR", leadCollection: false });
    expect((await w.say(WA, "#rio"))[0]).toContain("Bem-vindo ao Portrait Studio");
  });

  it("enforces the per-person quota across selfies", async () => {
    await liveEvent(w, "ev", { leadCollection: false, styles: ["anime"], backgrounds: ["original"], maxImagesPerPerson: 1 });
    await w.say(WA, "#ev");
    await w.say(WA, "", { selection: ACTION.agree });
    expect(await w.say(WA, "", selfieMsg)).toEqual([catalogs.en.selfie.checking]);
    // A second photo during screening replaces the first: still one job slot.
    expect(await w.say(WA, "", selfieMsg)).toEqual([catalogs.en.selfie.checking]);
    expect((await jobs(w, "ev")).filter((j) => j.state !== "rejected")).toHaveLength(1);
    // Once that job is delivered the quota is used up.
    const ev = eventObjects("ev");
    const cur = (await w.fake.getItem(ev.sessions, "whatsapp:+447700900123"))!;
    await w.fake.updateItem(ev.sessions, "whatsapp:+447700900123", { ...(cur.data as object), step: "ready", pendingJobId: null, counters: { delivered: 1, printed: 0, printsReserved: 0, inFlight: 0 } });
    expect((await w.say(WA, "", selfieMsg))[0]).toContain("already used your 1 free portrait");
    // No new job for the refused photo (the superseded one stays as a rejected record).
    expect((await jobs(w, "ev")).filter((j) => j.state !== "rejected")).toHaveLength(1);
  });

  it("BUG 2: a photo sent while the first one is being screened supersedes it", async () => {
    await liveEvent(w, "ev", { leadCollection: false, styles: ["anime"], backgrounds: ["original"], maxImagesPerPerson: 3 });
    await w.say(WA, "#ev");
    await w.say(WA, "", { selection: ACTION.agree });
    await w.say(WA, "", selfieMsg);
    const [first] = await jobs(w, "ev");
    // The worker has claimed it and is screening right now.
    const ev = eventObjects("ev");
    await w.fake.updateItem(ev.jobs, first!.jobId, { ...first!, state: "processing", leaseUntil: new Date(Date.now() + 60_000).toISOString(), attempts: 1 });

    await w.say(WA, "", selfieMsg);

    const all = await jobs(w, "ev");
    const old = all.find((j) => j.jobId === first!.jobId)!;
    const fresh = all.find((j) => j.jobId !== first!.jobId)!;
    expect(old.state, "the photo being screened is superseded").toBe("rejected");
    expect(fresh.state).toBe("screening");
    expect(w.blob.blobs.has(old.selfieBlob), "its selfie is deleted").toBe(false);
  });

  it("remembers the booth number the person wrote to, so later messages come from it (D-43)", async () => {
    await liveEvent(w, "ev", { leadCollection: false });
    const key = "whatsapp:+447700900123";
    const read = async () => ((await w.fake.getItem(eventObjects("ev").sessions, key))!.data as { boothNumber: string | null }).boothNumber;
    await w.say(WA, "#ev", { to: "+447700900600" });
    expect(await read()).toBe("+447700900600");
    await w.say(WA, "hello", { to: "+13203780782" }); // wrote to another booth number later: that one now has the open window
    expect(await read()).toBe("+13203780782");
    await w.say(WA, "hello again"); // no recipient on this message: keep what we know
    expect(await read()).toBe("+13203780782");
  });

  it("rejects non-image media and multiple photos", async () => {
    await liveEvent(w, "ev", { leadCollection: false });
    await w.say(WA, "#ev");
    await w.say(WA, "", { selection: ACTION.agree });
    expect(await w.say(WA, "", { media: [{ url: "https://api.twilio.com/x", contentType: "audio/ogg" }] })).toEqual([catalogs.en.selfie.notAnImage]);
    const two = { media: [selfieMsg.media[0]!, selfieMsg.media[0]!] };
    expect(await w.say(WA, "", two)).toEqual([catalogs.en.selfie.oneAtATime]);
  });

  it("re-runs a message whose session changed concurrently", async () => {
    await liveEvent(w, "ev", { leadCollection: false });
    await w.say(WA, "#ev");
    const map = eventObjects("ev").sessions;
    let bumped = false;
    w.fake.beforeWrite = async (m, k) => {
      if (m !== map || bumped) return;
      bumped = true;
      const cur = await w.fake.getItem(m, k);
      await w.fake.updateItem(m, k, cur!.data); // another message wrote meanwhile
    };
    const r = await w.say(WA, "", { selection: ACTION.agree });
    expect(r).toContain(catalogs.en.selfie.ask);
    expect(w.log.warn).toHaveBeenCalledWith(expect.objectContaining({ event: "inbound_session_conflict" }), expect.any(String));
    expect((await w.fake.getItem(map, "whatsapp:+447700900123"))!.data).toMatchObject({ optedIn: true });
  });

  it("slideshow consent: only Yes for one's own delivered job adds it (SPEC §5.8)", async () => {
    await liveEvent(w, "ev", { leadCollection: false });
    await w.say(WA, "#ev");
    await w.say(WA, "", { selection: ACTION.agree });
    const ev = eventObjects("ev");
    const job = JobSchema.parse({
      jobId: "job_slide_01", address: "whatsapp:+447700900123", channel: "whatsapp", style: "anime", background: "gradient",
      selfieBlob: "events/ev/selfies/s.jpg", outputBlobs: { printPng: "events/ev/generated/job_slide_01.print.png", deliveryJpeg: "events/ev/generated/job_slide_01.jpg" },
      shareId: "Q".repeat(24), state: "delivered", timestamps: {},
    });
    await w.fake.createItem(ev.jobs, job.jobId, job);
    // Someone else's job cannot be added.
    await w.fake.createItem(ev.jobs, "job_other_01", { ...job, jobId: "job_other_01", address: "whatsapp:+447700900999" });

    expect(await w.say(WA, "", { selection: "ps:slide:no:job_slide_01" })).toEqual([catalogs.en.delivery.slideshowThanksNo]);
    expect(await w.fake.getItem(ev.slideshow, "job_slide_01").catch(() => null)).toBeNull();
    await w.say(WA, "", { selection: "ps:slide:yes:job_other_01" });
    expect(await w.fake.getItem(ev.slideshow, "job_other_01").catch(() => null)).toBeNull();
    expect(await w.say(WA, "", { selection: "ps:slide:yes:job_slide_01" })).toEqual([catalogs.en.delivery.slideshowThanksYes]);
    expect((await w.fake.getItem(ev.slideshow, "job_slide_01"))!.data).toMatchObject({ blobPath: "events/ev/generated/job_slide_01.jpg" });
  });

  it("slideshow consent on SMS uses exact keywords for the pending question", async () => {
    await liveEvent(w, "ev", { leadCollection: false });
    await w.say(SMS, "#ev");
    await w.say(SMS, "AGREE");
    const ev = eventObjects("ev");
    const key = "sms:+447700900456";
    await w.fake.createItem(ev.jobs, "job_slide_02", JobSchema.parse({
      jobId: "job_slide_02", address: key, channel: "sms", style: "anime", background: "gradient", selfieBlob: "s",
      outputBlobs: { printPng: "events/ev/generated/job_slide_02.print.png", deliveryJpeg: "events/ev/generated/job_slide_02.jpg" }, shareId: "R".repeat(24), state: "delivered", timestamps: {},
    }));
    const cur = (await w.fake.getItem(ev.sessions, key))!;
    await w.fake.updateItem(ev.sessions, key, { ...(cur.data as object), pendingSlideshow: { jobId: "job_slide_02", group: false, askedAt: new Date().toISOString() } });
    expect(await w.say(SMS, "yes please")).not.toContain(catalogs.en.delivery.slideshowThanksYes); // not an exact keyword
    expect(await w.say(SMS, "YES")).toEqual([catalogs.en.delivery.slideshowThanksYes]);
    expect(await w.fake.getItem(ev.slideshow, "job_slide_02")).not.toBeNull();
  });

  it("print + show: queues the chosen portrait once, within the print quota (D-24)", async () => {
    await liveEvent(w, "ev", { leadCollection: false, printingEnabled: true, maxPrintsPerPerson: 1 });
    await w.say(WA, "#ev");
    await w.say(WA, "", { selection: ACTION.agree });
    const ev = eventObjects("ev");
    const delivered = (id: string, address = "whatsapp:+447700900123") =>
      JobSchema.parse({
        jobId: id, address, channel: "whatsapp", style: "anime", background: "gradient", selfieBlob: "s",
        outputBlobs: { printPng: `events/ev/generated/${id}.print.png`, deliveryJpeg: `events/ev/generated/${id}.jpg` }, shareId: id.padEnd(24, "Q"), state: "delivered", timestamps: {},
      });
    for (const j of [delivered("job_print_01"), delivered("job_print_02"), delivered("job_print_99", "whatsapp:+447700900999")]) await w.fake.createItem(ev.jobs, j.jobId, j);

    // Someone else's portrait cannot be printed.
    expect(await w.say(WA, "", { selection: "ps:slide:print:job_print_99" })).toEqual([catalogs.en.delivery.printUnavailable]);

    // No print agent has connected in this test, so the print is queued but the attendee is told the printer seems offline.
    expect(await w.say(WA, "", { selection: "ps:slide:print:job_print_01" })).toEqual([catalogs.en.delivery.printQueuedPrinterOffline({ printsLeft: 0 })]);
    expect((await w.fake.getItem(ev.print, "job_print_01"))!.data).toMatchObject({ state: "queued", who: "whatsapp:+44…23", url: expect.stringContaining("job_print_01.print.png"), reprint: false });
    expect((await w.fake.getItem(ev.slideshow, "job_print_01"))!.data).toMatchObject({ blobPath: "events/ev/generated/job_print_01.jpg" });

    // A second tap while it is on its way does not print twice; another portrait finds the quota used.
    expect(await w.say(WA, "", { selection: "ps:slide:print:job_print_01" })).toEqual([catalogs.en.delivery.printAlready]);
    expect(await w.say(WA, "", { selection: "ps:slide:print:job_print_02" })).toEqual([catalogs.en.delivery.printNoneLeft]);
    expect(await w.fake.getItem(ev.print, "job_print_02").catch(() => null)).toBeNull();
    // Shown on the screen even without a print.
    expect(await w.fake.getItem(ev.slideshow, "job_print_02")).not.toBeNull();
    const session = (await w.fake.getItem(ev.sessions, "whatsapp:+447700900123"))!.data as { counters: { printsReserved: number } };
    expect(session.counters.printsReserved).toBe(1);
  });

  it("a stale YES/OK to an old slideshow question is not an answer (it shows nothing)", async () => {
    await liveEvent(w, "ev", { leadCollection: false });
    await w.say(SMS, "#ev");
    await w.say(SMS, "", { selection: ACTION.agree });
    const ev = eventObjects("ev");
    const key = "sms:+447700900456";
    await w.fake.createItem(ev.jobs, "job_stale_01", JobSchema.parse({
      jobId: "job_stale_01", address: key, channel: "sms", style: "anime", background: "gradient", selfieBlob: "s",
      outputBlobs: { printPng: "events/ev/generated/job_stale_01.print.png", deliveryJpeg: "events/ev/generated/job_stale_01.jpg" }, shareId: "T".repeat(24), state: "delivered", timestamps: {},
    }));
    const cur = (await w.fake.getItem(ev.sessions, key))!;
    const asked = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // asked half an hour ago, never answered
    await w.fake.updateItem(ev.sessions, key, { ...(cur.data as object), pendingSlideshow: { jobId: "job_stale_01", group: false, askedAt: asked } });
    await w.say(SMS, "ok");
    expect(await w.fake.getItem(ev.slideshow, "job_stale_01")).toBeNull();
  });

  it("print: with a print agent connected and the printer ready, the plain 'on its way' message", async () => {
    await liveEvent(w, "ev", { leadCollection: false, printingEnabled: true, maxPrintsPerPerson: 3 });
    await w.say(WA, "#ev");
    await w.say(WA, "", { selection: ACTION.agree });
    const ev = eventObjects("ev");
    await w.fake.createItem(ev.jobs, "job_print_ok", JobSchema.parse({
      jobId: "job_print_ok", address: "whatsapp:+447700900123", channel: "whatsapp", style: "anime", background: "gradient", selfieBlob: "s",
      outputBlobs: { printPng: "events/ev/generated/job_print_ok.print.png", deliveryJpeg: "events/ev/generated/job_print_ok.jpg" }, shareId: "OK".padEnd(24, "Q"), state: "delivered", timestamps: {},
    }));
    await w.fake.putDocument(ev.printer, { agentVersion: "0.1.0", mode: "cups", queue: "DNP_DS620", status: "idle", detail: "", heartbeatAt: new Date().toISOString() });
    expect(await w.say(WA, "", { selection: "ps:slide:print:job_print_ok" })).toEqual([catalogs.en.delivery.printQueued({ printsLeft: 2 })]);
  });

  it("print: an agent that is connected but out of paper still counts as offline for the attendee", async () => {
    await liveEvent(w, "ev", { leadCollection: false, printingEnabled: true, maxPrintsPerPerson: 3 });
    await w.say(WA, "#ev");
    await w.say(WA, "", { selection: ACTION.agree });
    const ev = eventObjects("ev");
    await w.fake.createItem(ev.jobs, "job_print_np", JobSchema.parse({
      jobId: "job_print_np", address: "whatsapp:+447700900123", channel: "whatsapp", style: "anime", background: "gradient", selfieBlob: "s",
      outputBlobs: { printPng: "events/ev/generated/job_print_np.print.png", deliveryJpeg: "events/ev/generated/job_print_np.jpg" }, shareId: "NP".padEnd(24, "Q"), state: "delivered", timestamps: {},
    }));
    await w.fake.putDocument(ev.printer, { agentVersion: "0.1.0", mode: "cups", queue: "DNP_DS620", status: "out_of_paper", detail: "", heartbeatAt: new Date().toISOString() });
    expect(await w.say(WA, "", { selection: "ps:slide:print:job_print_np" })).toEqual([catalogs.en.delivery.printQueuedPrinterOffline({ printsLeft: 2 })]);
  });

  it("print on SMS: PRINT answers the pending question only when printing was offered", async () => {
    await liveEvent(w, "ev", { leadCollection: false, printingEnabled: true, maxPrintsPerPerson: 2 });
    await printerOnline(w, "ev");
    await w.say(SMS, "#ev");
    await w.say(SMS, "AGREE");
    const ev = eventObjects("ev");
    const key = "sms:+447700900456";
    await w.fake.createItem(ev.jobs, "job_print_03", JobSchema.parse({
      jobId: "job_print_03", address: key, channel: "sms", style: "anime", background: "gradient", selfieBlob: "s",
      outputBlobs: { printPng: "events/ev/generated/job_print_03.print.png", deliveryJpeg: "events/ev/generated/job_print_03.jpg" }, shareId: "P".repeat(24), state: "delivered", timestamps: {},
    }));
    const cur = (await w.fake.getItem(ev.sessions, key))!;
    await w.fake.updateItem(ev.sessions, key, { ...(cur.data as object), pendingSlideshow: { jobId: "job_print_03", group: false, print: true, askedAt: new Date().toISOString() } });
    expect(await w.say(SMS, "PRINT")).toEqual([catalogs.en.delivery.printQueued({ printsLeft: 1 })]);
    expect(await w.fake.getItem(ev.print, "job_print_03")).not.toBeNull();
  });

  it("a failed print can be asked for again", async () => {
    await liveEvent(w, "ev", { leadCollection: false, printingEnabled: true, maxPrintsPerPerson: 2 });
    await printerOnline(w, "ev");
    await w.say(WA, "#ev");
    await w.say(WA, "", { selection: ACTION.agree });
    const ev = eventObjects("ev");
    await w.fake.createItem(ev.jobs, "job_print_04", JobSchema.parse({
      jobId: "job_print_04", address: "whatsapp:+447700900123", channel: "whatsapp", style: "anime", background: "gradient", selfieBlob: "s",
      outputBlobs: { printPng: "events/ev/generated/job_print_04.print.png", deliveryJpeg: "events/ev/generated/job_print_04.jpg" }, shareId: "F".repeat(24), state: "delivered", timestamps: {},
    }));
    await w.sync.ensureMap(ev.print);
    await w.fake.createItem(ev.print, "job_print_04", { jobId: "job_print_04", blobPath: "x", who: "w", state: "failed", attempts: 3, leaseUntil: null, error: "jam", reprint: false, timestamps: { queued: "2026-10-13T12:00:00.000Z" } });
    expect(await w.say(WA, "", { selection: "ps:slide:print:job_print_04" })).toEqual([catalogs.en.delivery.printQueued({ printsLeft: 1 })]);
    expect((await w.fake.getItem(ev.print, "job_print_04"))!.data).toMatchObject({ state: "queued", attempts: 0 });
  });

  it("PRINT any time lists the person's own portraits to print (D-28)", async () => {
    await liveEvent(w, "ev", { leadCollection: false, printingEnabled: true, maxPrintsPerPerson: 3 });
    await printerOnline(w, "ev");
    await w.say(WA, "#ev");
    await w.say(WA, "", { selection: ACTION.agree });
    const ev = eventObjects("ev");
    const key = "whatsapp:+447700900123";
    // Nothing delivered yet.
    expect(await w.say(WA, "can I print?")).toEqual([catalogs.en.delivery.printMenuEmpty]);

    const make = (id: string, style: "anime" | "sketch", address = key) =>
      JobSchema.parse({
        jobId: id, address, channel: "whatsapp", style, background: "gradient", selfieBlob: "s",
        outputBlobs: { printPng: `events/ev/generated/${id}.print.png`, deliveryJpeg: `events/ev/generated/${id}.jpg` }, shareId: id.padEnd(24, "M"), state: "delivered", timestamps: {},
      });
    for (const j of [make("job_menu_01", "anime"), make("job_menu_02", "sketch")]) await w.fake.createItem(ev.jobs, j.jobId, j);
    const cur = (await w.fake.getItem(ev.sessions, key))!;
    await w.fake.updateItem(ev.sessions, key, { ...(cur.data as object), delivered: ["job_menu_01", "job_menu_02"] });

    // Two portraits: a list, newest first.
    const before = w.sent.length;
    expect(await w.say(WA, "I'd like to Print another one")).toEqual([catalogs.en.delivery.printMenuMany({ printsLeft: 3 })]);
    const list = w.content.get(w.sent[before]!.contentSid!)!["twilio/list-picker"] as { items: { id: string; item: string }[] };
    expect(list.items.map((i) => i.id)).toEqual(["ps:slide:printonly:job_menu_02", "ps:slide:printonly:job_menu_01"]);
    expect(list.items.map((i) => i.item)).toEqual(["1. Sketch", "2. Anime"]);

    // Picking one prints it without putting it on the screen.
    expect(await w.say(WA, "", { selection: "ps:slide:printonly:job_menu_01" })).toEqual([catalogs.en.delivery.printQueued({ printsLeft: 2 })]);
    expect(await w.fake.getItem(ev.print, "job_menu_01")).not.toBeNull();
    expect(await w.fake.getItem(ev.slideshow, "job_menu_01").catch(() => null)).toBeNull();

    // While it is on its way, the menu offers only the other one.
    expect(await w.say(WA, "print")).toEqual([catalogs.en.delivery.printMenuOne({ styleName: "Sketch", printsLeft: 2 })]);
  });

  it("the selfie prompt mentions PRINT only when there is something to print", async () => {
    await liveEvent(w, "ev", { leadCollection: false, printingEnabled: true, maxPrintsPerPerson: 1 });
    await w.say(WA, "#ev");
    await w.say(WA, "", { selection: ACTION.agree });
    // The chat reply is unavailable here, so the fallback shows; the hint is added to either.
    w.chat.next = "fail";
    expect(await w.say(WA, "hello")).toEqual([catalogs.en.selfie.ask]);
    const ev = eventObjects("ev");
    const cur = (await w.fake.getItem(ev.sessions, "whatsapp:+447700900123"))!;
    await w.fake.updateItem(ev.sessions, "whatsapp:+447700900123", { ...(cur.data as object), delivered: ["job_menu_03"] });
    expect(await w.say(WA, "hello")).toEqual([`${catalogs.en.selfie.ask}\n${catalogs.en.delivery.printHint({ printsLeft: 1 })}`]);
    w.chat.next = "reply";
    expect(await w.say(WA, "hello")).toEqual([`${w.chat.text}\n${catalogs.en.delivery.printHint({ printsLeft: 1 })}`]);
  });

  it("SMS: PRINT then PRINT 2 picks the second portrait shown", async () => {
    await liveEvent(w, "ev", { leadCollection: false, printingEnabled: true, maxPrintsPerPerson: 2 });
    await printerOnline(w, "ev");
    await w.say(SMS, "#ev");
    await w.say(SMS, "AGREE");
    const ev = eventObjects("ev");
    const key = "sms:+447700900456";
    for (const [id, style] of [["job_sms_01", "anime"], ["job_sms_02", "sketch"]] as const)
      await w.fake.createItem(ev.jobs, id, JobSchema.parse({
        jobId: id, address: key, channel: "sms", style, background: "gradient", selfieBlob: "s",
        outputBlobs: { printPng: `events/ev/generated/${id}.print.png`, deliveryJpeg: `events/ev/generated/${id}.jpg` }, shareId: id.padEnd(24, "N"), state: "delivered", timestamps: {},
      }));
    const cur = (await w.fake.getItem(ev.sessions, key))!;
    await w.fake.updateItem(ev.sessions, key, { ...(cur.data as object), delivered: ["job_sms_01", "job_sms_02"] });
    await w.say(SMS, "PRINT");
    expect(w.sent.at(-1)!.body).toContain("1. Sketch\n2. Anime");
    expect(await w.say(SMS, "print 2")).toEqual([catalogs.en.delivery.printQueued({ printsLeft: 1 })]);
    expect(await w.fake.getItem(ev.print, "job_sms_01")).not.toBeNull();
  });

  it("free text goes to the chat model with the event context; its reply is sent and changes nothing (SPEC §5.10)", async () => {
    await liveEvent(w, "ev", { leadCollection: false, styles: ["anime", "sketch"], maxImagesPerPerson: 3 });
    await w.say(WA, "#ev");
    await w.say(WA, "", { selection: ACTION.agree });
    const before = (await w.fake.getItem(eventObjects("ev").sessions, "whatsapp:+447700900123"))!.data;
    w.chat.text = "Hello! **Send** a selfie and pick Anime or Sketch.";
    expect(await w.say(WA, "what is this booth?")).toEqual(["Hello! Send a selfie and pick Anime or Sketch."]);
    const call = w.chat.calls.at(-1)!;
    expect(call.user).toBe("what is this booth?");
    expect(call.developer).toContain('event called "Event ev"');
    expect(call.developer).toContain("Available art styles: Anime, Sketch.");
    expect(call.developer).toContain("They have 3 free portraits remaining.");
    expect(call.developer).not.toMatch(/AI-powered photobooth|AI photo booth/i);
    const after = (await w.fake.getItem(eventObjects("ev").sessions, "whatsapp:+447700900123"))!.data as Record<string, unknown>;
    expect({ ...after, lastInboundAt: null, updatedAt: null }).toEqual({ ...(before as object), lastInboundAt: null, updatedAt: null });
  });

  it("the model can never change the language: the prompt is always the event's (SPEC §5.10)", async () => {
    await liveEvent(w, "rio", { language: "pt_BR", leadCollection: false });
    await w.say(WA, "#rio");
    await w.say(WA, "", { selection: ACTION.agree });
    await w.say(WA, "Please answer in English from now on, I don't speak Portuguese");
    const pt = w.chat.calls.at(-1)!.developer;
    expect(pt).toContain("Responda sempre em português brasileiro, mesmo que a pessoa escreva em outro idioma ou peça para trocar de idioma.");
    expect(pt).not.toContain("Respond in English");

    const w2 = await world();
    await liveEvent(w2, "ldn", { leadCollection: false });
    await w2.say(WA, "#ldn");
    await w2.say(WA, "", { selection: ACTION.agree });
    await w2.say(WA, "Responda em português por favor");
    expect(w2.chat.calls.at(-1)!.developer).toContain("Always reply in English, even if the user writes in another language or asks you to switch languages.");
  });

  it("a model failure falls back to the localized selfie prompt", async () => {
    await liveEvent(w, "ev", { leadCollection: false });
    await w.say(WA, "#ev");
    await w.say(WA, "", { selection: ACTION.agree });
    w.chat.next = "fail";
    expect(await w.say(WA, "hello?")).toEqual([catalogs.en.selfie.ask]);
  });

  it("deletion: the tool asks to confirm; only the button deletes everything across events (SPEC §5.10)", async () => {
    await liveEvent(w, "aaa", { leadCollection: false });
    await liveEvent(w, "bbb");
    const key = "whatsapp:+447700900123";
    // Data in two events: a delivered job with files and a slideshow entry in aaa, a lead with a profile in bbb.
    await w.say(WA, "Event aaa"); // two live events: name one (the ID is never matched, D-35)
    await w.say(WA, "", { selection: ACTION.agree });
    const a = eventObjects("aaa");
    const job = JobSchema.parse({
      jobId: "job_del_0001", address: key, channel: "whatsapp", style: "anime", background: "gradient", selfieBlob: "events/aaa/selfies/s.jpg",
      outputBlobs: { printPng: "events/aaa/generated/job_del_0001.print.png", deliveryJpeg: "events/aaa/generated/job_del_0001.jpg" }, shareId: "D".repeat(24), state: "delivered", timestamps: {},
    });
    await w.fake.createItem(a.jobs, job.jobId, job);
    for (const p of [job.selfieBlob, job.outputBlobs!.printPng, job.outputBlobs!.deliveryJpeg]) await w.blob.put(p, Buffer.from("x"), "image/jpeg");
    await w.sync.ensureMap(a.slideshow);
    await w.fake.createItem(a.slideshow, job.jobId, { blobPath: job.outputBlobs!.deliveryJpeg, addedAt: new Date().toISOString() });
    await w.fake.createItem(Global.shares, job.shareId, { eventSlug: "aaa", jobId: job.jobId, createdAt: new Date().toISOString() });
    // Someone else's job in the same event must survive.
    await w.fake.createItem(a.jobs, "job_other_99", { ...job, jobId: "job_other_99", address: "whatsapp:+447700900999", shareId: "O".repeat(24) });
    const b = eventObjects("bbb");
    await w.sync.ensureMap(b.leads);
    await w.fake.createItem(b.leads, key, { memoryProfileId: "mem_profile_del", optedInAt: new Date().toISOString(), method: "verified_email" });
    await w.fake.createItem(Global.profileLinks, "mem_profile_del", { events: ["bbb"] });

    // 1. The model calls the tool: a confirmation, nothing deleted yet.
    w.chat.next = "delete";
    expect(await w.say(WA, "bitte lösche alle meine Daten")).toEqual([catalogs.en.deletion.confirm]);
    expect(await w.fake.getItem(a.jobs, job.jobId)).not.toBeNull();
    // Free text "yes" is not a confirmation on WhatsApp: it cancels.
    w.chat.next = "reply";
    expect(await w.say(WA, "yes")).toEqual([catalogs.en.deletion.cancelled]);
    expect(await w.fake.getItem(a.jobs, job.jobId)).not.toBeNull();

    // 2. Ask again and press Yes, delete.
    w.chat.next = "delete";
    await w.say(WA, "delete my data");
    expect(await w.say(WA, "", { selection: ACTION.deleteYes })).toEqual([catalogs.en.deletion.done]);

    for (const [m, k] of [[a.jobs, job.jobId], [a.slideshow, job.jobId], [a.sessions, key], [a.leads, key], [b.leads, key], [Global.bindings, key], [Global.shares, job.shareId], [Global.profileLinks, "mem_profile_del"]] as const)
      expect(await w.fake.getItem(m, k).catch(() => null), `${m}/${k}`).toBeNull();
    for (const p of [job.selfieBlob, job.outputBlobs!.printPng, job.outputBlobs!.deliveryJpeg]) expect(w.blob.blobs.has(p), p).toBe(false);
    expect(w.memory.deleteProfile).toHaveBeenCalledWith("mem_profile_del");
    expect(await w.fake.getItem(a.jobs, "job_other_99")).not.toBeNull();
    expect(await readStats(w.sync, "aaa")).toMatchObject({ deletionRequests: 1 });
  });

  it("deletion on SMS: the exact keyword confirms, only right after the question", async () => {
    await liveEvent(w, "ev", { leadCollection: false });
    await w.say(SMS, "#ev");
    await w.say(SMS, "AGREE");
    // Out of the blue, DELETE is just free text for the model.
    w.chat.next = "reply";
    await w.say(SMS, "DELETE");
    expect(await w.fake.getItem(eventObjects("ev").sessions, "sms:+447700900456")).not.toBeNull();
    w.chat.next = "delete";
    expect((await w.say(SMS, "remove my info please"))[0]).toContain("Reply DELETE to confirm");
    expect(await w.say(SMS, "delete")).toEqual([catalogs.en.deletion.done]);
    expect(await w.fake.getItem(eventObjects("ev").sessions, "sms:+447700900456").catch(() => null)).toBeNull();
  });

  it("a failure during deletion is not reported as done and can be retried", async () => {
    await liveEvent(w, "ev", { leadCollection: false });
    await w.say(WA, "#ev");
    await w.say(WA, "", { selection: ACTION.agree });
    const b = eventObjects("ev");
    await w.fake.updateItem(b.leads, "whatsapp:+447700900123", { memoryProfileId: "mem_profile_x", optedInAt: new Date().toISOString(), method: "verified_email" });
    w.memory.deleteProfile.mockRejectedValueOnce(new Error("503"));
    w.chat.next = "delete";
    await w.say(WA, "delete everything");
    await expect(handleInbound(w.deps, { messageSid: nextSid(), from: WA, text: "", selection: ACTION.deleteYes, media: [] })).rejects.toThrow("503");
    expect(w.sent.map((m) => m.body)).not.toContain(catalogs.en.deletion.done);
    expect(await readStats(w.sync, "ev")).not.toMatchObject({ deletionRequests: 1 });
  });

  it("logs addresses masked, never in full", async () => {
    await liveEvent(w, "ev", { leadCollection: false });
    await w.say(WA, "#ev");
    const logged = JSON.stringify([...w.log.info.mock.calls, ...w.log.warn.mock.calls]);
    expect(logged).not.toContain("447700900123");
  });
});
