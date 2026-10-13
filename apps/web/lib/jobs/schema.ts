import { z } from "zod";
import { BACKGROUND_IDS } from "../events/schema";
import { STYLE_IDS } from "../prompts/styles";

/**
 * Job state machine (SPEC §9.1), with screening moved ahead of the menus so a
 * bad photo is rejected before the attendee picks a style (docs/decisions.md D-18):
 *
 *   screening → (rejected | awaiting_choice) → queued → processing → (delivered | flagged | rejected | failed)
 *   flagged → approved_by_admin → delivered
 *   delivered → removed_by_admin   (share page off, files deleted, D-16)
 */
export const JOB_STATES = [
  "screening",
  "awaiting_choice",
  "queued",
  "processing",
  "delivered",
  "flagged",
  "rejected",
  "failed",
  "approved_by_admin",
  "removed_by_admin",
] as const;
export type JobState = (typeof JOB_STATES)[number];

export const JobSchema = z.object({
  jobId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  /** `channel:e164`, the session key. */
  address: z.string(),
  channel: z.enum(["whatsapp", "sms"]),
  /** Chosen in the menus; null while screening or awaiting the attendee's choice. */
  style: z.enum(STYLE_IDS).nullable(),
  background: z.enum(BACKGROUND_IDS).nullable(),
  selfieBlob: z.string(),
  outputBlobs: z.object({ printPng: z.string(), deliveryJpeg: z.string() }).nullable().default(null),
  /** Unguessable id for /s/[shareId] (SPEC §6.2). */
  shareId: z.string().regex(/^[A-Za-z0-9_-]{22,}$/),
  subjects: z.number().int().min(0).max(10).nullable().default(null),
  /** Pet from scene analysis, kept so generation does not analyse the photo twice. */
  pet: z.string().max(30).nullable().default(null),
  state: z.enum(JOB_STATES),
  attempts: z.number().int().min(0).default(0),
  leaseUntil: z.iso.datetime().nullable().default(null),
  error: z.string().max(500).nullable().default(null),
  aiReview: z.object({ result: z.enum(["pass", "fail"]), reason: z.string().max(1000) }).nullable().default(null),
  /** ISO timestamp per state reached (SPEC §9.1). */
  timestamps: z.partialRecord(z.enum(JOB_STATES), z.iso.datetime()),
});
export type Job = z.infer<typeof JobSchema>;
