import { randomBytes } from "node:crypto";
import { z } from "zod";
import { catalogs } from "../../i18n";
import type { Catalog } from "../../i18n/types";
import type { BlobStore } from "../blob/store";
import { BlobPaths } from "../blob/paths";
import type { EventRepo } from "../events/repo";
import type { PortraitEvent } from "../events/schema";
import { JobSchema, type Job } from "../jobs/schema";
import { type Address, keyOf, mask } from "../messaging/address";
import type { Messenger, OutboundMessage } from "../messaging/outbound";
import { eventObjects, Global } from "../sync/names";
import { ConcurrentModification, SKIP, type SyncStore } from "../sync/store";
import type { InboundMedia } from "../twilio/inbound";
import type { MemoryClient } from "../twilio/memory";
import type { EmailVerifier } from "../twilio/verify";
import { canPrintAgain, printsLeft, requestPrint } from "../delivery/print-request";
import { PrintJobSchema } from "../delivery/print-schema";
import { ACTION_SLIDESHOW } from "./actions";
import { normalize } from "./text";
import { readSlideshowAnswer, SlideshowItemSchema } from "../delivery/slideshow";
import { PRIVACY_NOTICE_URL } from "../privacy";
import { bump } from "../stats";
import { advanceConsent, beginConsent, type ConsentEffect } from "./consent";
import { verificationEmailSubstitutions } from "./email-substitutions";
import { downloadSelfie, isImage, type MediaFetch } from "./media";
import { resolvePick, route } from "./routing";
import { type ChatModel, chatReply } from "./chat";
import { ACTION } from "./consent";
import { deleteAddressData } from "./deletion";
import { afterOptIn, handleSelfieFlow, quotaLeft, type SelfieEffect } from "./selfie";
import { newSession, type Session, SessionSchema } from "./session";

/** Sync TTLs (docs/decisions.md D-05): 7 days for attendee data, 24h for dedup (SPEC §3.4). */
const SEVEN_DAYS = 7 * 24 * 60 * 60;
const DEDUP_TTL = 24 * 60 * 60;

const BindingSchema = z.object({ eventSlug: z.string(), boundAt: z.iso.datetime() });
const DedupSchema = z.object({ receivedAt: z.iso.datetime() });
const LeadSchema = z.object({
  memoryProfileId: z.string().nullable(),
  optedInAt: z.iso.datetime(),
  method: z.enum(["verified_email", "returning", "agree_only"]),
});
const ProfileLinksSchema = z.object({ events: z.array(z.string()) });
/** Pending event choice when several events are live (SPEC §5.2), keyed by address. */
const PickSchema = z.object({ slugs: z.array(z.string()), askedAt: z.iso.datetime() });

export interface InboundMessage {
  messageSid: string;
  from: Address;
  /** The booth number the attendee wrote to (E.164); replies come from it. */
  to?: string;
  text: string;
  selection?: string;
  media: InboundMedia[];
}

export interface Deps {
  sync: SyncStore;
  blob: BlobStore;
  events: EventRepo;
  messenger: Messenger;
  memory: MemoryClient;
  verifier: EmailVerifier;
  fetchMedia: MediaFetch;
  publicBaseUrl: string;
  /** Signed, long-lived link for a slideshow image (D-17). */
  slideUrl: (blobPath: string) => string;
  /** Signed link for the print agent to download a print PNG (D-24). */
  mediaUrl: (blobPath: string, ttlSeconds: number) => string;
  /** Chat model for free-text replies (SPEC §5.10). Without it, free text gets the selfie prompt. */
  chat?: ChatModel;
  log: { info(o: object, m: string): void; warn(o: object, m: string): void; error(o: object, m: string): void };
  now?: () => Date;
}

/** Ensures the global maps exist. Idempotent; call once per process. */
export async function initInbound(sync: SyncStore) {
  await Promise.all(
    [Global.bindings, Global.profileLinks, Global.contentCache, Global.shares, ...Global.allDedup(), "picks"].map((m) => sync.ensureMap(m)),
  );
}

/** Per-event maps are created when an event first receives traffic. */
async function ensureEventMaps(sync: SyncStore, slug: string) {
  const ev = eventObjects(slug);
  await Promise.all([ev.sessions, ev.jobs, ev.leads].map((m) => sync.ensureMap(m)));
}

