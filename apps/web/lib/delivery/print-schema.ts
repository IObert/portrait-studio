import { z } from "zod";

/** Print job item in `ev_<slug>_print` (SPEC §11.3). No personal data: `who` is a masked address. */
export const PRINT_STATES = ["queued", "claimed", "printing", "printed", "failed"] as const;
export const PrintJobSchema = z.object({
  jobId: z.string(),
  blobPath: z.string(),
  /**
   * Signed link to the print PNG; the agent downloads from it (PROTOCOL.md §3).
   * Optional only for items written before it existed; new items always have it.
   */
  url: z.string().url().optional(),
  who: z.string().max(40),
  state: z.enum(PRINT_STATES),
  attempts: z.number().int().min(0),
  leaseUntil: z.iso.datetime().nullable(),
  error: z.string().max(300).nullable(),
  /** Admin reprint: does not count toward the person's print quota (§17 Q5). */
  reprint: z.boolean().default(false),
  timestamps: z.partialRecord(z.enum(PRINT_STATES), z.iso.datetime()),
  /** Set by the server once a printed/failed item is counted (and the promo sent). Agents leave it alone. */
  settledAt: z.iso.datetime().optional(),
});
export type PrintJob = z.infer<typeof PrintJobSchema>;
