import "server-only";
import { SAS_TTL_SECONDS } from "../blob/store";
import { PrintJobSchema, type PrintJob } from "../delivery/print-schema";
import { SlideshowItemSchema } from "../delivery/slideshow";
import { type Job, JobSchema } from "../jobs/schema";
import { getServices } from "../services";
import { eventObjects } from "../sync/names";
import { IN_PROGRESS_STATES, type InProgressState, sinceMs } from "./pending";

export interface ReviewItem {
  job: Pick<Job, "jobId" | "style" | "background" | "subjects" | "aiReview" | "timestamps" | "state" | "error">;
  /** Masked address only (no full phone numbers in the admin list). */
  who: string;
  selfieUrl: string | null;
  outputUrl: string | null;
  inSlideshow: boolean;
  /** An admin hid it from the booth screen (D-54). */
  hiddenFromScreen: boolean;
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
      hiddenFromScreen: job.hiddenFromScreen,
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

/** A print that has not come out yet, for the "Printing" tab (SPEC §10.3, D-54). */
export interface PrintingItem {
  jobId: string;
  state: PrintJob["state"];
  reprint: boolean;
  attempts: number;
  error: string | null;
  /** Masked address, or "admin reprint". */
  who: string;
  /** How long it has been queued (ms), from the time it was queued; null when unknown. */
  waitedMs: number | null;
  job: Pick<Job, "style" | "background" | "subjects"> | null;
  outputUrl: string | null;
}

/** Prints that are queued, picked up, printing or failed, the oldest first. Printed ones are not pending. */
export async function listPrinting(slug: string, now = new Date()): Promise<PrintingItem[]> {
  const { sync, blob } = getServices();
  const ev = eventObjects(slug);
  const pending: PrintJob[] = [];
  for await (const [, p] of sync.map(ev.print, PrintJobSchema).entries()) if (p.state !== "printed") pending.push(p);
  pending.sort((a, b) => (a.timestamps.queued ?? "").localeCompare(b.timestamps.queued ?? ""));
  return Promise.all(
    pending.map(async (p): Promise<PrintingItem> => {
      const job = await sync.map(ev.jobs, JobSchema).get(p.jobId).catch(() => null);
      const outputUrl = job?.outputBlobs ? await blob.readUrl(job.outputBlobs.deliveryJpeg, SAS_TTL_SECONDS).catch(() => null) : null;
      return {
        jobId: p.jobId,
        state: p.state,
        reprint: p.reprint,
        attempts: p.attempts,
        error: p.error,
        who: p.who,
        waitedMs: sinceMs(p.timestamps.queued, now),
        job: job ? { style: job.style, background: job.background, subjects: job.subjects } : null,
        outputUrl,
      };
    }),
  );
}

/** A portrait that is not done: being checked, waiting for a choice, queued, generating, or failed. */
export interface InProgressItem {
  job: Pick<Job, "jobId" | "style" | "background" | "subjects" | "attempts" | "error">;
  state: InProgressState;
  who: string;
  /** How long it has been in this state (ms); null when the time was not recorded. */
  waitedMs: number | null;
}

/** Jobs still on their way, the longest-waiting first (the stuck ones come to the top). Rejected ones are not listed. */
export async function listInProgress(slug: string, now = new Date()): Promise<InProgressItem[]> {
  const items: InProgressItem[] = [];
  for await (const [, job] of getServices().sync.map(eventObjects(slug).jobs, JobSchema).entries()) {
    if (!(IN_PROGRESS_STATES as readonly string[]).includes(job.state)) continue;
    items.push({
      job: { jobId: job.jobId, style: job.style, background: job.background, subjects: job.subjects, attempts: job.attempts, error: job.error },
      state: job.state as InProgressState,
      who: maskKey(job.address),
      waitedMs: sinceMs(job.timestamps[job.state], now),
    });
  }
  return items.sort((a, b) => (b.waitedMs ?? -1) - (a.waitedMs ?? -1));
}

/** The numbers on the Review tabs. Reads job and print states only: no image links. */
export async function reviewCounts(slug: string): Promise<{ flagged: number; delivered: number; inProgress: number; printing: number }> {
  const { sync } = getServices();
  const ev = eventObjects(slug);
  const counts = { flagged: 0, delivered: 0, inProgress: 0, printing: 0 };
  for await (const [, job] of sync.map(ev.jobs, JobSchema).entries()) {
    if (job.state === "flagged") counts.flagged++;
    else if (job.state === "delivered") counts.delivered++;
    else if ((IN_PROGRESS_STATES as readonly string[]).includes(job.state)) counts.inProgress++;
  }
  for await (const [, p] of sync.map(ev.print, PrintJobSchema).entries()) if (p.state !== "printed") counts.printing++;
  return counts;
}
