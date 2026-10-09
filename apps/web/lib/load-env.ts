import path from "node:path";
import * as nextEnvModule from "@next/env";

// @next/env is CommonJS: Next's config loader exposes named exports, tsx's ESM
// interop only a default export. Accept either shape.
type NextEnv = typeof nextEnvModule;
const mod = nextEnvModule as NextEnv & { default?: NextEnv };
const nextEnv: NextEnv = typeof mod.loadEnvConfig === "function" ? mod : mod.default!;

/**
 * Loads the repo-root `.env.local` / `.env` for processes outside the Next.js
 * runtime (worker, scripts) and for `next dev`. Variables already set in the
 * environment (containers, CI) always win. No-op when no file exists.
 */
export function loadRootEnv(): void {
  const repoRoot = path.join(import.meta.dirname, "../../..");
  nextEnv.loadEnvConfig(repoRoot, process.env.NODE_ENV !== "production", { info: () => {}, error: console.error });
}
