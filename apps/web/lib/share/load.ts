import "server-only";
import { z } from "zod";
import { getEventRepo } from "../admin/context";
import { ShareSchema } from "../delivery/deliver";
import { getEnv, requireEnv } from "../env";
import type { PortraitEvent } from "../events/schema";
import { JobSchema } from "../jobs/schema";
import { signMedia } from "../media-token";
import { getServices } from "../services";
import { eventObjects, Global } from "../sync/names";

const SHARE_ID = z.string().regex(/^[A-Za-z0-9_-]{22,64}$/);
/** Images expire after 7 days (SPEC §6.2, §7); links never outlive that. */
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface ShareView {
  event: PortraitEvent;
  imageUrl: string;
  styleId: string;
  subjects: number;
}

/**
 * Resolves a share id to what the page shows, or null if it is unknown,
 * expired or deleted (SPEC §6.2). No personal data is returned.
 */
export async function loadShare(rawId: string): Promise<ShareView | null> {
  const id = SHARE_ID.safeParse(rawId);
  if (!id.success) return null;
  const { sync, blob } = getServices();
  const share = await sync.map(Global.shares, ShareSchema).get(id.data).catch(() => null);
  if (!share) return null;
  const age = Date.now() - Date.parse(share.createdAt);
  if (age > SEVEN_DAYS_MS) return null;
  const event = await (await getEventRepo()).get(share.eventSlug);
  if (!event) return null;
  const job = await sync.map(eventObjects(event.slug).jobs, JobSchema).get(share.jobId).catch(() => null);
  // Removed by admin, deleted on request, or never delivered: not available.
  if (!job || job.state !== "delivered" || !job.outputBlobs) return null;
  // The blob may already be gone (lifecycle rule or deletion request).
  if (!(await blob.get(job.outputBlobs.deliveryJpeg))) return null;
  const env = requireEnv(getEnv(), ["MEDIA_SIGNING_SECRET", "PUBLIC_BASE_URL"]);
  const ttl = Math.max(60, Math.floor((SEVEN_DAYS_MS - age) / 1000));
  return {
    event,
    imageUrl: new URL(`/m/${signMedia(env.MEDIA_SIGNING_SECRET, job.outputBlobs.deliveryJpeg, ttl)}`, env.PUBLIC_BASE_URL).toString(),
    styleId: job.style,
    subjects: job.subjects ?? 1,
  };
}
