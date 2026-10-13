import { createHash } from "node:crypto";
import { z } from "zod";

/** Event slug: URL-safe, also the QR event code (SPEC §4.2). */
export const SlugSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/, "lowercase letters, digits and dashes; 1–40 chars");
export type Slug = z.infer<typeof SlugSchema>;

/**
 * Hot objects are split across shard maps because Sync's write limit
 * (20/s, 10 s burst) applies per Map, not per item (docs/decisions.md D-03).
 */
export const SHARDS = { dedup: 8, stats: 4 } as const;

export function shardOf(key: string, shards: number): number {
  return createHash("sha1").update(key).digest().readUInt32BE(0) % shards;
}

/** Global objects (SPEC §3.4, D-04). */
export const Global = {
  events: "events",
  bindings: "bindings",
  contentCache: "content_cache",
  profileLinks: "profile_links",
  shares: "shares",
  // TODO(scalability): every inbound message writes here; sharded by MessageSid.
  dedup: (messageSid: string) => `dedup_${shardOf(messageSid, SHARDS.dedup)}`,
  allDedup: () => Array.from({ length: SHARDS.dedup }, (_, i) => `dedup_${i}`),
} as const;

/** Per-event objects, all prefixed `ev_<slug>_` and deleted with the event (SPEC §4.4). */
export function eventObjects(slug: Slug) {
  const p = `ev_${SlugSchema.parse(slug).replaceAll("-", "_")}_`;
  const stats = (metric: string) => `${p}stats_${shardOf(metric, SHARDS.stats)}`;
  const allStats = () => Array.from({ length: SHARDS.stats }, (_, i) => `${p}stats_${i}`);
  return {
    prefix: p,
    sessions: `${p}sessions`,
    // TODO(scalability): expected hot spot; every job state change writes here (SPEC §3.4).
    jobs: `${p}jobs`,
    print: `${p}print`,
    printer: `${p}printer`,
    /** Public booth-screen state, pushed to the booth over the Sync SDK (D-17). */
    booth: `${p}booth`,
    leads: `${p}leads`,
    slideshow: `${p}slideshow`,
    // TODO(scalability): counters are the hottest per-event objects; sharded by metric name.
    stats,
    allStats,
    /** Every map of the event (the printer document is separate). */
    allMaps: () => [`${p}sessions`, `${p}jobs`, `${p}print`, `${p}leads`, `${p}slideshow`, ...allStats()],
  };
}

/** Session/lead/binding key for an attendee address (SPEC §3.4). */
export function addressKey(channel: "whatsapp" | "sms", address: string): string {
  return `${channel}:${address.replace(/^whatsapp:/, "")}`;
}
