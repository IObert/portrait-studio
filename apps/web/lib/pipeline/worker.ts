import { catalogs } from "../../i18n";
import { SessionSchema } from "../conversation/session";
import type { EventRepo } from "../events/repo";
import type { PortraitEvent } from "../events/schema";
import { type Job, JobSchema } from "../jobs/schema";
import { parseAddress } from "../messaging/address";
import type { Messenger } from "../messaging/outbound";
import { backoffDelay } from "../retry";
import { eventObjects } from "../sync/names";
import { ConcurrentModification, SKIP, type SyncStore } from "../sync/store";
import { bump } from "../stats";
import { type PipelineDeps, type PipelineOutcome, runPipeline } from "./run";

export const LEASE_MS = 3 * 60 * 1000;
export const MAX_ATTEMPTS = 3;
const HEARTBEAT_MS = 60 * 1000;

export interface Logger {
  info(o: object, m: string): void;
  warn(o: object, m: string): void;
  error(o: object, m: string): void;
}

export interface WorkerDeps {
  sync: SyncStore;
  events: EventRepo;
  messenger: Messenger;
  pipeline: Omit<PipelineDeps, "signal">;
  log: Logger;
  /** Called when a job passes review (SPEC §6). Milestone g implements delivery. */
  onReady: (event: PortraitEvent, job: Job) => Promise<void>;
  now?: () => Date;
  workerId: string;
}

/** Retry metadata stored on the job (`error` holds a short reason, never personal data). */
function isRunnable(job: Job, now: Date): boolean {
  if (job.state === "queued") return !job.leaseUntil || Date.parse(job.leaseUntil) <= now.getTime();
  // An expired lease on a processing job means its worker died: take it back (SPEC §9.1).
  return job.state === "processing" && !!job.leaseUntil && Date.parse(job.leaseUntil) <= now.getTime();
}

/**
 * One pass over all live events: claim and run at most `limit` jobs.
 * Returns how many jobs were processed. Safe with many workers in parallel.
 */
export async function workOnce(deps: WorkerDeps, limit = 1): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const events = (await deps.events.list()).filter((e) => e.state !== "draft");
  let done = 0;
  for (const event of events) {
    const jobs = deps.sync.map(eventObjects(event.slug).jobs, JobSchema);
    const candidates: Job[] = [];
    for await (const [, job] of jobs.entries((key) => deps.log.warn({ event: "job_invalid", slug: event.slug, jobId: key }, "invalid job item"))) {
      if (isRunnable(job, now)) candidates.push(job);
    }
    // Oldest first.
    candidates.sort((a, b) => (a.timestamps.queued ?? "").localeCompare(b.timestamps.queued ?? ""));
    for (const c of candidates) {
      if (done >= limit) return done;
      const claimed = await claim(deps, event, c.jobId);
      if (!claimed) continue;
      await process(deps, event, claimed);
      done++;
    }
  }
  return done;
}

/** Claims a job with If-Match (SPEC §9.1). Returns null if another worker got it first. */
async function claim(deps: WorkerDeps, event: PortraitEvent, jobId: string): Promise<Job | null> {
  const jobs = deps.sync.map(eventObjects(event.slug).jobs, JobSchema);
  const v = await jobs.getVersioned(jobId);
  const now = deps.now?.() ?? new Date();
  if (!v || !isRunnable(v.data, now)) return null;
  const claimed: Job = {
    ...v.data,
    state: "processing",
    attempts: v.data.attempts + 1,
    leaseUntil: new Date(now.getTime() + LEASE_MS).toISOString(),
    timestamps: { ...v.data.timestamps, processing: now.toISOString() },
  };
  try {
    await jobs.writeIfUnchanged(jobId, claimed, v.revision);
    return claimed;
  } catch (err) {
    if (err instanceof ConcurrentModification) return null;
    throw err;
  }
}

async function process(deps: WorkerDeps, event: PortraitEvent, job: Job): Promise<void> {
  const jobs = deps.sync.map(eventObjects(event.slug).jobs, JobSchema);
  const log = { slug: event.slug, jobId: job.jobId, attempt: job.attempts };
  const controller = new AbortController();
  // Keep the lease while a slow generation runs (up to ~2 min).
  const heartbeat = setInterval(() => {
    const until = new Date(Date.now() + LEASE_MS).toISOString();
    void jobs.update(job.jobId, (cur) => (cur?.state === "processing" ? { ...cur, leaseUntil: until } : SKIP)).catch(() => {});
  }, HEARTBEAT_MS);

  const started = performance.now();
  let outcome: PipelineOutcome;
  try {
    outcome = await runPipeline({ ...deps.pipeline, signal: controller.signal }, event, job);
  } catch (err) {
    clearInterval(heartbeat);
    return retryOrFail(deps, event, job, err);
  }
  clearInterval(heartbeat);
  deps.log.info({ event: "job_finished", ...log, outcome: outcome.kind, ms: Math.round(performance.now() - started) }, "job finished");
  await finish(deps, event, job, outcome);
}

