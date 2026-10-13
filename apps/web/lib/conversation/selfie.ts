import type { Catalog } from "../../i18n/types";
import type { BackgroundId, PortraitEvent } from "../events/schema";
import type { OutboundMessage } from "../messaging/outbound";
import type { StyleId } from "../prompts/styles";
import type { Session } from "./session";
import { normalize } from "./text";

export interface SelfieInput {
  /** Id for a job created by this message (kept pure: the caller generates it). */
  newJobId: string;
  text: string;
  selection?: string;
  /** Number of image attachments in this message. */
  images: number;
  /** Blob path of the stored selfie, when `images === 1`. */
  selfieBlob?: string;
}

export type SelfieEffect =
  /** Create the job in `screening`: the worker checks the photo before any menu (D-18). */
  | { type: "create-job"; jobId: string; selfieBlob: string }
  /** Record a menu choice on the pending job; `start` moves it on to generation. */
  | { type: "choose"; jobId: string; style?: StyleId; background?: BackgroundId; start: boolean }
  /** A newer photo replaces a pending one: its job is dropped (SPEC §5.5 step 6). */
  | { type: "supersede-job"; jobId: string }
  /** A pending selfie was replaced and its blob is no longer needed. */
  | { type: "discard-blob"; blobPath: string };

export interface SelfieResult {
  session: Session;
  messages: OutboundMessage[];
  effects: SelfieEffect[];
  /** True if this module handled the message; false means it is free text (SPEC §5.10). */
  handled: boolean;
}

interface Option<T extends string> {
  id: T;
  name: string;
  aliases: readonly string[];
}

export function styleOptions(event: PortraitEvent, c: Catalog): Option<StyleId>[] {
  return event.config.styles.map((id) => ({ id, ...c.styles[id] }));
}

export function backgroundOptions(event: PortraitEvent, c: Catalog): Option<BackgroundId>[] {
  return event.config.backgrounds.map((id) =>
    id === "uploaded" ? { id, name: event.config.uploadedBackgroundName || "Event", aliases: [] } : { id, ...c.backgrounds[id] },
  );
}

/** Number, name or localized alias, ignoring case and accents (SPEC §5.5). */
export function pickOption<T extends string>(options: Option<T>[], answer: { text: string; selection?: string }): T | undefined {
  if (answer.selection) {
    const hit = options.find((o) => `opt:${o.id}` === answer.selection);
    if (hit) return hit.id;
  }
  const t = normalize(answer.text);
  if (!t) return undefined;
  const n = Number.parseInt(t, 10);
  if (String(n) === t) return options[n - 1]?.id;
  return options.find((o) => normalize(o.name) === t || o.aliases.some((a) => normalize(a) === t))?.id;
}

function menu<T extends string>(options: Option<T>[], body: string, button: string, c: Catalog): OutboundMessage {
  const numbered = options.map((o, i) => `${i + 1}. ${o.name}`).join("\n");
  const smsBody = `${body}\n\n${numbered}\n\n${c.menus.replyWithNumber}`;
  const items = options.map((o) => ({ id: `opt:${o.id}`, title: o.name }));
  // WhatsApp: quick reply for up to 3 options, otherwise a list picker (SPEC §5.2 pattern, §5.5).
  return options.length <= 3
    ? { kind: "buttons", body, buttons: items, smsBody }
    : { kind: "list", body, button, items, smsBody };
}

/** Style menu (SPEC §5.5), sent by the worker after a photo passes screening (D-18). */
export function styleMenu(event: PortraitEvent, c: Catalog): OutboundMessage {
  return menu(styleOptions(event, c), c.menus.styleBody, c.menus.styleButton, c);
}

export function backgroundMenu(event: PortraitEvent, c: Catalog): OutboundMessage {
  return menu(backgroundOptions(event, c), c.menus.backgroundBody, c.menus.backgroundButton, c);
}

function quotaLeft(session: Session, event: PortraitEvent): number {
  // In-flight jobs count so that parallel selfies cannot exceed the quota.
  return event.config.maxImagesPerPerson - session.counters.delivered - session.counters.inFlight;
}

