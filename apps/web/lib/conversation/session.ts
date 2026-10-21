import { z } from "zod";
import { BACKGROUND_IDS } from "../events/schema";
import { STYLE_IDS } from "../prompts/styles";

/**
 * Conversation state per attendee per event (`ev_<slug>_sessions`, SPEC §5.1).
 * Stays small: well under Sync's 16 KiB item limit.
 */
export const STEPS = [
  /** No consent yet; the next message starts the consent flow. */
  "new",
  /** Case A / C: waiting for "I agree". */
  "awaiting_agree",
  /** Case B: waiting for full name, email, then the code. */
  "awaiting_name",
  "awaiting_email",
  "awaiting_code",
  /** Opted in; waiting for a selfie. */
  "ready",
  /** A photo is being checked by the worker (D-18). */
  "screening",
  "awaiting_style",
  "awaiting_background",
] as const;
export type Step = (typeof STEPS)[number];

export const SessionSchema = z.object({
  step: z.enum(STEPS),
  locale: z.enum(["en", "pt_BR"]),
  optedIn: z.boolean().default(false),
  /** Blob path of the selfie waiting for consent or menu choices (SPEC §5.4, §5.5). */
  pendingSelfie: z.string().nullable().default(null),
  /** The job created for the current photo, while it is screened or awaits menu choices (D-18). */
  pendingJobId: z.string().nullable().default(null),
  style: z.enum(STYLE_IDS).nullable().default(null),
  background: z.enum(BACKGROUND_IDS).nullable().default(null),
  /** Case B data, kept only until the code is verified, then moved to Memory. */
  lead: z
    .object({
      firstName: z.string().max(60),
      lastName: z.string().max(60),
      email: z.string().max(254).optional(),
    })
    .nullable()
    .default(null),
  /** Case A: the returning Memory profile and its first name. */
  memoryProfileId: z.string().nullable().default(null),
  pendingDeletionConfirm: z.boolean().default(false),
  /** The last delivery's question, if still unanswered (SPEC §5.8); `print` when printing was offered (D-24). Keyword answers (SMS) count for 10 minutes; a question stored before `askedAt` existed counts as expired. Buttons always work. */
  pendingSlideshow: z.object({ jobId: z.string(), group: z.boolean(), print: z.boolean().default(false), askedAt: z.iso.datetime().optional() }).nullable().default(null),
  /** The person's delivered portraits, newest last, for the print menu (D-28). At most 10: a WhatsApp list's limit. */
  delivered: z.array(z.string()).max(10).default([]),
  /** The last print menu's order, so an SMS "PRINT 2" means what the person saw (D-28). */
  printMenu: z.array(z.string()).max(10).default([]),
  /** The booth number the person last wrote to. The WhatsApp 24h window belongs to that number, so every later message (the portrait, menus, promo) is sent from it (D-11, D-43). Absent on sessions from before it was remembered. */
  boothNumber: z.string().nullable().default(null),
  /** For the WhatsApp 24h window (SPEC §5.11). */
  lastInboundAt: z.iso.datetime().nullable().default(null),
  counters: z
    .object({
      /** Delivered portraits; the quota (SPEC §4.3) counts these. */
      delivered: z.number().int().min(0).default(0),
      /** Successful prints (SPEC §4.3). */
      printed: z.number().int().min(0).default(0),
      /** Prints queued but not yet finished: they reserve quota (docs/decisions.md). */
      printsReserved: z.number().int().min(0).default(0),
      /** Jobs started and not finished, to stop parallel generations. */
      inFlight: z.number().int().min(0).default(0),
    })
    .default({ delivered: 0, printed: 0, printsReserved: 0, inFlight: 0 }),
  updatedAt: z.iso.datetime(),
});
export type Session = z.infer<typeof SessionSchema>;

/** The number to send from: the one the person wrote to, else the event's QR number (sessions from before D-43). */
export function senderFor(session: Pick<Session, "boothNumber"> | null | undefined, event: { config: { qrSender: string } }): string {
  return session?.boothNumber ?? event.config.qrSender;
}

export function newSession(locale: "en" | "pt_BR", now: Date): Session {
  return SessionSchema.parse({ step: "new", locale, updatedAt: now.toISOString() });
}
