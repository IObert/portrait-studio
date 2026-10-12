import { z } from "zod";
import { catalogs } from "../../i18n";
import { ACTION_SLIDESHOW } from "../conversation/actions";
import { SessionSchema } from "../conversation/session";
import type { PortraitEvent } from "../events/schema";
import { type Job, JobSchema } from "../jobs/schema";
import { type Address, mask, supportsMms } from "../messaging/address";
import { insideWindow, type Messenger } from "../messaging/outbound";
import { bump } from "../stats";
import { eventObjects, Global } from "../sync/names";
import { SKIP, type SyncStore } from "../sync/store";
import { PrintJobSchema } from "./print-schema";

const SEVEN_DAYS = 7 * 24 * 60 * 60;
/** Twilio fetches media right away; give it room for retries. */
const MEDIA_LINK_TTL = 60 * 60;

export const ShareSchema = z.object({ eventSlug: z.string(), jobId: z.string(), createdAt: z.iso.datetime() });

export interface DeliveryDeps {
  sync: SyncStore;
  messenger: Messenger;
  /** Public URL of the delivery JPEG for Twilio (signed /m/<token> link). */
  mediaUrl: (blobPath: string, ttlSeconds: number) => string;
  publicBaseUrl: string;
  /** Approved `delivery` template SIDs (SPEC §6.3); absent until setup:twilio has run. */
  templates: Partial<Record<"en" | "pt_BR", string>>;
  log: { info(o: object, m: string): void; warn(o: object, m: string): void };
  now?: () => Date;
}

export interface DeliverOptions {
  /** Admin approval of a flagged image: delivered like a normal result, but not counted toward quota (SPEC §4.3, §5.7). */
  approvedByAdmin?: boolean;
}

/**
 * Delivers a finished portrait (SPEC §6.1) and does the follow-ups: share
 * record, quota, stats, print job and the slideshow question (§5.8).
 * Idempotent per job: a second call for a delivered job does nothing.
 */