/**
 * Handles one inbound message end to end (SPEC §5.1–§5.5). Runs inside the
 * webhook request: only short state transitions, generation is queued for the
 * worker. Returns after replies are sent.
 */
export async function handleInbound(deps: Deps, msg: InboundMessage): Promise<void> {
  // Two messages from one person can race on their session. Twilio does not
  // reliably retry messaging webhooks, so re-run the whole message here.
  for (let attempt = 1; ; attempt++) {
    try {
      return await handleOnce(deps, msg);
    } catch (err) {
      if (!(err instanceof ConcurrentModification) || attempt >= 3) throw err;
      deps.log.warn({ event: "inbound_session_conflict", messageSid: msg.messageSid, attempt }, "session changed concurrently; re-running message");
    }
  }
}

async function handleOnce(deps: Deps, msg: InboundMessage): Promise<void> {
  const now = deps.now?.() ?? new Date();
  const { sync } = deps;

  // 1. Dedup: Twilio retries webhooks; process each MessageSid once (SPEC §5.1).
  // The claim is released if processing fails, so a retry can complete it.
  const dedup = sync.map(Global.dedup(msg.messageSid), DedupSchema, { ttlSeconds: DEDUP_TTL });
  if (!(await dedup.create(msg.messageSid, { receivedAt: now.toISOString() }))) {
    deps.log.info({ event: "inbound_duplicate", messageSid: msg.messageSid }, "duplicate message ignored");
    return;
  }
  try {
    await process(deps, msg, now);
  } catch (err) {
    await dedup.delete(msg.messageSid).catch(() => {});
    throw err;
  }
}

async function process(deps: Deps, msg: InboundMessage, now: Date): Promise<void> {
  const { sync } = deps;

  // 2. Route to an event (SPEC §5.2).
  const key = keyOf(msg.from);
  const bindings = sync.map(Global.bindings, BindingSchema);
  const picks = sync.map("picks", PickSchema, { ttlSeconds: 60 * 60 });
  const [events, binding, pendingPick] = await Promise.all([deps.events.list(), bindings.get(key), picks.get(key)]);

  let event: PortraitEvent | undefined;
  let bind = false;
  if (pendingPick && !binding) {
    // Same order as shown in the picker, so "2" means the second item the person saw.
    const live = pendingPick.slugs
      .map((slug) => events.find((e) => e.slug === slug && e.state === "live"))
      .filter((e): e is PortraitEvent => !!e);
    const picked = resolvePick({ selection: msg.selection, text: msg.text }, live);
    if (picked) {
      event = picked;
      bind = true;
      await picks.delete(key);
    }
  }
  if (!event) {
    const r = route(msg.text, events, binding);
    if (r.kind === "none") return reply(deps, msg.from, msg.to, [{ kind: "text", body: defaultCatalog(events).routing.noActiveEvent }], now);
    if (r.kind === "not-live") {
      const c = catalogs[r.event.config.language];
      return reply(deps, msg.from, msg.to, [{ kind: "text", body: r.event.state === "break" ? c.routing.onBreak : c.routing.ended }], now, r.event.config.language);
    }
    if (r.kind === "pick") {
      // Language is per event; with several candidates, use the first live event's language.
      const c = catalogs[r.live[0]!.config.language];
      await picks.put(key, { slugs: r.live.map((e) => e.slug), askedAt: now.toISOString() });
      if (pendingPick) await reply(deps, msg.from, msg.to, [{ kind: "text", body: c.routing.pickEventInvalid }], now, r.live[0]!.config.language);
      return reply(deps, msg.from, msg.to, [eventPicker(c, r.live)], now, r.live[0]!.config.language);
    }
    event = r.event;
    bind = r.bind;
  }

  if (bind) {
    await bindings.put(key, { eventSlug: event.slug, boundAt: now.toISOString() });
    deps.log.info({ event: "address_bound", slug: event.slug, to: mask(msg.from) }, "address bound to event");
  }

  await ensureEventMaps(sync, event.slug);
  await bump(sync, event.slug, "interactions");
  await handleForEvent(deps, msg, event, now);
}

function defaultCatalog(events: PortraitEvent[]): Catalog {
  // No event: use the language of the most recent visible event, else English.
  const recent = events.find((e) => e.state !== "draft");
  return catalogs[recent?.config.language ?? "en"];
}

