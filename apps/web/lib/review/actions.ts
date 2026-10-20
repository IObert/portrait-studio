import { SessionSchema } from "../conversation/session";
import type { BlobStore } from "../blob/store";
import { deliver, type DeliveryDeps } from "../delivery/deliver";
import { PrintJobSchema } from "../delivery/print-schema";
import { SlideshowItemSchema } from "../delivery/slideshow";
import type { PortraitEvent } from "../events/schema";
import { type Job, JobSchema } from "../jobs/schema";
import { addressFromKey } from "../pipeline/worker";
import { eventObjects } from "../sync/names";
import { SKIP, type SyncStore } from "../sync/store";

export class ReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewError";
  }
}

export interface AuditLog {
  info(o: object, m: string): void;
}

/** Audit line for a review action (SPEC §10.3); no personal data. */
function audit(log: AuditLog, action: string, slug: string, jobId: string, extra: object = {}) {
  log.info({ event: "review_action", action, slug, jobId, ...extra }, `review: ${action}`);
}

/**
 * Approve & send a flagged image (SPEC §5.7, §10.3): flagged → approved_by_admin,
 * then delivered through the normal delivery path. Not counted toward quota.
 */
export async function approveFlagged(deps: { sync: SyncStore; delivery: DeliveryDeps; log: AuditLog }, event: PortraitEvent, jobId: string) {
  const jobs = deps.sync.map(eventObjects(event.slug).jobs, JobSchema);
  // Nothing changes for an address that cannot be delivered to.
  const before = await jobs.get(jobId);
  if (before?.state !== "flagged") throw new ReviewError("Only flagged images can be approved");
  const address = addressFromKey(before.address);
  if (!address) throw new ReviewError("Job has an invalid address");
  let approved: Job | null = null;
  await jobs.update(jobId, (cur) => {
    if (cur?.state !== "flagged") return SKIP;
    approved = { ...cur, state: "approved_by_admin", timestamps: { ...cur.timestamps, approved_by_admin: new Date().toISOString() } };
    return approved;
  });
  if (!approved) throw new ReviewError("Only flagged images can be approved");
  const job = approved as Job;
  let result: Awaited<ReturnType<typeof deliver>>;
  try {
    result = await deliver(deps.delivery, event, job, address, { approvedByAdmin: true });
  } catch (err) {
    // Delivery failed (nothing was sent): back to flagged, so Approve can be tried again.
    await jobs.update(jobId, (cur) => (cur?.state === "approved_by_admin" ? { ...cur, state: "flagged" } : SKIP));
    throw err;
  }
  audit(deps.log, "approve", event.slug, jobId, { result });
  return result;
}

/** Discard a flagged image (SPEC §10.3): it ends as rejected, with the admin's decision as the reason. */
export async function discardFlagged(deps: { sync: SyncStore; log: AuditLog }, event: PortraitEvent, jobId: string) {
  const jobs = deps.sync.map(eventObjects(event.slug).jobs, JobSchema);
  let ok = false;
  await jobs.update(jobId, (cur) => {
    ok = cur?.state === "flagged";
    // Rejected is the terminal "not delivered" state; the reason records the admin's decision.
    return ok ? { ...cur!, state: "rejected", error: "discarded_by_admin", timestamps: { ...cur!.timestamps, rejected: new Date().toISOString() } } : SKIP;
  });
  if (!ok) throw new ReviewError("Only flagged images can be discarded");
  audit(deps.log, "discard", event.slug, jobId);
}

/**
 * Remove a delivered portrait (SPEC §10.3, D-16, user decision): takes it off
 * the booth screen, turns the share link off and deletes its files right away.
 * The job ends as removed_by_admin. A print already printing cannot be recalled.
 */
