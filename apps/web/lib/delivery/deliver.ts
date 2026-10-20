import { z } from "zod";
import { catalogs } from "../../i18n";
import type { Catalog } from "../../i18n/types";
import { ACTION_SLIDESHOW } from "../conversation/actions";
import { SessionSchema } from "../conversation/session";
import type { PortraitEvent } from "../events/schema";
import { type Job, JobSchema } from "../jobs/schema";
import { type Address, mask, supportsMms } from "../messaging/address";
import { insideWindow, type Messenger, type OutboundMessage } from "../messaging/outbound";
import { bump } from "../stats";
import { eventObjects, Global } from "../sync/names";
import { SKIP, type SyncStore } from "../sync/store";
import { printsLeft } from "./print-request";

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
  /** Approved `delivery` template SIDs (SPEC §6.3); absent until they are configured. */
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
 * record, quota, stats and the print / slideshow question (§5.8, D-24).
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
  if (!job.style) throw new Error("Job has no style");
  const styleName = c.styles[job.style].name;
  const media = deps.mediaUrl(job.outputBlobs.deliveryJpeg, MEDIA_LINK_TTL);

  // 3. Session: quota (not for admin approvals) and the in-flight slot. Nothing is
  // printed here: the attendee chooses which portraits to print (D-24).
  const sessions = deps.sync.map(ev.sessions, SessionSchema);
  const group = (job.subjects ?? 1) > 1;
  let left = 0;
  const session = await sessions.update(job.address, (s) => {
    if (!s) return SKIP;
    const counters = { ...s.counters };
    if (!opts.approvedByAdmin) {
      counters.delivered += 1;
      counters.inFlight = Math.max(0, counters.inFlight - 1);
    }
    left = printsLeft(event, counters);
    const delivered = [...s.delivered.filter((id) => id !== job.jobId), job.jobId].slice(-10);
    return { ...s, counters, delivered, pendingSlideshow: { jobId: job.jobId, group, print: left > 0, askedAt: now.toISOString() } };
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

  // 6. One question, inside the window only (SPEC §5.8, §5.11, D-24): print and
  // show, show only, or neither. Without prints left it is the slideshow question.
  if (result === "sent") await deps.messenger.send(address, followUp(c, job.jobId, group, left), ctx);
  deps.log.info({ event: "delivered", slug: event.slug, jobId: job.jobId, channel: address.channel, result, printOffered: left > 0, approved: !!opts.approvedByAdmin }, "portrait delivered");
  return result;
}

function followUp(c: Catalog, jobId: string, group: boolean, printsLeft: number): OutboundMessage {
  const d = c.delivery;
  if (printsLeft > 0) {
    const body = group ? d.printQuestionGroup({ printsLeft }) : d.printQuestion({ printsLeft });
    return {
      kind: "buttons",
      body,
      buttons: [
        { id: ACTION_SLIDESHOW.print(jobId), title: d.printAndSlideshow },
        { id: ACTION_SLIDESHOW.yes(jobId), title: d.slideshowOnly },
        { id: ACTION_SLIDESHOW.no(jobId), title: d.noThanks },
      ],
      smsBody: `${body} ${d.printSmsHint}`,
    };
  }
  const body = group ? d.slideshowQuestionGroup : d.slideshowQuestion;
  const yes = d.yesKeywords[0]!.toUpperCase();
  const no = d.noKeywords[0]!.toUpperCase();
  return {
    kind: "buttons",
    body,
    buttons: [
      { id: ACTION_SLIDESHOW.yes(jobId), title: d.slideshowYes },
      { id: ACTION_SLIDESHOW.no(jobId), title: d.slideshowNo },
    ],
    smsBody: `${body} (${yes} / ${no})`,
  };
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
    // No delivery template configured. The portrait stays on the share page.
    deps.log.warn({ event: "send_skipped", reason: "no-delivery-template", to: mask(address), slug: event.slug }, "outside 24h window and no delivery template configured");
    return "skipped";
  }
  // The template's URLs are `<base>/{{1}}` and `<base>/s/{{2}}` (scripts/setup-twilio.ts).
  const media = `${new URL(vars.media).pathname.slice(1)}.jpg`;
  const r = await deps.messenger.sendTemplate(address, sid, { "1": media, "2": vars.shareId }, { from: event.config.qrSender });
  return r.status;
}