function eventPicker(c: Catalog, live: PortraitEvent[]): OutboundMessage {
  const items = live.slice(0, 10).map((e) => ({ id: `event:${e.slug}`, title: e.config.name }));
  const smsBody = `${c.routing.pickEvent}\n\n${live.map((e, i) => `${i + 1}. ${e.config.name}`).join("\n")}\n\n${c.routing.pickEventReplyHint}`;
  if (live.length <= 3) return { kind: "buttons", body: c.routing.pickEvent, buttons: items, smsBody };
  // More than 10 live events: numbered text list everywhere (docs/decisions.md).
  if (live.length > 10) return { kind: "text", body: smsBody };
  return { kind: "list", body: c.routing.pickEvent, button: c.routing.pickEventButton, items, smsBody };
}

/** Everything after routing: consent gate, then selfie and menus. */
async function handleForEvent(deps: Deps, msg: InboundMessage, event: PortraitEvent, now: Date) {
  const { sync } = deps;
  const ev = eventObjects(event.slug);
  const key = keyOf(msg.from);
  const c = catalogs[event.config.language];
  const locale = event.config.language;
  const privacyUrl = PRIVACY_NOTICE_URL;
  const sessions = sync.map(ev.sessions, SessionSchema, { ttlSeconds: SEVEN_DAYS });

  // Store a selfie before touching state, so the session only references blobs that exist.
  // (On a re-run after a conflict the selfie is stored again under a new path; the
  // unreferenced copy expires with the 7-day lifecycle rule.)
  const images = msg.media.filter(isImage);
  let selfieBlob: string | undefined;
  if (images.length === 1) {
    const jpeg = await downloadSelfie(images[0]!, deps.fetchMedia);
    if (jpeg) {
      selfieBlob = BlobPaths.selfie(event.slug);
      await deps.blob.put(selfieBlob, jpeg, "image/jpeg");
    }
  }
  const unusableMedia = msg.media.length > 0 && images.length === 0;

  const read = await sessions.getVersioned(key);
  const current: Session = { ...(read?.data ?? newSession(locale, now)), locale, lastInboundAt: now.toISOString(), updatedAt: now.toISOString() };

  // Side effects (Verify, Memory) need answers before the state can be decided, so
  // they run first and their results feed the pure step functions.
  const consentInput = { channel: msg.from.channel, text: msg.text, selection: msg.selection };
  const outcome = await decide(deps, current, event, c, consentInput, privacyUrl, msg, selfieBlob, unusableMedia, images.length);

  // Run critical effects (opt-in) BEFORE writing the session so they can't fail after commitment (BUG 3).
  const messages = [...outcome.messages];
  const otherEffects = [];
  for (const effect of outcome.effects) {
    if (effect.type === "opt-in") {
      const extra = await runEffect(deps, effect, { event, key, address: msg.from, now, session: outcome.session });
      if (extra) messages.push(extra);
    } else {
      otherEffects.push(effect);
    }
  }

  // Write with If-Match against the revision we read. If another message for this
  // person changed the session meanwhile, this throws, the dedup claim is
  // released and handleInbound re-runs the message on the fresh state.
  await sessions.writeIfUnchanged(key, outcome.session, read?.revision ?? null);

  for (const effect of otherEffects) {
    const extra = await runEffect(deps, effect, { event, key, address: msg.from, now, session: outcome.session });
    if (extra) messages.push(extra);
  }
  await reply(deps, msg.from, msg.to, messages, now, locale, outcome.session.lastInboundAt);
}

type SlideshowEffect = { type: "slideshow"; jobId: string; answer: "print" | "printonly" | "yes" | "no" };
/** "print" typed any time: list the person's portraits to print (D-28). */
type PrintMenuEffect = { type: "print-menu" };
/** "Yes, delete" confirmed (SPEC §5.10). */
type DeleteEffect = { type: "delete-data" };

interface Outcome {
  session: Session;
  messages: OutboundMessage[];
  effects: (ConsentEffect | SelfieEffect | SlideshowEffect | PrintMenuEffect | DeleteEffect)[];
}

