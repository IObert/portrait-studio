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
import { eventObjects, Global } from "@/lib/sync/names";
import { SyncStore } from "@/lib/sync/store";
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
  memory: { lookup: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn>; erase: ReturnType<typeof vi.fn> };
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
  const memory = { lookup: vi.fn(async () => null), upsert: vi.fn(async () => "mem_profile_new"), erase: vi.fn(async () => {}) };
  const verifier = { send: vi.fn(async () => "sent" as const), check: vi.fn(async () => "wrong" as const) };
  const image = await jpeg();
  const deps: Deps = {
    sync,
    blob,
    events,
    messenger,
    memory: memory as unknown as MemoryClient,
    verifier: verifier as unknown as EmailVerifier,
    fetchMedia: async () => new Response(image, { headers: { "content-type": "image/jpeg" } }),
    publicBaseUrl: "https://booth.test",
    log,
  };
  const w: World = {
    deps, fake, sync, blob, events, sent, content, memory, verifier, log,
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

  it("Case C end to end: agree, selfie, menus, job queued", async () => {
    await liveEvent(w, "ev", { leadCollection: false, backgrounds: ["gradient", "solid-white"] });
    const first = await w.say(WA, "Hi! I want my AI portrait #ev");
    expect(first[0]).toContain("Welcome to the AI photo booth at Event ev");
    expect(first[0]).toContain("https://booth.test/privacy/ev");

    // A selfie before consent is kept as pending, but nothing proceeds.
    const early = await w.say(WA, "", selfieMsg);
    expect(early[0]).toBe(catalogs.en.consent.agreeReminder);
    expect(await jobs(w, "ev")).toEqual([]);

    const agreed = await w.say(WA, "", { selection: ACTION.agree });
    expect(agreed[0]).toBe(catalogs.en.selfie.usingPending);
    expect(agreed[1]).toBe(catalogs.en.menus.styleBody);

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
    expect(w.verifier.send).toHaveBeenCalledWith(expect.objectContaining({ email: "ana@example.com", locale: "en", substitutions: expect.objectContaining({ consent_text: expect.stringContaining("https://booth.test/privacy/ev") }) }));

    expect((await w.say(SMS, "111111"))[0]).toContain("didn't work");
    w.verifier.check.mockResolvedValueOnce("approved");
    expect(await w.say(SMS, "123456")).toEqual([catalogs.en.selfie.ask]);
    expect(w.memory.upsert).toHaveBeenCalledWith({ firstName: "Ana", lastName: "Souza", email: "ana@example.com", phone: "+447700900456" });
    expect((await w.fake.getItem(Global.profileLinks, "mem_profile_new"))!.data).toEqual({ events: ["ev"] });

    // One style and one background: menus are skipped.
    expect(await w.say(SMS, "", selfieMsg)).toEqual([catalogs.en.job.started]);
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

  it("replies in the event language (pt_BR)", async () => {
    await liveEvent(w, "rio", { language: "pt_BR", leadCollection: false });
    expect((await w.say(WA, "#rio"))[0]).toContain("Bem-vindo à cabine de fotos com IA");
  });

  it("enforces the per-person quota across selfies", async () => {
    await liveEvent(w, "ev", { leadCollection: false, styles: ["anime"], backgrounds: ["original"], maxImagesPerPerson: 1 });
    await w.say(WA, "#ev");
    await w.say(WA, "", { selection: ACTION.agree });
    expect(await w.say(WA, "", selfieMsg)).toEqual([catalogs.en.job.started]);
    expect((await w.say(WA, "", selfieMsg))[0]).toContain("already used your 1 free portrait");
    expect(await jobs(w, "ev")).toHaveLength(1);
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

  it("logs addresses masked, never in full", async () => {
    await liveEvent(w, "ev", { leadCollection: false });
    await w.say(WA, "#ev");
    const logged = JSON.stringify([...w.log.info.mock.calls, ...w.log.warn.mock.calls]);
    expect(logged).not.toContain("447700900123");
  });
});