export async function removePortrait(deps: { sync: SyncStore; blob: BlobStore; log: AuditLog }, event: PortraitEvent, jobId: string) {
  const ev = eventObjects(event.slug);
  let removed: Job | null = null;
  // 1. State first: the share page and slideshow stop showing it at once, even if a file delete fails.
  await deps.sync.map(ev.jobs, JobSchema).update(jobId, (cur) => {
    // A job that is already removed is run again to finish deleting files that failed before.
    if (cur?.state === "removed_by_admin") {
      removed = cur;
      return SKIP;
    }
    if (cur?.state !== "delivered") return SKIP;
    removed = { ...cur, state: "removed_by_admin", timestamps: { ...cur.timestamps, removed_by_admin: new Date().toISOString() } };
    return removed;
  });
  if (!removed) throw new ReviewError("Only delivered portraits can be removed");
  const job = removed as Job;

  // 2. Off the booth screen.
  await deps.sync.map(ev.slideshow, SlideshowItemSchema).delete(jobId);

  // 3. Cancel a print that has not started; one already printing cannot be recalled.
  const print = deps.sync.map(ev.print, PrintJobSchema);
  const p = await print.getVersioned(jobId);
  let printing = false;
  if (p && (p.data.state === "queued" || p.data.state === "failed")) {
    await print.delete(jobId, p.revision);
    if (holdsReservation(p.data)) await releasePrintReservation(deps.sync, event, jobId);
  } else if (p && (p.data.state === "claimed" || p.data.state === "printing")) {
    printing = true;
  }

  // 4. Delete the files now, not at the 7-day expiry.
  const paths = [job.selfieBlob, job.outputBlobs?.printPng, job.outputBlobs?.deliveryJpeg].filter((x): x is string => !!x);
  const results = await Promise.allSettled(paths.map((path) => deps.blob.delete(path)));
  const failed = results.filter((r) => r.status === "rejected").length;
  audit(deps.log, "portrait_remove", event.slug, jobId, { filesDeleted: paths.length - failed, filesFailed: failed, printing });
  if (failed) throw new ReviewError(`Removed, but ${failed} file(s) could not be deleted yet; they expire within 7 days`);
  return { printing };
}

/** Remove from the print queue, only if it is not printed or printing yet (SPEC §10.3). */
export async function removeFromPrintQueue(deps: { sync: SyncStore; log: AuditLog }, event: PortraitEvent, jobId: string) {
  const print = deps.sync.map(eventObjects(event.slug).print, PrintJobSchema);
  const v = await print.getVersioned(jobId);
  if (!v) throw new ReviewError("This image is not in the print queue");
  if (v.data.state !== "queued" && v.data.state !== "failed") throw new ReviewError(`Cannot remove a print that is ${v.data.state}`);
  await print.delete(jobId, v.revision);
  // Release the quota reservation for a print that will never happen.
  if (holdsReservation(v.data)) await releasePrintReservation(deps.sync, event, jobId);
  audit(deps.log, "print_remove", event.slug, jobId);
}

/**
 * Reprint (SPEC §10.3). Does not count toward the attendee's print quota
 * (§17 Q5); logged with the admin's name.
 */
export async function reprint(deps: { sync: SyncStore; log: AuditLog; mediaUrl: (blobPath: string, ttlSeconds: number) => string }, event: PortraitEvent, jobId: string) {
  if (!event.config.printingEnabled) throw new ReviewError("Printing is off for this event");
  const job = await deps.sync.map(eventObjects(event.slug).jobs, JobSchema).get(jobId);
  if (!job || job.state !== "delivered" || !job.outputBlobs) throw new ReviewError("Only delivered images can be reprinted");
  const ev = eventObjects(event.slug);
  await deps.sync.ensureMap(ev.print);
  const print = deps.sync.map(ev.print, PrintJobSchema, { ttlSeconds: 7 * 24 * 60 * 60 });
  const existing = await print.getVersioned(jobId);
  const cur = existing?.data;
  if (cur && (cur.state === "queued" || cur.state === "claimed" || cur.state === "printing")) throw new ReviewError("A print for this image is already pending");
  // A finished print the server has not counted yet would be overwritten and never counted.
  if (cur && (cur.state === "printed" || cur.state === "failed") && !cur.settledAt) throw new ReviewError("The last print of this image is still being recorded; try again in a few seconds");
  // Replace only the item we just looked at (If-Match), so a print an attendee queued meanwhile is not clobbered.
  if (existing) await print.delete(jobId, existing.revision);
  const created = await print.create(jobId, {
    jobId,
    blobPath: job.outputBlobs.printPng,
    url: deps.mediaUrl(job.outputBlobs.printPng, 7 * 24 * 60 * 60),
    who: cur?.who ?? "admin reprint",
    state: "queued",
    attempts: 0,
    leaseUntil: null,
    error: null,
    reprint: true,
    timestamps: { queued: new Date().toISOString() },
  });
  if (!created) throw new ReviewError("A print for this image is already pending");
  audit(deps.log, "reprint", event.slug, jobId);
}

/** Whether deleting this print item must give its quota reservation back: a queued print, or a failed one the server has not settled (settling releases it). */
function holdsReservation(item: { state: string; reprint?: boolean; settledAt?: string }): boolean {
  return !item.reprint && (item.state === "queued" || (item.state === "failed" && !item.settledAt));
}

async function releasePrintReservation(sync: SyncStore, event: PortraitEvent, jobId: string) {
  const job = await sync.map(eventObjects(event.slug).jobs, JobSchema).get(jobId);
  if (!job) return;
  await sync
    .map(eventObjects(event.slug).sessions, SessionSchema)
    .update(job.address, (s) => (s && s.counters.printsReserved > 0 ? { ...s, counters: { ...s.counters, printsReserved: s.counters.printsReserved - 1 } } : SKIP));
}