async function decide(
  deps: Deps,
  session: Session,
  event: PortraitEvent,
  c: Catalog,
  input: { channel: Address["channel"]; text: string; selection?: string },
  privacyUrl: string,
  msg: InboundMessage,
  selfieBlob: string | undefined,
  unusableMedia: boolean,
  imageCount: number,
): Promise<Outcome> {
  if (!session.optedIn) {
    // Keep a selfie sent before opt-in as the pending selfie (SPEC §5.4).
    if (selfieBlob) {
      if (session.pendingSelfie) await deps.blob.delete(session.pendingSelfie);
      session = { ...session, pendingSelfie: selfieBlob };
    }

    let r;
    if (session.step === "new") {
      const profile = await lookupProfile(deps, msg.from);
      r = beginConsent(session, event, c, profile, privacyUrl, input.channel);
    } else {
      r = advanceConsent(session, event, c, input, privacyUrl);
      // Effects that need an answer before the next state is known.
      const pre = r.effects.find((e) => e.type === "send-code" || e.type === "resend-code" || e.type === "check-code");
      if (pre?.type === "check-code") {
        r = advanceConsent(session, event, c, input, privacyUrl, await deps.verifier.check({ email: pre.email, code: pre.code }));
      } else if (pre) {
        const sent = await deps.verifier.send({
          email: pre.email,
          locale: event.config.language,
          substitutions: verificationEmailSubstitutions(event),
        });
        r = advanceConsent(session, event, c, input, privacyUrl, undefined, sent);
      }
    }

    if (r.effects.some((e) => e.type === "proceed")) {
      const next = afterOptIn(r.session, event, c, newJobId());
      return { session: next.session, messages: [...r.messages, ...next.messages], effects: [...r.effects.filter((e) => e.type === "opt-in"), ...next.effects] };
    }
    return { session: r.session, messages: r.messages, effects: [] };
  }

  // Deletion confirmation (SPEC §5.10), before anything else. The button payload always counts (it
  // can only come from the confirmation); on SMS the exact keyword counts only right after the question.
  const smsYes = input.channel === "sms" && session.pendingDeletionConfirm && normalize(input.text) === normalize(c.deletion.yesKeyword);
  if (input.selection === ACTION.deleteYes || smsYes) {
    return { session: { ...session, pendingDeletionConfirm: false }, messages: [], effects: [{ type: "delete-data" }] };
  }
  if (session.pendingDeletionConfirm) {
    session = { ...session, pendingDeletionConfirm: false };
    // Cancel, or any other text, cancels. A photo is handled as usual.
    if (input.selection === ACTION.deleteCancel || imageCount === 0) return { session, messages: [{ kind: "text", body: c.deletion.cancelled }], effects: [] };
  } else if (input.selection === ACTION.deleteCancel) {
    return { session, messages: [{ kind: "text", body: c.deletion.cancelled }], effects: [] };
  }

  // Answer to the print / slideshow question (SPEC §5.8, D-24), before anything else.
  // A print reply is sent by the effect, once the print is (or is not) queued.
  if (imageCount === 0) {
    const answer = readSlideshowAnswer(session, c, input);
    if (answer) {
      return {
        session: session.pendingSlideshow?.jobId === answer.jobId ? { ...session, pendingSlideshow: null } : session,
        messages: answer.answer === "print" || answer.answer === "printonly" ? [] : [{ kind: "text", body: answer.answer === "yes" ? c.delivery.slideshowThanksYes : c.delivery.slideshowThanksNo }],
        effects: [{ type: "slideshow", jobId: answer.jobId, answer: answer.answer }],
      };
    }
  }

  if (unusableMedia) return { session, messages: [{ kind: "text", body: c.selfie.notAnImage }], effects: [] };
  // "print" in a message, when nothing else is waiting for an answer (D-28).
  if (imageCount === 0 && session.step === "ready" && event.config.printingEnabled && mentionsPrint(input.text, c)) {
    return { session, messages: [], effects: [{ type: "print-menu" }] };
  }
  const r = handleSelfieFlow(session, event, c, { text: input.text, selection: input.selection, images: imageCount, selfieBlob, newJobId: newJobId() });
  // Free text with no active step: the chat model answers, or asks to confirm a deletion (SPEC §5.10).
  if (!r.handled) {
    const outcome = deps.chat && input.text.trim() ? await chatReply(deps.chat, event.config.language, chatContext(event, c, session), input.text) : ({ kind: "unavailable" } as const);
    if (outcome.kind === "deletion-requested") {
      const body = c.deletion.confirm;
      return {
        session: { ...session, pendingDeletionConfirm: true },
        messages: [{ kind: "buttons", body, buttons: [{ id: ACTION.deleteYes, title: c.deletion.yes }, { id: ACTION.deleteCancel, title: c.deletion.cancel }], smsBody: `${body} ${c.deletion.smsHint({ keyword: c.deletion.yesKeyword })}` }],
        effects: [],
      };
    }
    const left = printsLeft(event, session.counters);
    const hint = left > 0 && session.delivered.length > 0 ? `\n${c.delivery.printHint({ printsLeft: left })}` : "";
    // The model's reply, or the localized selfie prompt if it is unavailable. It never changes state.
    const body = outcome.kind === "reply" ? outcome.text : c.selfie.ask;
    return { session, messages: [{ kind: "text", body: `${body}${hint}` }], effects: [] };
  }
  return { session: r.session, messages: r.messages, effects: r.effects };
}

