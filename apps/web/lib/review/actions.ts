import { SessionSchema } from "../conversation/session";
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

/** Admin name typed with an action (SPEC §10.3); logged, never personal data of attendees. */
type Actor = string | undefined;

function audit(log: AuditLog, action: string, slug: string, jobId: string, actor: Actor, extra: object = {}) {
  log.info({ event: "review_action", action, slug, jobId, actor: actor || undefined, ...extra }, `review: ${action}`);
}

/**
 * Approve & send a flagged image (SPEC §5.7, §10.3): flagged → approved_by_admin,
 * then delivered through the normal delivery path. Not counted toward quota.
 */
export async function approveFlagged(deps: { sync: SyncStore; delivery: DeliveryDeps; log: AuditLog }, event: PortraitEvent, jobId: string, actor: Actor) {
  const jobs = deps.sync.map(eventObjects(event.slug).jobs, JobSchema);
  let approved: Job | null = null;
  await jobs.update(jobId, (cur) => {
    if (cur?.state !== "flagged") return SKIP;
    approved = { ...cur, state: "approved_by_admin", timestamps: { ...cur.timestamps, approved_by_admin: new Date().toISOString() } };
    return approved;
  });
  if (!approved) throw new ReviewError("Only flagged images can be approved");
  const job = approved as Job;
  const address = addressFromKey(job.address);
  if (!address) throw new ReviewError("Job has an invalid address");
  const result = await deliver(deps.delivery, event, job, address, { approvedByAdmin: true });
  audit(deps.log, "approve", event.slug, jobId, actor, { result });
  return result;
}

/** Discard a flagged image (SPEC §10.3): it ends as rejected, with the admin's decision as the reason. */
export async function discardFlagged(deps: { sync: SyncStore; log: AuditLog }, event: PortraitEvent, jobId: string, actor: Actor) {
  const jobs = deps.sync.map(eventObjects(event.slug).jobs, JobSchema);
  let ok = false;
  await jobs.update(jobId, (cur) => {
    ok = cur?.state === "flagged";
    // Rejected is the terminal "not delivered" state; the reason records the admin's decision.
    return ok ? { ...cur!, state: "rejected", error: "discarded_by_admin", timestamps: { ...cur!.timestamps, rejected: new Date().toISOString() } } : SKIP;
  });
  if (!ok) throw new ReviewError("Only flagged images can be discarded");
  audit(deps.log, "discard", event.slug, jobId, actor);
}

/**
 * Remove from the slideshow (SPEC §5.8, §10.3). The attendee keeps the
 * portrait and share link; only the booth screen stops showing it.
 */
export async function removeFromSlideshow(deps: { sync: SyncStore; log: AuditLog }, event: PortraitEvent, jobId: string, actor: Actor) {
  await deps.sync.map(eventObjects(event.slug).slideshow, SlideshowItemSchema).delete(jobId);
  audit(deps.log, "slideshow_remove", event.slug, jobId, actor);
}

/** Remove from the print queue, only if it is not printed or printing yet (SPEC §10.3). */
export async function removeFromPrintQueue(deps: { sync: SyncStore; log: AuditLog }, event: PortraitEvent, jobId: string, actor: Actor) {
  const print = deps.sync.map(eventObjects(event.slug).print, PrintJobSchema);
  const v = await print.getVersioned(jobId);
  if (!v) throw new ReviewError("This image is not in the print queue");
  if (v.data.state !== "queued" && v.data.state !== "failed") throw new ReviewError(`Cannot remove a print that is ${v.data.state}`);
  await print.delete(jobId, v.revision);
  // Release the quota reservation for a print that will never happen.
  if (v.data.state === "queued" && !v.data.reprint) await releasePrintReservation(deps.sync, event, jobId);
  audit(deps.log, "print_remove", event.slug, jobId, actor);
}

/**
 * Reprint (SPEC §10.3). Does not count toward the attendee's print quota
 * (§17 Q5); logged with the admin's name.
 */
export async function reprint(deps: { sync: SyncStore; log: AuditLog }, event: PortraitEvent, jobId: string, actor: Actor) {
  if (!event.config.printingEnabled) throw new ReviewError("Printing is off for this event");
  const job = await deps.sync.map(eventObjects(event.slug).jobs, JobSchema).get(jobId);
  if (!job || job.state !== "delivered" || !job.outputBlobs) throw new ReviewError("Only delivered images can be reprinted");
  const ev = eventObjects(event.slug);
  await deps.sync.ensureMap(ev.print);
  const print = deps.sync.map(ev.print, PrintJobSchema, { ttlSeconds: 7 * 24 * 60 * 60 });
  const cur = await print.get(jobId);
  if (cur && (cur.state === "queued" || cur.state === "claimed" || cur.state === "printing")) throw new ReviewError("A print for this image is already pending");
  await print.put(jobId, {
    jobId,
    blobPath: job.outputBlobs.printPng,
    who: cur?.who ?? "admin reprint",
    state: "queued",
    attempts: 0,
    leaseUntil: null,
    error: null,
    reprint: true,
    timestamps: { queued: new Date().toISOString() },
  });
  audit(deps.log, "reprint", event.slug, jobId, actor);
}

async function releasePrintReservation(sync: SyncStore, event: PortraitEvent, jobId: string) {
  const job = await sync.map(eventObjects(event.slug).jobs, JobSchema).get(jobId);
  if (!job) return;
  await sync
    .map(eventObjects(event.slug).sessions, SessionSchema)
    .update(job.address, (s) => (s && s.counters.printsReserved > 0 ? { ...s, counters: { ...s.counters, printsReserved: s.counters.printsReserved - 1 } } : SKIP));
}
