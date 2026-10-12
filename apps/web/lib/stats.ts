import { z } from "zod";
import { eventObjects } from "./sync/names";
import { SKIP, type SyncStore } from "./sync/store";

/**
 * Per-event counters (SPEC §10.5). No personal data. Each metric lives in one
 * shard of `ev_<slug>_stats_N` (docs/decisions.md D-03).
 * TODO(scalability): counters are the hottest per-event objects (SPEC §3.4).
 */
export const METRICS = [
  "interactions",
  "uniqueOptIns",
  "leadsVerifiedEmail",
  "leadsReturning",
  "leadsAgreeOnly",
  "imagesRequested",
  "imagesDelivered",
  "flagged",
  "rejected",
  "failed",
  "approvedByAdmin",
  "printsSucceeded",
  "printsFailed",
  "slideshowYes",
  "deletionRequests",
  /** Sum and count for the average selfie→delivery time. */
  "deliveryMsTotal",
  "deliveryCount",
] as const;
export type Metric = (typeof METRICS)[number] | `style:${string}` | `background:${string}`;

const Counter = z.object({ n: z.number() });

export async function bump(sync: SyncStore, slug: string, metric: Metric, by = 1): Promise<void> {
  const ev = eventObjects(slug);
  const map = ev.stats(metric);
  await sync.ensureMap(map);
  await sync.map(map, Counter).update(metric, (cur) => (by === 0 ? SKIP : { n: (cur?.n ?? 0) + by }));
}

/** All counters for the stats page, summed across shards. */
export async function readStats(sync: SyncStore, slug: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const map of eventObjects(slug).allStats()) {
    for await (const [k, v] of sync.map(map, Counter).entries()) out[k] = (out[k] ?? 0) + v.n;
  }
  return out;
}