/** Transient errors retry with backoff; after MAX_ATTEMPTS the job fails (SPEC §9.1, fail closed). */
async function retryOrFail(deps: WorkerDeps, event: PortraitEvent, job: Job, err: unknown): Promise<void> {
  const jobs = deps.sync.map(eventObjects(event.slug).jobs, JobSchema);
  const now = deps.now?.() ?? new Date();
  const status = (err as { status?: number }).status;
  const message = (err as Error).message?.slice(0, 300) ?? String(err);
  if (job.attempts < MAX_ATTEMPTS) {
    const retryAfterMs = Number((err as { headers?: Record<string, string> }).headers?.["retry-after"]) * 1000 || undefined;
    const delay = backoffDelay(job.attempts, { baseMs: 5_000, maxMs: 60_000, minMs: 5_000 }, retryAfterMs);
    deps.log.warn({ event: "job_retry", slug: event.slug, jobId: job.jobId, attempt: job.attempts, status, error: message, delayMs: delay }, "job will be retried");
    // Back to queued; leaseUntil doubles as "not before" for the next attempt.
    await jobs.update(job.jobId, (cur) =>
      cur?.state === "processing" ? { ...cur, state: "queued", leaseUntil: new Date(now.getTime() + delay).toISOString(), error: message } : SKIP,
    );
    return;
  }
  deps.log.error({ event: "job_failed", slug: event.slug, jobId: job.jobId, attempts: job.attempts, status, error: message }, "job failed after retries");
  await finish(deps, event, { ...job, error: message }, null);
}

/** Writes the final state, releases the in-flight slot and sends the §5.6 message. */
async function finish(deps: WorkerDeps, event: PortraitEvent, job: Job, outcome: PipelineOutcome | null): Promise<void> {
  const ev = eventObjects(event.slug);
  const now = (deps.now?.() ?? new Date()).toISOString();
  const state = outcome === null ? "failed" : outcome.kind === "ready" ? "processing" : outcome.kind;
  const updated = await deps.sync.map(ev.jobs, JobSchema).update(job.jobId, (cur) => {
    if (!cur || cur.state !== "processing") return SKIP; // someone else finished it (expired lease)
    return {
      ...cur,
      state,
      leaseUntil: null,
      error: outcome === null ? job.error : outcome.kind === "rejected" ? outcome.reason : null,
      subjects: outcome && outcome.kind !== "rejected" ? outcome.subjects : cur.subjects,
      outputBlobs: outcome && outcome.kind !== "rejected" ? outcome.outputBlobs : cur.outputBlobs,
      aiReview: outcome?.kind === "flagged" ? { result: "fail", reason: outcome.reason } : outcome?.kind === "ready" ? { result: "pass", reason: "" } : cur.aiReview,
      timestamps: state === "processing" ? cur.timestamps : { ...cur.timestamps, [state]: now },
    };
  });
  if (!updated) return;

  if (outcome?.kind === "ready") {
    // Passed review: delivery (milestone g) counts the quota and releases the slot.
    await deps.onReady(event, updated);
    return;
  }

  // Not delivered: this attempt does not count toward quota (SPEC §4.3).
  await releaseInFlight(deps, event, job.address);
  await bump(deps.sync, event.slug, outcome === null ? "failed" : outcome.kind === "flagged" ? "flagged" : "rejected");
  const address = addressFromKey(job.address);
  if (!address) return;
  const c = catalogs[event.config.language];
  const body =
    outcome === null
      ? c.job.failed
      : outcome.kind === "flagged"
        ? c.job.reviewFlagged
        : outcome.reason === "moderation" || outcome.reason === "generation_refused"
          ? c.job.moderationRejected
          : outcome.reason === "too_many_people"
            ? c.job.tooManyPeople
            : c.job.noFace;
  const session = await deps.sync.map(ev.sessions, SessionSchema).get(job.address);
  await deps.messenger.send(address, { kind: "text", body }, { lastInboundAt: session?.lastInboundAt ?? null, locale: event.config.language, from: event.config.qrSender });
}

export async function releaseInFlight(deps: Pick<WorkerDeps, "sync">, event: PortraitEvent, addressKey: string): Promise<void> {
  await deps.sync
    .map(eventObjects(event.slug).sessions, SessionSchema)
    .update(addressKey, (s) => (s && s.counters.inFlight > 0 ? { ...s, counters: { ...s.counters, inFlight: s.counters.inFlight - 1 } } : SKIP));
}

/** Session key `whatsapp:+…` / `sms:+…` back to an Address. */
export function addressFromKey(key: string) {
  const [channel, e164] = key.split(":", 2);
  if (channel === "whatsapp") return parseAddress(`whatsapp:${e164}`);
  if (channel === "sms") return parseAddress(e164 ?? "");
  return null;
}
