import "server-only";
import { SAS_TTL_SECONDS } from "../blob/store";
import { PrintJobSchema, type PrintJob } from "../delivery/print-schema";
import { SlideshowItemSchema } from "../delivery/slideshow";
import { type Job, JobSchema } from "../jobs/schema";
import { getServices } from "../services";
import { eventObjects } from "../sync/names";

export interface ReviewItem {
  job: Pick<Job, "jobId" | "style" | "background" | "subjects" | "aiReview" | "timestamps" | "state" | "error">;
  /** Masked address only (no full phone numbers in the admin list). */
  who: string;
  selfieUrl: string | null;
  outputUrl: string | null;
  inSlideshow: boolean;
  print: Pick<PrintJob, "state" | "reprint"> | null;
}

function maskKey(key: string) {
  const [channel, e164 = ""] = key.split(":", 2);
  return `${channel} ${e164.slice(0, 3)}…${e164.slice(-2)}`;
}

/** Flagged and delivered jobs for the review tabs (SPEC §10.3), newest first. */
export async function listForReview(slug: string): Promise<{ flagged: ReviewItem[]; delivered: ReviewItem[] }> {
  const { sync, blob } = getServices();
  const ev = eventObjects(slug);
  const [slideshow, prints] = [new Set<string>(), new Map<string, PrintJob>()];
  for await (const [k] of sync.map(ev.slideshow, SlideshowItemSchema).entries()) slideshow.add(k);
  for await (const [k, p] of sync.map(ev.print, PrintJobSchema).entries()) prints.set(k, p);

  const flagged: ReviewItem[] = [];
  const delivered: ReviewItem[] = [];
  const url = (p: string | undefined) => (p ? blob.readUrl(p, SAS_TTL_SECONDS).catch(() => null) : Promise.resolve(null));
  for await (const [, job] of sync.map(ev.jobs, JobSchema).entries()) {
    if (job.state !== "flagged" && job.state !== "delivered") continue;
    const [selfieUrl, outputUrl] = await Promise.all([job.state === "flagged" ? url(job.selfieBlob) : Promise.resolve(null), url(job.outputBlobs?.deliveryJpeg)]);
    const p = prints.get(job.jobId);
    const item: ReviewItem = {
      job: { jobId: job.jobId, style: job.style, background: job.background, subjects: job.subjects, aiReview: job.aiReview, timestamps: job.timestamps, state: job.state, error: job.error },
      who: maskKey(job.address),
      selfieUrl,
      outputUrl,
      inSlideshow: slideshow.has(job.jobId),
      print: p ? { state: p.state, reprint: p.reprint } : null,
    };
    (job.state === "flagged" ? flagged : delivered).push(item);
  }
  const newest = (a: ReviewItem, b: ReviewItem) =>
    (b.job.timestamps.delivered ?? b.job.timestamps.flagged ?? "").localeCompare(a.job.timestamps.delivered ?? a.job.timestamps.flagged ?? "");
  return { flagged: flagged.sort(newest), delivered: delivered.sort(newest) };
}

/** Flagged jobs waiting for review: the badge on the Review tab. Reads job states only, no image URLs. */
export async function countFlagged(slug: string): Promise<number> {
  let n = 0;
  for await (const [, job] of getServices().sync.map(eventObjects(slug).jobs, JobSchema).entries()) if (job.state === "flagged") n++;
  return n;
}