// TODO(profile-deletion): a profile deleted by us or another app looks like a new person here, so consent starts again (D-12).
const newJobId = () => randomBytes(12).toString("base64url");

async function lookupProfile(deps: Deps, from: Address) {
  try {
    const p = await deps.memory.lookup(from.channel === "whatsapp" ? "whatsapp" : "phone", from.e164);
    return p ? { id: p.id, firstName: p.contact.firstName } : null;
  } catch (err) {
    // Recognition is a convenience, not a safety check: fall back to the full consent flow.
    deps.log.warn({ event: "memory_lookup_failed", err: (err as Error).message }, "memory lookup failed");
    return null;
  }
}

/** Runs one effect; may return a reply that depends on its outcome. */
async function runEffect(
  deps: Deps,
  effect: ConsentEffect | SelfieEffect | SlideshowEffect | PrintMenuEffect | DeleteEffect,
  ctx: { event: PortraitEvent; key: string; address: Address; now: Date; session: Session },
): Promise<OutboundMessage | void> {
  const { sync } = deps;
  const ev = eventObjects(ctx.event.slug);
  switch (effect.type) {
    case "opt-in": {
      let profileId = effect.memoryProfileId;
      if (effect.method === "verified_email") {
        // Create or update the profile with name, verified email and channel address (SPEC §5.4).
        // TODO(profile-deletion): we write name/email into a shared profile; who owns it and who may delete it is open (D-12).
        profileId = await deps.memory.upsert({
          firstName: effect.firstName,
          lastName: effect.lastName,
          email: effect.email,
          [ctx.address.channel === "whatsapp" ? "whatsapp" : "phone"]: ctx.address.e164,
        });
      }
      await sync.map(ev.leads, LeadSchema).put(ctx.key, { memoryProfileId: profileId, optedInAt: ctx.now.toISOString(), method: effect.method });
      if (profileId) {
        const pid = profileId;
        await sync.map(Global.profileLinks, ProfileLinksSchema).update(pid, (cur) => {
          const events = new Set(cur?.events ?? []);
          if (events.has(ctx.event.slug)) return SKIP;
          events.add(ctx.event.slug);
          return { events: [...events] };
        });
      }
      await bump(sync, ctx.event.slug, "uniqueOptIns");
      await bump(sync, ctx.event.slug, effect.method === "verified_email" ? "leadsVerifiedEmail" : effect.method === "returning" ? "leadsReturning" : "leadsAgreeOnly");
      deps.log.info({ event: "opted_in", slug: ctx.event.slug, method: effect.method }, "attendee opted in");
      return;
    }
    case "create-job": {
      // Created in `screening`: the worker checks the photo before any menu (D-18).
      const job: Job = JobSchema.parse({
        jobId: effect.jobId,
        address: ctx.key,
        channel: ctx.address.channel,
        style: null,
        background: null,
        selfieBlob: effect.selfieBlob,
        shareId: randomBytes(18).toString("base64url"),
        state: "screening",
        timestamps: { screening: ctx.now.toISOString() },
      });
      // TODO(scalability): the jobs map is an expected hot spot (SPEC §3.4).
      await sync.map(ev.jobs, JobSchema, { ttlSeconds: SEVEN_DAYS }).create(effect.jobId, job);
      await bump(sync, ctx.event.slug, "imagesRequested");
      deps.log.info({ event: "job_screening", slug: ctx.event.slug, jobId: effect.jobId }, "photo queued for screening");
      return;
    }
    case "choose": {
      const now = ctx.now.toISOString();
      const updated = await sync.map(ev.jobs, JobSchema).update(effect.jobId, (cur) => {
        // Only the attendee's own job, after screening passed.
        if (!cur || cur.address !== ctx.key || cur.state !== "awaiting_choice") return SKIP;
        const next = { ...cur, style: effect.style ?? cur.style, background: effect.background ?? cur.background };
        return effect.start ? { ...next, state: "queued", timestamps: { ...cur.timestamps, queued: now } } : next;
      });
      if (effect.start && updated?.state === "queued" && updated.style && updated.background) {
        await bump(sync, ctx.event.slug, `style:${updated.style}`);
        await bump(sync, ctx.event.slug, `background:${updated.background}`);
        deps.log.info({ event: "job_queued", slug: ctx.event.slug, jobId: effect.jobId, style: updated.style, background: updated.background }, "job queued");
      }
      return;
    }
    case "supersede-job": {
      // A newer photo replaced this one before generation: drop it and its selfie.
      let selfie: string | null = null;
      await sync.map(ev.jobs, JobSchema).update(effect.jobId, (cur) => {
        if (!cur || cur.address !== ctx.key || !["screening", "awaiting_choice"].includes(cur.state)) return SKIP;
        selfie = cur.selfieBlob;
        return { ...cur, state: "rejected", error: "superseded", leaseUntil: null, timestamps: { ...cur.timestamps, rejected: ctx.now.toISOString() } };
      });
      if (selfie) await deps.blob.delete(selfie);
      return;
    }
    case "discard-blob":
      await deps.blob.delete(effect.blobPath);
      return;
    case "slideshow": {
      if (effect.answer === "no") return; // "No" or no answer: never shown (SPEC §5.8)
      let printReply: OutboundMessage | undefined;
      if (effect.answer === "print" || effect.answer === "printonly") {
        // Print + show (D-24): the print is requested first; the portrait is shown either way.
        const d = catalogs[ctx.event.config.language].delivery;
        const r = await requestPrint({ sync, mediaUrl: deps.mediaUrl }, ctx.event, ctx.key, ctx.address, effect.jobId, ctx.now);
        const body = r.status === "queued" ? d.printQueued({ printsLeft: r.printsLeft }) : r.status === "none-left" ? d.printNoneLeft : r.status === "already" ? d.printAlready : d.printUnavailable;
        printReply = { kind: "text", body };
        deps.log.info({ event: "print_requested", slug: ctx.event.slug, jobId: effect.jobId, result: r.status }, "print requested");
      }
      // Print only (the print menu) leaves the screen choice as it was.
      if (effect.answer !== "printonly") await addToSlideshow(deps, ctx, effect.jobId);
      return printReply;
    }
    case "print-menu":
      return printMenu(deps, ctx);
    case "delete-data": {
      const r = await deleteAddressData(deps, ctx.key, ctx.event.slug);
      const d = catalogs[ctx.event.config.language].deletion;
      return { kind: "text", body: r.printing > 0 ? d.donePrinting : d.done };
    }
    default:
      return;
  }
}