/** A photo that passed the cheap checks: create the job for screening (D-18). */
function screenSelfie(session: Session, c: Catalog, selfieBlob: string, jobId: string, intro?: string): SelfieResult {
  const effects: SelfieEffect[] = [];
  // A newer photo replaces the pending one (SPEC §5.5 step 6).
  if (session.pendingJobId) effects.push({ type: "supersede-job", jobId: session.pendingJobId });
  else if (session.pendingSelfie && session.pendingSelfie !== selfieBlob) effects.push({ type: "discard-blob", blobPath: session.pendingSelfie });
  effects.push({ type: "create-job", jobId, selfieBlob });
  return {
    session: {
      ...session,
      step: "screening",
      pendingSelfie: null,
      pendingJobId: jobId,
      style: null,
      background: null,
      counters: { ...session.counters, inFlight: session.counters.inFlight + (session.pendingJobId ? 0 : 1) },
    },
    messages: [...(intro ? [{ kind: "text" as const, body: intro }] : []), { kind: "text", body: c.selfie.checking }],
    effects,
    handled: true,
  };
}

/**
 * A menu answer for the pending, screened job (SPEC §5.5). Style first, then
 * background; with both chosen the job moves on to generation.
 */
function choose(session: Session, event: PortraitEvent, c: Catalog, choice: { style?: StyleId; background?: BackgroundId }): SelfieResult {
  const jobId = session.pendingJobId!;
  const style = choice.style ?? session.style ?? (event.config.styles.length === 1 ? event.config.styles[0]! : null);
  const background = choice.background ?? session.background ?? (event.config.backgrounds.length === 1 ? event.config.backgrounds[0]! : null);
  if (style && !background) {
    return {
      session: { ...session, step: "awaiting_background", style },
      messages: [backgroundMenu(event, c)],
      effects: [{ type: "choose", jobId, style, start: false }],
      handled: true,
    };
  }
  return {
    session: { ...session, step: "ready", pendingJobId: null, style: null, background: null },
    messages: [{ kind: "text", body: c.job.started }],
    effects: [{ type: "choose", jobId, style: style!, background: background!, start: true }],
    handled: true,
  };
}

/**
 * Selfie and option handling for opted-in attendees (SPEC §5.5). Pure: the
 * caller stores the selfie blob beforehand and performs the returned effects.
 */
export function handleSelfieFlow(session: Session, event: PortraitEvent, c: Catalog, input: SelfieInput): SelfieResult {
  const none = (messages: OutboundMessage[], s: Session = session): SelfieResult => ({ session: s, messages, effects: [], handled: true });

  if (input.images > 1) return none([{ kind: "text", body: c.selfie.oneAtATime }]);

  if (input.images === 1 && input.selfieBlob) {
    // A replacement does not use another slot of the quota.
    if (!session.pendingJobId && quotaLeft(session, event) <= 0)
      return { ...none([{ kind: "text", body: c.selfie.quotaReached({ eventName: event.config.name, max: event.config.maxImagesPerPerson }) }]), effects: [{ type: "discard-blob", blobPath: input.selfieBlob }] };
    return screenSelfie(session, c, input.selfieBlob, input.newJobId);
  }

  if (session.step === "screening") return none([{ kind: "text", body: c.selfie.stillChecking }]);

  if (session.step === "awaiting_style" && session.pendingJobId) {
    const style = pickOption(styleOptions(event, c), input);
    if (!style) return none([{ kind: "text", body: c.menus.invalidChoice }, styleMenu(event, c)]);
    return choose(session, event, c, { style });
  }

  if (session.step === "awaiting_background" && session.pendingJobId) {
    const background = pickOption(backgroundOptions(event, c), input);
    if (!background) return none([{ kind: "text", body: c.menus.invalidChoice }, backgroundMenu(event, c)]);
    return choose(session, event, c, { background });
  }

  // Ready and no image: free text, handled by the chat reply in milestone j (SPEC §5.10).
  return { session, messages: [], effects: [], handled: false };
}

/** Right after opt-in: continue with a pending selfie, or ask for one (SPEC §5.4). */
export function afterOptIn(session: Session, event: PortraitEvent, c: Catalog, newJobId: string): SelfieResult {
  if (!session.pendingSelfie) return { session: { ...session, step: "ready" }, messages: [{ kind: "text", body: c.selfie.ask }], effects: [], handled: true };
  if (quotaLeft(session, event) <= 0)
    return {
      session: { ...session, step: "ready", pendingSelfie: null },
      messages: [{ kind: "text", body: c.selfie.quotaReached({ eventName: event.config.name, max: event.config.maxImagesPerPerson }) }],
      effects: [{ type: "discard-blob", blobPath: session.pendingSelfie }],
      handled: true,
    };
  return screenSelfie(session, c, session.pendingSelfie, newJobId, c.selfie.usingPending);
}
