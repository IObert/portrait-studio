/**
 * `pnpm --filter web leads:export [--event <slug>] [--out <file>]` (SPEC §10.5,
 * user decision D-31: leads are never downloadable from the web app). Without
 * --event it lists the events and asks which one. Writes the CSV to the
 * gitignored `exports/` folder at the repo root (or --out), readable only by
 * the current user since it holds personal data; prints the path, never the
 * contents. The run is logged without personal data.
 */
export {};

const { parseArgs } = await import("node:util");
const { createInterface } = await import("node:readline/promises");
const { mkdir, writeFile } = await import("node:fs/promises");
const path = await import("node:path");

const { values } = parseArgs({ options: { event: { type: "string" }, out: { type: "string" } }, strict: true });

const { loadRootEnv } = await import("../lib/load-env");
loadRootEnv();
const { getEnv, requireEnv } = await import("../lib/env");
const { getServices } = await import("../lib/services");
const { EventRepo } = await import("../lib/events/repo");
const { leadsCsv } = await import("../lib/leads/csv");
const { createMemoryClient } = await import("../lib/twilio/memory");
const { log } = await import("../lib/log");
const { repoRoot } = await import("../lib/app-dir");

const { sync } = getServices();
const repo = new EventRepo(sync);
const events = (await repo.list()).sort((a, b) => a.config.name.localeCompare(b.config.name));
if (events.length === 0) {
  console.error("There are no events.");
  process.exit(1);
}

let slug = values.event;
if (!slug) {
  if (!process.stdin.isTTY) {
    console.error("Pass --event <slug> when not running in a terminal.");
    process.exit(2);
  }
  console.log("Which event?\n");
  events.forEach((e, i) => console.log(`  ${String(i + 1).padStart(2)}. ${e.config.name} (${e.slug}, ${e.state})`));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`\nNumber 1-${events.length}: `)).trim();
  rl.close();
  const picked = events[Number(answer) - 1];
  if (!/^\d+$/.test(answer) || !picked) {
    console.error(`"${answer}" is not one of the numbers above.`);
    process.exit(2);
  }
  slug = picked.slug;
}
const event = events.find((e) => e.slug === slug);
if (!event) {
  console.error(`No event "${slug}". Events: ${events.map((e) => e.slug).join(", ")}`);
  process.exit(1);
}

const env = requireEnv(getEnv(), ["TWILIO_API_KEY_SID", "TWILIO_API_KEY_SECRET", "TWILIO_MEMORY_STORE_ID"]);
const memory = createMemoryClient({ storeId: env.TWILIO_MEMORY_STORE_ID, username: env.TWILIO_API_KEY_SID, password: env.TWILIO_API_KEY_SECRET });
const csv = await leadsCsv({ sync, memory }, event.slug);
// Count rows: parse CSV lines, accounting for quoted cells that contain \r\n.
let rows = 0;
let inQuotes = false;
for (let i = 0; i < csv.length; i++) {
  if (csv[i] === '"' && (i === 0 || csv[i - 1] !== '"')) inQuotes = !inQuotes;
  if (!inQuotes && csv[i] === "\r" && csv[i + 1] === "\n") rows++;
}
rows--; // Subtract the final \r\n
// Default: <repo>/exports/, which is gitignored. --out is taken relative to where the command was run.
const exportsDir = path.join(repoRoot(), "exports");
const file = values.out
  ? path.resolve(process.env.INIT_CWD ?? process.cwd(), values.out)
  : path.join(exportsDir, `leads-${event.slug}-${new Date().toISOString().slice(0, 10)}.csv`);
if (!values.out) await mkdir(exportsDir, { recursive: true, mode: 0o700 });
// 0600 and never overwrite: an old export of someone's data is not silently replaced.
await writeFile(file, csv, { mode: 0o600, flag: "wx" }).catch((err: NodeJS.ErrnoException) => {
  console.error(err.code === "EEXIST" ? `${file} already exists. Pass --out <file> or move it first.` : err.message);
  process.exit(1);
});
log.info({ event: "leads_exported", slug: event.slug, rows }, "leads exported");
console.log(`Wrote ${rows} lead${rows === 1 ? "" : "s"} for "${event.config.name}" to ${file}`);
process.exit(0);
