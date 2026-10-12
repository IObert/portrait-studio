import type { Catalog } from "../../i18n/types";
import type { BackgroundId, PortraitEvent } from "../events/schema";
import type { OutboundMessage } from "../messaging/outbound";
import type { StyleId } from "../prompts/styles";
import type { Session } from "./session";
import { normalize } from "./text";

export interface SelfieInput {
  text: string;
  selection?: string;
  /** Number of image attachments in this message. */
  images: number;
  /** Blob path of the stored selfie, when `images === 1`. */
  selfieBlob?: string;
}

export type SelfieEffect =
  /** Create the generation job (worker picks it up, SPEC §3.2). */
  | { type: "create-job"; selfieBlob: string; style: StyleId; background: BackgroundId }
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

function quotaLeft(session: Session, event: PortraitEvent): number {
  // In-flight jobs count so that parallel selfies cannot exceed the quota.
  return event.config.maxImagesPerPerson - session.counters.delivered - session.counters.inFlight;
}

/** After all choices are known: create the job and say it started (SPEC §5.5 step 5). */
function startJob(session: Session, c: Catalog, style: StyleId, background: BackgroundId): SelfieResult {
  const selfieBlob = session.pendingSelfie!;
  return {
    session: {
      ...session,
      step: "ready",
      pendingSelfie: null,
      style: null,
      background: null,
      counters: { ...session.counters, inFlight: session.counters.inFlight + 1 },
    },
    messages: [{ kind: "text", body: c.job.started }],
    effects: [{ type: "create-job", selfieBlob, style, background }],
    handled: true,
  };
}

/** Moves on from a known selfie: skip menus with one option (SPEC §5.5). */
function nextAfterSelfie(session: Session, event: PortraitEvent, c: Catalog): SelfieResult {
  const styles = styleOptions(event, c);
  const backgrounds = backgroundOptions(event, c);
  const style = session.style ?? (styles.length === 1 ? styles[0]!.id : null);
  if (!style) {
    return { session: { ...session, step: "awaiting_style" }, messages: [menu(styles, c.menus.styleBody, c.menus.styleButton, c)], effects: [], handled: true };
  }
  const background = session.background ?? (backgrounds.length === 1 ? backgrounds[0]!.id : null);
  if (!background) {
    return {
      session: { ...session, step: "awaiting_background", style },
      messages: [menu(backgrounds, c.menus.backgroundBody, c.menus.backgroundButton, c)],
      effects: [],
      handled: true,
    };
  }
  return startJob({ ...session, style, background }, c, style, background);
}

/**
 * Selfie and option handling for opted-in attendees (SPEC §5.5). Pure: the
 * caller stores the selfie blob beforehand and performs the returned effects.
 */
export function handleSelfieFlow(session: Session, event: PortraitEvent, c: Catalog, input: SelfieInput): SelfieResult {
  const none = (messages: OutboundMessage[], s: Session = session): SelfieResult => ({ session: s, messages, effects: [], handled: true });

  if (input.images > 1) return none([{ kind: "text", body: c.selfie.oneAtATime }]);

  if (input.images === 1 && input.selfieBlob) {
    if (quotaLeft(session, event) <= 0)
      return { ...none([{ kind: "text", body: c.selfie.quotaReached({ eventName: event.config.name, max: event.config.maxImagesPerPerson }) }]), effects: [{ type: "discard-blob", blobPath: input.selfieBlob }] };
    // A new selfie while a menu is pending replaces the pending one (SPEC §5.5 step 6).
    const effects: SelfieEffect[] = session.pendingSelfie ? [{ type: "discard-blob", blobPath: session.pendingSelfie }] : [];
    const r = nextAfterSelfie({ ...session, pendingSelfie: input.selfieBlob, style: null, background: null }, event, c);
    return { ...r, effects: [...effects, ...r.effects] };
  }

  if (session.step === "awaiting_style") {
    const styles = styleOptions(event, c);
    const style = pickOption(styles, input);
    if (!style) return none([{ kind: "text", body: c.menus.invalidChoice }, menu(styles, c.menus.styleBody, c.menus.styleButton, c)]);
    return nextAfterSelfie({ ...session, style }, event, c);
  }

  if (session.step === "awaiting_background") {
    const backgrounds = backgroundOptions(event, c);
    const background = pickOption(backgrounds, input);
    if (!background) return none([{ kind: "text", body: c.menus.invalidChoice }, menu(backgrounds, c.menus.backgroundBody, c.menus.backgroundButton, c)]);
    return nextAfterSelfie({ ...session, background }, event, c);
  }

  // Ready and no image: free text, handled by the chat reply in milestone j (SPEC §5.10).
  return { session, messages: [], effects: [], handled: false };
}

/** Right after opt-in: continue with a pending selfie, or ask for one (SPEC §5.4). */
export function afterOptIn(session: Session, event: PortraitEvent, c: Catalog): SelfieResult {
  if (!session.pendingSelfie) return { session: { ...session, step: "ready" }, messages: [{ kind: "text", body: c.selfie.ask }], effects: [], handled: true };
  if (quotaLeft(session, event) <= 0)
    return {
      session: { ...session, step: "ready", pendingSelfie: null },
      messages: [{ kind: "text", body: c.selfie.quotaReached({ eventName: event.config.name, max: event.config.maxImagesPerPerson }) }],
      effects: [{ type: "discard-blob", blobPath: session.pendingSelfie }],
      handled: true,
    };
  const r = nextAfterSelfie(session, event, c);
  return { ...r, messages: [{ kind: "text", body: c.selfie.usingPending }, ...r.messages] };
}