/** What the chat model may know (SPEC §5.10): event name, enabled styles, remaining portraits. */
function chatContext(event: PortraitEvent, c: Catalog, session: Session) {
  return { eventName: event.config.name, styleNames: event.config.styles.map((id) => c.styles[id].name), remaining: Math.max(0, quotaLeft(session, event)) };
}

/** Matches the event language's print keyword as a word anywhere in the message. */
function mentionsPrint(text: string, c: Catalog): boolean {
  const words = new Set(normalize(text).split(" "));
  return c.delivery.printKeywords.some((k) => words.has(normalize(k)));
}

/**
 * The print menu (D-28): the person's delivered portraits that can be
 * printed, newest first, as one Print button or a list. Read from the
 * session's short list, not by scanning the jobs map.
 */
async function printMenu(deps: Deps, ctx: { event: PortraitEvent; key: string; session: Session }): Promise<OutboundMessage> {
  const c = catalogs[ctx.event.config.language];
  const d = c.delivery;
  const left = printsLeft(ctx.event, ctx.session.counters);
  const ev = eventObjects(ctx.event.slug);
  const ids = [...ctx.session.delivered].reverse();
  const [jobs, prints] = await Promise.all([
    Promise.all(ids.map((id) => deps.sync.map(ev.jobs, JobSchema).get(id).catch(() => null))),
    Promise.all(ids.map((id) => deps.sync.map(ev.print, PrintJobSchema).get(id).catch(() => null))),
  ]);
  const options = ids
    .map((id, i) => ({ id, job: jobs[i], print: prints[i] }))
    // Own, still delivered (not removed), and not already on its way.
    .filter((o) => o.job && o.job.address === ctx.key && o.job.state === "delivered" && o.job.style && (!o.print || canPrintAgain(o.print)));
  if (ctx.session.delivered.length === 0) return { kind: "text", body: d.printMenuEmpty };
  if (left < 1) return { kind: "text", body: d.printMenuNone };
  if (options.length === 0) return { kind: "text", body: d.printAlready };
  // Remember the order shown, for an SMS "PRINT 2". Best effort: buttons work without it.
  await deps.sync
    .map(ev.sessions, SessionSchema)
    .update(ctx.key, (cur) => (cur ? { ...cur, printMenu: options.map((o) => o.id) } : SKIP))
    .catch(() => {});

  if (options.length === 1) {
    const o = options[0]!;
    const body = d.printMenuOne({ styleName: c.styles[o.job!.style!].name, printsLeft: left });
    return { kind: "buttons", body, buttons: [{ id: ACTION_SLIDESHOW.printOnly(o.id), title: d.printMenuPrint }], smsBody: `${body} ${d.printSmsHintOne}` };
  }
  // Newest first, numbered, so two of the same style are told apart.
  const items = options.map((o, n) => ({
    id: ACTION_SLIDESHOW.printOnly(o.id),
    title: d.printMenuItem({ n: n + 1, styleName: c.styles[o.job!.style!].name, printed: o.print?.state === "printed" }).slice(0, 24),
  }));
  const body = d.printMenuMany({ printsLeft: left });
  const smsBody = `${body}\n\n${items.map((it) => it.title).join("\n")}\n\n${d.printSmsHintMany}`;
  return { kind: "list", body, button: d.printMenuButton, items, smsBody };
}

