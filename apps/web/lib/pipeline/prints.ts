import { SessionSchema } from "../conversation/session";
import { PrintJobSchema, type PrintJob } from "../delivery/print-schema";
import type { EventRepo } from "../events/repo";
import { type PortraitEvent, withEventName } from "../events/schema";
import { JobSchema } from "../jobs/schema";
import type { Messenger } from "../messaging/outbound";
import { bump } from "../stats";
import { eventObjects } from "../sync/names";
import { SKIP, type SyncStore } from "../sync/store";
import { addressFromKey } from "./worker";

/** A claimed/printing item whose lease ran out this long ago is stuck (SPEC §11.2). */
export const STUCK_AFTER_MS = 5 * 60 * 1000;
export const MAX_PRINT_ATTEMPTS = 3;

export interface PrintDeps {
  sync: SyncStore;
  events: EventRepo;
  messenger: Messenger;
  log: { info(o: object, m: string): void; warn(o: object, m: string): void };
  /** Signs download links for print items that lack one. */
  mediaUrl?: (blobPath: string, ttlSeconds: number) => string;
  now?: () => Date;
}

/**
 * Server side of the print lifecycle (SPEC §11.2, §4.3, §5.9; PROTOCOL.md §3):
 * - printed: count the print, release the reservation, send the promo once
 * - failed: release the reservation; the attendee already has the image
 * - stuck (lease long expired): back to queued, or failed after 3 attempts
 * Safe with many workers: each step is an If-Match write on the item.
 */
export async function settlePrints(deps: PrintDeps): Promise<number> {
  const now = deps.now?.() ?? new Date();
  let handled = 0;
  for (const event of (await deps.events.list()).filter((e) => e.state !== "draft" && e.config.printingEnabled)) {
    const map = deps.sync.map(eventObjects(event.slug).print, PrintJobSchema);
    const items: PrintJob[] = [];
    // One malformed item must not stop settlement for every event: skip and log it.
    for await (const [, item] of map.entries((key, err) => deps.log.warn({ event: "print_item_invalid", slug: event.slug, key, error: err.message }, "skipping invalid print item"))) items.push(item);
    for (const item of items) {
      // Items from before signed links existed get one, so the agent can download them.
      if (item.state === "queued" && !item.url && deps.mediaUrl) {
        const url = deps.mediaUrl(item.blobPath, 7 * 24 * 60 * 60);
        await map.update(item.jobId, (cur) => (cur && !cur.url ? { ...cur, url } : SKIP));
      }
      if ((item.state === "printed" || item.state === "failed") && !item.settledAt) {
        if (await settle(deps, event, item, now)) handled++;
      } else if ((item.state === "claimed" || (item.state === "printing" && !item.printerJobId)) && item.leaseUntil && now.getTime() - Date.parse(item.leaseUntil) > STUCK_AFTER_MS) {
        // A print already at the printer is left alone: the next agent resumes it and reads its
        // real state, so a requeue can never add a second copy (D-25).
        await release(deps, event, item, now);
        handled++;
      }
    }
  }
  return handled;
}

async function settle(deps: PrintDeps, event: PortraitEvent, item: PrintJob, now: Date): Promise<boolean> {
  const ev = eventObjects(event.slug);
  // Claim the settlement: only one worker gets past this.
  let mine = false;
  await deps.sync.map(ev.print, PrintJobSchema).update(item.jobId, (cur) => {
    mine = !!cur && !cur.settledAt && (cur.state === "printed" || cur.state === "failed");
    return mine ? { ...cur!, settledAt: now.toISOString() } : SKIP;
  });
  if (!mine) return false;

  const job = await deps.sync.map(ev.jobs, JobSchema).get(item.jobId);
  if (!job) return true; // deleted meanwhile (event or data deletion)

  if (item.state === "printed") {
    // Successful prints count toward maxPrintsPerPerson (SPEC §4.3); admin reprints do not (§10.3).
    if (!item.reprint) {
      await deps.sync.map(ev.sessions, SessionSchema).update(job.address, (s) =>
        s ? { ...s, counters: { ...s.counters, printed: s.counters.printed + 1, printsReserved: Math.max(0, s.counters.printsReserved - 1) } } : SKIP,
      );
    }
    await bump(deps.sync, event.slug, "printsSucceeded");
    await sendPromo(deps, event, job.address, item);
  } else {
    if (!item.reprint) await releaseReservation(deps.sync, event, job.address);
    await bump(deps.sync, event.slug, "printsFailed");
    // The attendee already has the image digitally: nothing is sent (SPEC §11.2).
  }
  deps.log.info({ event: "print_settled", slug: event.slug, jobId: item.jobId, state: item.state, reprint: item.reprint }, "print settled");
  return true;
}

/**
 * Promo after a successful print (SPEC §5.9): only when printing and the promo
 * are on, once per printed job, triggered by the print-success event. Skipped
 * and logged outside the WhatsApp window (no template, by design).
 */
async function sendPromo(deps: PrintDeps, event: PortraitEvent, addressKey: string, item: PrintJob) {
  if (!event.config.printingEnabled || !event.config.promo.enabled || !event.config.promo.text) return;
  // Admin reprints are not attendee prints: no promo for them.
  if (item.reprint) return;
  const address = addressFromKey(addressKey);
  if (!address) return;
  const session = await deps.sync.map(eventObjects(event.slug).sessions, SessionSchema).get(addressKey);
  const r = await deps.messenger.send(address, { kind: "text", body: withEventName(event.config.promo.text, event.config.name) }, { lastInboundAt: session?.lastInboundAt ?? null, locale: event.config.language, from: event.config.qrSender });
  if (r.status === "skipped") deps.log.info({ event: "promo_skipped", slug: event.slug, jobId: item.jobId, reason: r.reason }, "promo skipped");
}

/** Stuck job (lease long expired): retry, or give up after the attempts (SPEC §11.2). */
async function release(deps: PrintDeps, event: PortraitEvent, item: PrintJob, now: Date) {
  const ev = eventObjects(event.slug);
  await deps.sync.map(ev.print, PrintJobSchema).update(item.jobId, (cur) => {
    if (!cur || (cur.state !== "claimed" && cur.state !== "printing") || !cur.leaseUntil || cur.printerJobId) return SKIP;
    if (now.getTime() - Date.parse(cur.leaseUntil) <= STUCK_AFTER_MS) return SKIP;
    return cur.attempts >= MAX_PRINT_ATTEMPTS
      ? { ...cur, state: "failed", leaseUntil: null, error: "agent stopped responding", timestamps: { ...cur.timestamps, failed: now.toISOString() } }
      : { ...cur, state: "queued", leaseUntil: null, error: "agent stopped responding; requeued" };
  });
  deps.log.warn({ event: "print_stuck_released", slug: event.slug, jobId: item.jobId, attempts: item.attempts }, "stuck print released");
}

async function releaseReservation(sync: SyncStore, event: PortraitEvent, addressKey: string) {
  await sync
    .map(eventObjects(event.slug).sessions, SessionSchema)
    .update(addressKey, (s) => (s && s.counters.printsReserved > 0 ? { ...s, counters: { ...s.counters, printsReserved: s.counters.printsReserved - 1 } } : SKIP));
}
