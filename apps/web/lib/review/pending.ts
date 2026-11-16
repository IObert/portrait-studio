import type { Job } from "../jobs/schema";
import type { PrintJob } from "../delivery/print-schema";
import { printerWillPrint, type PrinterView } from "../admin/printer-status";

/**
 * Helpers for the Review tabs "Printing" and "In progress" (SPEC §10.3, D-54). Pure, so they can be tested without Sync.
 */

/** A queued print this old, with the agent online and the printer ready, should have started by now. */
export const PRINT_PICKUP_MS = 2 * 60_000;

/** Job states that are still on their way (or stuck) rather than done: the "In progress" tab. */
export const IN_PROGRESS_STATES = ["screening", "awaiting_choice", "queued", "processing", "failed"] as const satisfies readonly Job["state"][];
export type InProgressState = (typeof IN_PROGRESS_STATES)[number];

/** How long a state may last before the admin should look at it. The attendee's own choice has no limit. */
const SLOW_AFTER_MS: Partial<Record<InProgressState, number>> = { screening: 5 * 60_000, queued: 5 * 60_000, processing: 10 * 60_000 };

export const IN_PROGRESS_LABEL: Record<InProgressState, string> = {
  screening: "Checking the photo",
  awaiting_choice: "Waiting for the attendee to pick a style or background",
  queued: "Waiting to be generated",
  processing: "Generating",
  failed: "Failed",
};

export const PRINT_STATE_LABEL: Record<PrintJob["state"], string> = {
  queued: "Waiting for the print agent",
  claimed: "Picked up by the print agent",
  printing: "Printing",
  printed: "Printed",
  failed: "Print failed",
};

/** "just now", "5 min", "2 h 10 min". Negative or missing times read as "just now". */
export function formatWait(ms: number | null): string {
  if (ms === null || ms < 60_000) return "just now";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 === 0 ? `${h} h` : `${h} h ${min % 60} min`;
}

/** Milliseconds since an ISO time, or null when there is none. */
export function sinceMs(iso: string | undefined | null, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.max(0, now.getTime() - t);
}

/** True when a job has been in its state longer than it should (never for a finished or attendee-owned state). */
export function isSlow(state: InProgressState, waitedMs: number | null): boolean {
  if (state === "failed") return true;
  const limit = SLOW_AFTER_MS[state];
  return limit !== undefined && waitedMs !== null && waitedMs >= limit;
}

/**
 * Why a queued print is still waiting, or null when there is nothing to say yet. A print is normally taken in
 * seconds, so nothing is said in the first minute. The last case is the one to act on: the agent and the printer
 * are fine, yet nothing was picked up (D-53 was found this way).
 */
export function printWaitHint(state: PrintJob["state"], waitedMs: number | null, printer: PrinterView): string | null {
  if (state !== "queued" || waitedMs === null || waitedMs < 60_000) return null;
  if (printer.kind === "none") return "No print agent has connected to this event.";
  if (printer.kind === "offline") return "The print agent is offline.";
  if (!printerWillPrint(printer)) return `The printer is ${printer.status.replaceAll("_", " ")}, so prints wait.`;
  if (waitedMs >= PRINT_PICKUP_MS) return "The agent is online and the printer is ready, but nothing picked this up. Restart the print agent.";
  return null;
}
