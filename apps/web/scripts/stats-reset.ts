/**
 * `pnpm --filter web stats:reset --event <slug>` (SPEC §10.5): zeroes the
 * event's counters and records lastResetAt. The run is logged. Counters hold
 * no personal data, so nothing else is touched.
 */
export {};

const { parseArgs } = await import("node:util");
const { values } = parseArgs({ options: { event: { type: "string" } }, strict: true });

const { loadRootEnv } = await import("../lib/load-env");
loadRootEnv();
const { getServices } = await import("../lib/services");
const { EventRepo } = await import("../lib/events/repo");
const { SlugSchema } = await import("../lib/sync/names");
const { resetStats } = await import("../lib/stats");
const { log } = await import("../lib/log");

const slug = SlugSchema.safeParse(values.event);
if (!slug.success) {
  console.error("Usage: pnpm --filter web stats:reset --event <slug>");
  process.exit(2);
}
const { sync } = getServices();
const event = await new EventRepo(sync).get(slug.data);
if (!event) {
  console.error(`No event "${slug.data}".`);
  process.exit(1);
}
const cleared = await resetStats(sync, slug.data);
log.info({ event: "stats_reset", slug: slug.data, counters: cleared }, "stats reset");
console.log(`Reset ${cleared} counters for "${event.config.name}" (${slug.data}).`);
process.exit(0);