/** Adds the attendee's own delivered portrait to the booth screen (SPEC §5.8). */
async function addToSlideshow(deps: Deps, ctx: { event: PortraitEvent; key: string; now: Date }, jobId: string) {
  const { sync } = deps;
  const ev = eventObjects(ctx.event.slug);
  // Only the attendee's own delivered job can be added.
  const job = await sync.map(ev.jobs, JobSchema).get(jobId);
  if (!job || job.address !== ctx.key || job.state !== "delivered" || !job.outputBlobs) return;
  await sync.ensureMap(ev.slideshow);
  // The signed link travels with the item, so the booth gets a ready URL in the push (D-17).
  const url = deps.slideUrl(job.outputBlobs.deliveryJpeg);
  if (await sync.map(ev.slideshow, SlideshowItemSchema, { ttlSeconds: SEVEN_DAYS }).create(jobId, { blobPath: job.outputBlobs.deliveryJpeg, addedAt: ctx.now.toISOString(), url })) {
    await bump(sync, ctx.event.slug, "slideshowYes");
  }
}

async function reply(deps: Deps, to: Address, booth: string | undefined, messages: OutboundMessage[], now: Date, locale = "en", lastInboundAt?: string | null) {
  for (const m of messages) {
    await deps.messenger.send(to, m, { lastInboundAt: lastInboundAt ?? now.toISOString(), locale, from: booth });
  }
}

/** Best-effort localized apology after a failure (SPEC §5.6). Never throws. */
export async function apologize(deps: Deps, to: Address, booth?: string): Promise<void> {
  try {
    const key = keyOf(to);
    const binding = await deps.sync.map(Global.bindings, BindingSchema).get(key);
    const event = binding ? await deps.events.get(binding.eventSlug) : null;
    const locale = event?.config.language ?? "en";
    await deps.messenger.send(to, { kind: "text", body: catalogs[locale].errors.generic }, { lastInboundAt: new Date().toISOString(), locale, from: booth });
  } catch (err) {
    deps.log.warn({ event: "apology_failed", err: (err as Error).message }, "could not send failure reply");
  }
}