export async function deliver(deps: DeliveryDeps, event: PortraitEvent, job: Job, address: Address, opts: DeliverOptions = {}): Promise<"sent" | "skipped"> {
  const now = deps.now?.() ?? new Date();
  const ev = eventObjects(event.slug);
  const c = catalogs[event.config.language];
  const locale = event.config.language;
  if (!job.outputBlobs) throw new Error("Job has no output to deliver");

  // 1. Claim the delivery on the job itself, so retries never send twice.
  const jobs = deps.sync.map(ev.jobs, JobSchema);
  const from = opts.approvedByAdmin ? "approved_by_admin" : "processing";
  let mine = false;
  await jobs.update(job.jobId, (cur) => {
    mine = cur?.state === from;
    return mine ? { ...cur!, state: "delivered", leaseUntil: null, timestamps: { ...cur!.timestamps, delivered: now.toISOString() } } : SKIP;
  });
  if (!mine) return "skipped"; // already delivered by another worker or attempt

  // 2. Share record, so /s/<shareId> can find the job (D-04).
  await deps.sync.ensureMap(Global.shares);
  await deps.sync.map(Global.shares, ShareSchema, { ttlSeconds: SEVEN_DAYS }).put(job.shareId, { eventSlug: event.slug, jobId: job.jobId, createdAt: now.toISOString() });
  const shareUrl = new URL(`/s/${job.shareId}`, deps.publicBaseUrl).toString();
  const styleName = c.styles[job.style].name;
  const media = deps.mediaUrl(job.outputBlobs.deliveryJpeg, MEDIA_LINK_TTL);

  // 3. Session: quota (not for admin approvals), in-flight slot, and decide print.
  const sessions = deps.sync.map(ev.sessions, SessionSchema);
  let printReserved = false;
  const session = await sessions.update(job.address, (s) => {
    if (!s) return SKIP;
    const counters = { ...s.counters };
    if (!opts.approvedByAdmin) {
      counters.delivered += 1;
      counters.inFlight = Math.max(0, counters.inFlight - 1);
    }
    // A print reserves quota until it finishes or finally fails (docs/decisions.md).
    printReserved = event.config.printingEnabled && counters.printed + counters.printsReserved < event.config.maxPrintsPerPerson;
    if (printReserved) counters.printsReserved += 1;
    return { ...s, counters, pendingSlideshow: { jobId: job.jobId, group: (job.subjects ?? 1) > 1 } };
  });

  // 4. Send (SPEC §6.1, §5.11).
  const ctx = { lastInboundAt: session?.lastInboundAt ?? null, locale, from: event.config.qrSender };
  let result: "sent" | "skipped";
  if (address.channel === "whatsapp") {
    if (insideWindow(session?.lastInboundAt, now)) {
      result = (await deps.messenger.send(address, { kind: "text", body: c.delivery.caption({ styleName, shareUrl }), mediaUrl: media }, ctx)).status;
    } else {
      result = await sendTemplate(deps, address, locale, { media, shareId: job.shareId }, event);
    }
  } else if (supportsMms(address.e164)) {
    result = (await deps.messenger.send(address, { kind: "text", body: c.delivery.caption({ styleName, shareUrl }), mediaUrl: media }, ctx)).status;
  } else {
    result = (await deps.messenger.send(address, { kind: "text", body: c.delivery.linkOnly({ styleName, shareUrl }) }, ctx)).status;
  }

  // 5. Stats (SPEC §10.5).
  await bump(deps.sync, event.slug, opts.approvedByAdmin ? "approvedByAdmin" : "imagesDelivered");
  if (!opts.approvedByAdmin && job.timestamps.queued) {
    await bump(deps.sync, event.slug, "deliveryMsTotal", now.getTime() - Date.parse(job.timestamps.queued));
    await bump(deps.sync, event.slug, "deliveryCount");
  }

  // 6. Print job (SPEC §6.1, §11.3). Personal data is not allowed: masked address only.
  if (printReserved) {
    await deps.sync.ensureMap(ev.print);
    await deps.sync.map(ev.print, PrintJobSchema, { ttlSeconds: SEVEN_DAYS }).create(job.jobId, {
      jobId: job.jobId,
      blobPath: job.outputBlobs.printPng,
      who: mask(address),
      state: "queued",
      attempts: 0,
      leaseUntil: null,
      error: null,
      reprint: false,
      timestamps: { queued: now.toISOString() },
    });
  }

  // 7. Slideshow question, inside the window only (SPEC §5.8, §5.11).
  if (result === "sent") {
    const group = (job.subjects ?? 1) > 1;
    const body = group ? c.delivery.slideshowQuestionGroup : c.delivery.slideshowQuestion;
    const yes = c.delivery.yesKeywords[0]!.toUpperCase();
    const no = c.delivery.noKeywords[0]!.toUpperCase();
    await deps.messenger.send(
      address,
      {
        kind: "buttons",
        body,
        buttons: [
          { id: ACTION_SLIDESHOW.yes(job.jobId), title: c.delivery.slideshowYes },
          { id: ACTION_SLIDESHOW.no(job.jobId), title: c.delivery.slideshowNo },
        ],
        smsBody: `${body} (${yes} / ${no})`,
      },
      ctx,
    );
  }
  deps.log.info({ event: "delivered", slug: event.slug, jobId: job.jobId, channel: address.channel, result, print: printReserved, approved: !!opts.approvedByAdmin }, "portrait delivered");
  return result;
}

/** Out-of-window WhatsApp delivery with the approved template (SPEC §5.7, §6.3). */
async function sendTemplate(
  deps: DeliveryDeps,
  address: Address,
  locale: "en" | "pt_BR",
  vars: { media: string; shareId: string },
  event: PortraitEvent,
): Promise<"sent" | "skipped"> {
  const sid = deps.templates[locale];
  if (!sid) {
    // Not set up yet (milestone k). The portrait stays on the share page.
    deps.log.warn({ event: "send_skipped", reason: "no-delivery-template", to: mask(address), slug: event.slug }, "outside 24h window and no delivery template configured");
    return "skipped";
  }
  const r = await deps.messenger.sendTemplate(address, sid, { "1": vars.media, "2": vars.shareId }, { from: event.config.qrSender });
  return r.status;
}
