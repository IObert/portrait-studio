import { SessionSchema } from "../conversation/session";
import type { PortraitEvent } from "../events/schema";
import { JobSchema } from "../jobs/schema";
import { mask, type Address } from "../messaging/address";
import { eventObjects } from "../sync/names";
import { SKIP, type SyncStore } from "../sync/store";
import { PrintJobSchema } from "./print-schema";

const SEVEN_DAYS = 7 * 24 * 60 * 60;

export type PrintRequestResult =
  | { status: "queued"; printsLeft: number }
  | { status: "none-left" }
  | { status: "already" }
  | { status: "unavailable" };

/**
 * Whether a portrait with this print record may be printed (again): after a
 * failure, or once a finished print has been counted by the server (D-26).
 */
export function canPrintAgain(item: { state: string; settledAt?: string }): boolean {
  return item.state === "failed" || (item.state === "printed" && !!item.settledAt);
}

/** Prints the person may still ask for (SPEC §4.3); queued prints reserve quota. */
export function printsLeft(event: PortraitEvent, counters: { printed: number; printsReserved: number }): number {
  if (!event.config.printingEnabled) return 0;
  return Math.max(0, event.config.maxPrintsPerPerson - counters.printed - counters.printsReserved);
}

/**
 * The attendee chose to print one of their portraits (D-24). Only their own
 * delivered job, once, and only while print quota remains. The quota is
 * reserved before the item is queued, so two taps never print twice.
 */
export async function requestPrint(
  deps: { sync: SyncStore; mediaUrl: (blobPath: string, ttlSeconds: number) => string },
  event: PortraitEvent,
  addressKey: string,
  address: Address,
  jobId: string,
  now: Date,
): Promise<PrintRequestResult> {
  if (!event.config.printingEnabled) return { status: "unavailable" };
  const ev = eventObjects(event.slug);
  const job = await deps.sync.map(ev.jobs, JobSchema).get(jobId);
  if (!job || job.address !== addressKey || job.state !== "delivered" || !job.outputBlobs) return { status: "unavailable" };

  await deps.sync.ensureMap(ev.print);
  const print = deps.sync.map(ev.print, PrintJobSchema, { ttlSeconds: SEVEN_DAYS });
  // A failed print may be asked for again, and so may a finished one (another copy). Only a print
  // that is still on its way, or printed but not yet counted, blocks: that is almost always a double tap.
  const existing = await print.getVersioned(jobId);
  if (existing && !canPrintAgain(existing.data)) return { status: "already" };

  // 1. Reserve one print on the session.
  const sessions = deps.sync.map(ev.sessions, SessionSchema);
  let left = -1;
  await sessions.update(addressKey, (s) => {
    if (!s || printsLeft(event, s.counters) < 1) return SKIP;
    left = printsLeft(event, s.counters) - 1;
    return { ...s, counters: { ...s.counters, printsReserved: s.counters.printsReserved + 1 } };
  });
  if (left < 0) return { status: "none-left" };

  // 2. Queue it. Personal data is not allowed: masked address only (SPEC §11.3).
  if (existing) await print.delete(jobId, existing.revision).catch(() => {});
  const created = await print.create(jobId, {
    jobId,
    blobPath: job.outputBlobs.printPng,
    url: deps.mediaUrl(job.outputBlobs.printPng, SEVEN_DAYS),
    who: mask(address),
    state: "queued",
    attempts: 0,
    leaseUntil: null,
    error: null,
    reprint: false,
    timestamps: { queued: now.toISOString() },
  });
  if (!created) {
    // A second tap won the race: give the reservation back.
    await sessions.update(addressKey, (s) => (s && s.counters.printsReserved > 0 ? { ...s, counters: { ...s.counters, printsReserved: s.counters.printsReserved - 1 } } : SKIP));
    return { status: "already" };
  }
  return { status: "queued", printsLeft: left };
}
