import { readdirSync } from "node:fs";
import path from "node:path";
import { checkFrame, SAFE_ZONE_PX } from "./frame-safe-zone";

/**
 * Eval: do the frames keep their logos and text inside the printer's safe zone? (docs/decisions.md D-41)
 *
 *   pnpm --filter @portrait-studio/web eval:frame-safe-zone                 # every frame in assets/frames/
 *   pnpm --filter @portrait-studio/web eval:frame-safe-zone path/to/a.png   # just these files
 *
 * Pure image analysis: no API calls, no cost, exits 1 if any frame fails. Not part of `pnpm test`.
 */
const FRAMES = path.join(import.meta.dirname, "../assets/frames");
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(FRAMES).filter((f) => f.endsWith(".png")).sort().map((f) => path.join(FRAMES, f));

let failed = 0;
for (const file of files) {
  const r = await checkFrame(file);
  const name = path.basename(file);
  const problems: string[] = [];
  if (r.width !== 1200 || r.height !== 1800) problems.push(`size ${r.width}x${r.height}, expected 1200x1800`);
  for (const v of r.violations) {
    problems.push(
      `content at x ${v.x0}-${v.x1}, y ${v.y0}-${v.y1} is ${Math.min(v.left, v.top, v.right, v.bottom)} px from an edge ` +
        `(left ${v.left}, top ${v.top}, right ${v.right}, bottom ${v.bottom})`,
    );
  }
  if (problems.length) failed++;
  const nearest = Number.isFinite(r.minDistance) ? `nearest content ${r.minDistance} px` : "no inner content";
  console.log(`${problems.length ? "FAIL" : "PASS"}  ${name}  (${nearest}, need ${SAFE_ZONE_PX})`);
  for (const p of problems) console.log(`      ${p}`);
}
console.log(`\n${files.length - failed} of ${files.length} frames pass`);
process.exit(failed ? 1 : 0);
