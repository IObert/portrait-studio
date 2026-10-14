import "server-only";
import { z } from "zod";
import { getEventRepo } from "../admin/context";
import { SessionSchema } from "../conversation/session";
import { ShareSchema } from "../delivery/deliver";
import { canPrintAgain, printsLeft } from "../delivery/print-request";
import { PrintJobSchema } from "../delivery/print-schema";
import { getEnv, requireEnv } from "../env";
import type { PortraitEvent } from "../events/schema";
import { type Job, JobSchema } from "../jobs/schema";
import { signMedia } from "../media-token";
import { getServices } from "../services";
import { eventObjects, Global } from "../sync/names";

const SHARE_ID = z.string().regex(/^[A-Za-z0-9_-]{22,64}$/);
/** Images expire after 7 days (SPEC §6.2, §7); links never outlive that. */
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** Why a share link shows no portrait (SPEC §6.2, D-16). */
export type ShareGone = { gone: "removed" | "unavailable"; locale: "en" | "pt_BR" };

export interface ShareView {
  event: PortraitEvent;
  imageUrl: string;
  styleId: string;
  subjects: number;
  /** Print button (D-26): null when printing is off; otherwise prints left, whether a print is on its way, and whether it was printed before. */
  print: { left: number; pending: boolean; printedBefore: boolean } | null;
}

/** The event and job behind a live share id, for the print button (D-26). */
export async function shareTarget(rawId: string): Promise<{ event: PortraitEvent; job: Job } | null> {
  const id = SHARE_ID.safeParse(rawId);
  if (!id.success) return null;
  const { sync } = getServices();
  const share = await sync.map(Global.shares, ShareSchema).get(id.data).catch(() => null);
  if (!share || Date.now() - Date.parse(share.createdAt) > SEVEN_DAYS_MS) return null;
  const event = await (await getEventRepo()).get(share.eventSlug);
  if (!event) return null;
  const job = await sync.map(eventObjects(event.slug).jobs, JobSchema).get(share.jobId).catch(() => null);
  return job ? { event, job } : null;
}

/**
 * Resolves a share id to what the page shows, or null if it is unknown,
 * expired or deleted (SPEC §6.2). No personal data is returned.
 */
export async function loadShare(rawId: string): Promise<ShareView | ShareGone> {
  const unavailable: ShareGone = { gone: "unavailable", locale: "en" };
  const id = SHARE_ID.safeParse(rawId);
  if (!id.success) return unavailable;
  const { sync, blob } = getServices();
  const share = await sync.map(Global.shares, ShareSchema).get(id.data).catch(() => null);
  if (!share) return unavailable;
  const event = await (await getEventRepo()).get(share.eventSlug);
  if (!event) return unavailable;
  const locale = event.config.language;
  const job = await sync.map(eventObjects(event.slug).jobs, JobSchema).get(share.jobId).catch(() => null);
  // Taken down by an admin: its own message (D-16).
  if (job?.state === "removed_by_admin") return { gone: "removed", locale };
  const age = Date.now() - Date.parse(share.createdAt);
  if (age > SEVEN_DAYS_MS || !job || job.state !== "delivered" || !job.outputBlobs) return { gone: "unavailable", locale };
  // The blob may already be gone (lifecycle rule or deletion request).
  if (!(await blob.get(job.outputBlobs.deliveryJpeg))) return { gone: "unavailable", locale };
  const env = requireEnv(getEnv(), ["MEDIA_SIGNING_SECRET", "PUBLIC_BASE_URL"]);
  const ttl = Math.max(60, Math.floor((SEVEN_DAYS_MS - age) / 1000));
  let print: ShareView["print"] = null;
  if (event.config.printingEnabled) {
    const ev = eventObjects(event.slug);
    const [session, item] = await Promise.all([
      sync.map(ev.sessions, SessionSchema).get(job.address).catch(() => null),
      sync.map(ev.print, PrintJobSchema).get(job.jobId).catch(() => null),
    ]);
    print = {
      left: session ? printsLeft(event, session.counters) : 0,
      pending: !!item && !canPrintAgain(item),
      printedBefore: item?.state === "printed",
    };
  }
  return {
    event,
    print,
    imageUrl: new URL(`/m/${signMedia(env.MEDIA_SIGNING_SECRET, job.outputBlobs.deliveryJpeg, ttl)}`, env.PUBLIC_BASE_URL).toString(),
    styleId: job.style ?? "",
    subjects: job.subjects ?? 1,
  };
}
