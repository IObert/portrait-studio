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

/**
 * When the counters were last zeroed (SPEC §10.5). Its own map, not a counter
 * shard: the shards hold only `{n}` counters.
 */
const ResetSchema = z.object({ at: z.iso.datetime() });
const resetMap = (slug: string) => eventObjects(slug).statsMeta;

export async function readLastReset(sync: SyncStore, slug: string): Promise<string | null> {
  return (await sync.map(resetMap(slug), ResetSchema).get("lastResetAt"))?.at ?? null;
}

/**
 * Zeroes every counter of an event and records `lastResetAt` (SPEC §10.5,
 * `stats:reset`). Counters are deleted rather than set to 0, so the page
 * shows only what was counted since. Returns how many counters were cleared.
 */
export async function resetStats(sync: SyncStore, slug: string, now = new Date()): Promise<number> {
  let n = 0;
  for (const map of eventObjects(slug).allStats()) {
    const keys: string[] = [];
    for await (const [k] of sync.map(map, Counter).entries()) keys.push(k);
    for (const k of keys) await sync.map(map, Counter).delete(k);
    n += keys.length;
  }
  await sync.ensureMap(resetMap(slug));
  await sync.map(resetMap(slug), ResetSchema).put("lastResetAt", { at: now.toISOString() });
  return n;
}
