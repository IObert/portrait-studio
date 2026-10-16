/**
 * `pnpm --filter web setup:twilio [--dry-run] [--take-over-inbound] [--name "Portrait Studio"]
 *   [--public-base-url https://<deployed host>]` (SPEC §15).
 *
 * Finds or creates the Sync Service, Verify Service and Memory store, points
 * the Messaging Service's inbound URL at this app, creates and submits the
 * WhatsApp delivery templates, then prints the environment values and the
 * steps only the Console can do. Safe to run again: see lib/setup/twilio.ts.
 * Run it again after WhatsApp approves the templates to get their SIDs.
 *
 * `--public-base-url` overrides PUBLIC_BASE_URL: in development `.env.local`
 * wins over the shell and usually points at a tunnel, but the templates and
 * inbound URL must name the deployed host.
 */
export {};

const { parseArgs } = await import("node:util");
const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    "take-over-inbound": { type: "boolean", default: false },
    name: { type: "string", default: "Portrait Studio" },
    "public-base-url": { type: "string" },
  },
  strict: true,
});

const { loadRootEnv } = await import("../lib/load-env");
loadRootEnv();
const { getEnv, requireEnv } = await import("../lib/env");
const { runSetup, SetupError } = await import("../lib/setup/twilio");
const { createTwilioSetupApi } = await import("../lib/setup/twilio-api");

const env = requireEnv(getEnv(), ["TWILIO_ACCOUNT_SID", "TWILIO_API_KEY_SID", "TWILIO_API_KEY_SECRET"]);
const api = createTwilioSetupApi({ accountSid: env.TWILIO_ACCOUNT_SID, apiKeySid: env.TWILIO_API_KEY_SID, apiKeySecret: env.TWILIO_API_KEY_SECRET });

console.log(`Twilio account ${env.TWILIO_ACCOUNT_SID.slice(0, 8)}…${values["dry-run"] ? " (dry run: nothing is changed)" : ""}\n`);
try {
  const report = await runSetup(api, {
    name: values.name,
    env: {
      TWILIO_SYNC_SERVICE_SID: env.TWILIO_SYNC_SERVICE_SID,
      TWILIO_VERIFY_SERVICE_SID: env.TWILIO_VERIFY_SERVICE_SID,
      TWILIO_MEMORY_STORE_ID: env.TWILIO_MEMORY_STORE_ID,
      TWILIO_MESSAGING_SERVICE_SID: env.TWILIO_MESSAGING_SERVICE_SID,
      TWILIO_TEMPLATE_DELIVERY_EN: env.TWILIO_TEMPLATE_DELIVERY_EN,
      TWILIO_TEMPLATE_DELIVERY_PT_BR: env.TWILIO_TEMPLATE_DELIVERY_PT_BR,
    },
    publicBaseUrl: values["public-base-url"] ?? env.PUBLIC_BASE_URL,
    dryRun: values["dry-run"],
    takeOverInbound: values["take-over-inbound"],
  });
  const section = (title: string, lines: string[]) => lines.length && console.log(`${title}\n${lines.map((l) => `  - ${l}`).join("\n")}\n`);
  section("Already set up", report.ok);
  section(values["dry-run"] ? "Would change" : "Changed", report.changes);
  section("Still to do by hand", report.manual);
  const lines = Object.entries(report.env).map(([k, v]) => `${k}=${v}`);
  if (lines.length) console.log(`Environment (.env.local, and the deploy's secrets):\n${lines.join("\n")}`);
  process.exit(0);
} catch (err) {
  console.error(err instanceof SetupError ? `Stopped: ${err.message}` : err);
  process.exit(1);
}
