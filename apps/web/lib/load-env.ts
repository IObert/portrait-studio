import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

const repoRoot = path.join(import.meta.dirname, "../../..");

/**
 * Loads the repo-root `.env.local` (or `.env`) for next dev, the worker and
 * scripts. In development the file wins over inherited shell variables: shell
 * profiles often export TWILIO_* for other projects, and silently using another
 * account is worse than an override. In production (containers) nothing is
 * loaded from disk; the platform's environment is the only source.
 */
export function loadRootEnv(): void {
  if (process.env.NODE_ENV === "production") return;
  const file = [".env.local", ".env"].map((f) => path.join(repoRoot, f)).find((f) => existsSync(f));
  if (!file) return;
  for (const [key, value] of Object.entries(parseEnv(readFileSync(file, "utf8")))) {
    if (value !== "") process.env[key] = value;
  }
}
