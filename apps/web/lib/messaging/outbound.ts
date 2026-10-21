import { createHash } from "node:crypto";
import { z } from "zod";
import { Global } from "../sync/names";
import type { SyncStore } from "../sync/store";
import { type Address, mask, twilioAddress } from "./address";

/** A message to an attendee, independent of channel (SPEC §5, §6). */
export type OutboundMessage =
  | { kind: "text"; body: string; mediaUrl?: string }
  /** Up to 3 buttons (in-session WhatsApp quick reply). SMS gets `smsBody`. */
  | { kind: "buttons"; body: string; buttons: { id: string; title: string }[]; smsBody: string }
  /** Up to 10 items (WhatsApp list picker). SMS gets `smsBody` (a numbered list). */
  | { kind: "list"; body: string; button: string; items: { id: string; title: string; description?: string }[]; smsBody: string };

export interface SendResult {
  status: "sent" | "skipped";
  reason?: "outside-24h-window";
  sid?: string;
}

/** The narrow slice of the Twilio client the sender needs (mockable in tests). */
export interface TwilioMessagingApi {
  createMessage(p: { to: string; from?: string; messagingServiceSid: string; body?: string; contentSid?: string; contentVariables?: string; mediaUrl?: string[] }): Promise<{ sid: string }>;
  createContent(p: { friendly_name: string; language: string; types: Record<string, unknown> }): Promise<{ sid: string }>;
}

export interface Logger {
  info(o: object, m: string): void;
  warn(o: object, m: string): void;
}

const WINDOW_MS = 24 * 60 * 60 * 1000;
const CacheSchema = z.object({ contentSid: z.string().regex(/^HX[0-9a-f]{32}$/), createdAt: z.string() });

/** WhatsApp free-form messages need an inbound message within 24h (SPEC §5.11). */
export function insideWindow(lastInboundAt: string | null | undefined, now: Date): boolean {
  return !!lastInboundAt && now.getTime() - Date.parse(lastInboundAt) < WINDOW_MS;
}

/** Content API definition for an interactive WhatsApp message, with a text fallback. */
export function contentDefinition(msg: Exclude<OutboundMessage, { kind: "text" }>): Record<string, unknown> {
  const text = { "twilio/text": { body: msg.smsBody } };
  if (msg.kind === "buttons") {
    if (msg.buttons.length > 3) throw new Error("In-session quick replies allow at most 3 buttons");
    return { ...text, "twilio/quick-reply": { body: msg.body, actions: msg.buttons.map((b) => ({ id: b.id, title: b.title.slice(0, 20) })) } };
  }
  if (msg.items.length > 10) throw new Error("List pickers allow at most 10 items");
  return {
    ...text,
    "twilio/list-picker": {
      body: msg.body,
      button: msg.button.slice(0, 20),
      items: msg.items.map((i) => ({ id: i.id, item: i.title.slice(0, 24), ...(i.description ? { description: i.description.slice(0, 72) } : {}) })),
    },
  };
}

/**
 * Sends replies through the Messaging Service (SPEC §5.1). Runtime Content
 * templates are created once and cached in Sync `content_cache` by hash.
 */
export class Messenger {
  private readonly cache;
  constructor(
    private readonly api: TwilioMessagingApi,
    private readonly sync: SyncStore,
    private readonly messagingServiceSid: string,
    private readonly log: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.cache = sync.map(Global.contentCache, CacheSchema);
  }

  async init() {
    await this.sync.ensureMap(Global.contentCache);
  }

  /**
   * `from` is the booth number the attendee wrote to (the event's QR sender).
   * WhatsApp requires it: a Messaging Service does not select WhatsApp senders
   * on its own (error 21703), so the sender is named explicitly. SMS lets the
   * service pick (geomatch, sticky sender).
   */
  async send(to: Address, msg: OutboundMessage, ctx: { lastInboundAt: string | null; locale: string; from?: string }): Promise<SendResult> {
    if (to.channel === "whatsapp" && !insideWindow(ctx.lastInboundAt, this.now())) {
      // Outside the window nothing is sent (SPEC §5.11, D-42).
      this.log.warn({ event: "send_skipped", reason: "outside-24h-window", to: mask(to), kind: msg.kind }, "message skipped");
      return { status: "skipped", reason: "outside-24h-window" };
    }
    const from = to.channel === "whatsapp" && ctx.from ? `whatsapp:${ctx.from.replace(/^whatsapp:/, "")}` : undefined;
    const base = { to: twilioAddress(to), messagingServiceSid: this.messagingServiceSid, ...(from ? { from } : {}) };
    if (msg.kind === "text") {
      const r = await this.api.createMessage({ ...base, body: msg.body, ...(msg.mediaUrl ? { mediaUrl: [msg.mediaUrl] } : {}) });
      return { status: "sent", sid: r.sid };
    }
    if (to.channel === "sms") {
      // SMS has no buttons: send the text form (numbered list or keyword hint).
      const r = await this.api.createMessage({ ...base, body: msg.smsBody });
      return { status: "sent", sid: r.sid };
    }
    const contentSid = await this.contentSidFor(msg, ctx.locale);
    const r = await this.api.createMessage({ ...base, contentSid });
    return { status: "sent", sid: r.sid };
  }

  /** Finds or creates the Content template for this exact definition. */
  private async contentSidFor(msg: Exclude<OutboundMessage, { kind: "text" }>, locale: string): Promise<string> {
    const types = contentDefinition(msg);
    const language = locale === "pt_BR" ? "pt_BR" : "en";
    const hash = createHash("sha256").update(JSON.stringify({ language, types })).digest("hex").slice(0, 40);
    const cached = await this.cache.get(hash);
    if (cached) return cached.contentSid;
    const { sid } = await this.api.createContent({ friendly_name: `ps_${msg.kind}_${hash.slice(0, 16)}`, language, types });
    // Two replicas may race here; both templates work, the later write wins.
    await this.cache.put(hash, { contentSid: sid, createdAt: this.now().toISOString() });
    this.log.info({ event: "content_created", contentSid: sid, kind: msg.kind }, "runtime content template created");
    return sid;
  }
}
