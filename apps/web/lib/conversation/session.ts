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

export function newSession(locale: "en" | "pt_BR", now: Date): Session {
  return SessionSchema.parse({ step: "new", locale, updatedAt: now.toISOString() });
}
