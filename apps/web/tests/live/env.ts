import { readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

/**
 * Live tests read credentials straight from the repo-root .env.local and let
 * them win over the shell: Next's loader skips .env.local when NODE_ENV=test,
 * and a shell profile may export TWILIO_* for a different account.
 */
export function liveEnv(keys: readonly string[]): Record<string, string> {
  const file = path.join(import.meta.dirname, "../../../../.env.local");
  const parsed = parseEnv(readFileSync(file, "utf8"));
  const out: Record<string, string> = {};
  const missing = keys.filter((k) => !parsed[k]);
  if (missing.length) throw new Error(`Missing in .env.local: ${missing.join(", ")}`);
  for (const k of keys) out[k] = parsed[k]!;
  return out;
}
