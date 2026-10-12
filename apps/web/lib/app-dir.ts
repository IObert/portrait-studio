import { existsSync } from "node:fs";
import path from "node:path";

/**
 * The apps/web directory. Do not use `import.meta.dirname` in server code:
 * Next.js bundles it to `undefined`, which crashes on import (it broke every
 * admin review action). Both web and worker run with apps/web as the working
 * directory (Next always does; worker/start.sh cd's there). Resolved lazily.
 */
export function appDir(): string {
  const cwd = process.cwd();
  // Running from the repo root (e.g. `pnpm --filter web …` scripts that keep the root cwd).
  const nested = path.join(cwd, "apps/web");
  return existsSync(path.join(nested, "package.json")) && !existsSync(path.join(cwd, "next.config.ts")) ? nested : cwd;
}

export function repoRoot(): string {
  return path.resolve(appDir(), "../..");
}
