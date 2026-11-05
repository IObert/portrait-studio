import { BlobPaths } from "../blob/paths";
import type { BlobStore } from "../blob/store";
import type { PortraitEvent } from "../events/schema";
import { eventObjects } from "../sync/names";
import type { SyncStore } from "../sync/store";
import { PrintJobSchema } from "./print-schema";

const SEVEN_DAYS = 7 * 24 * 60 * 60;

/** Key of the chart in the print queue: one at a time per event. */
export const CHART_JOB_ID = "clipping-chart";

export class ChartError extends Error {}

/**
 * Queues the clipping chart on the event's print agent (D-45). It travels like an admin reprint: it counts
 * toward nobody's quota, sends no promo and has no portrait behind it (the server settles it without
 * counting). Its blob is not a `.print.png`, so the download route leaves it uncalibrated: the chart
 * measures the printer as it is.
 */
export async function queueClippingChart(
  deps: { sync: SyncStore; blob: BlobStore; chart: () => Promise<Buffer>; mediaUrl: (blobPath: string, ttlSeconds: number) => string },
  event: PortraitEvent,
  now = new Date(),
): Promise<void> {
  // Without printing the agent cannot connect (PROTOCOL.md §2) and the server never settles the item.
  if (!event.config.printingEnabled) throw new ChartError("Turn printing on and save before printing the chart");
  const ev = eventObjects(event.slug);
  await deps.sync.ensureMap(ev.print);
  const print = deps.sync.map(ev.print, PrintJobSchema, { ttlSeconds: SEVEN_DAYS });
  const existing = await print.getVersioned(CHART_JOB_ID);
  if (existing && (existing.data.state === "queued" || existing.data.state === "claimed" || existing.data.state === "printing"))
    throw new ChartError("A chart is already waiting to print");

  const blobPath = BlobPaths.clippingChart(event.slug);
  await deps.blob.put(blobPath, await deps.chart(), "image/png");
  // Replace only the item we just looked at (If-Match), like a reprint.
  if (existing) await print.delete(CHART_JOB_ID, existing.revision);
  const created = await print.create(CHART_JOB_ID, {
    jobId: CHART_JOB_ID,
    blobPath,
    url: deps.mediaUrl(blobPath, SEVEN_DAYS),
    who: "calibration chart",
    state: "queued",
    attempts: 0,
    leaseUntil: null,
    error: null,
    reprint: true,
    timestamps: { queued: now.toISOString() },
  });
  if (!created) throw new ChartError("A chart is already waiting to print");
}
