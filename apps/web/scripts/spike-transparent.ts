/**
 * gpt-image-2 transparency spike (SPEC §8.2). Run:
 *   pnpm --filter web spike:transparent [--style cartoon] [--inputs dir] [--out dir]
 *
 * For every selfie in the inputs folder it calls images.edit with
 * background "transparent", checks the alpha channel, and composites the result
 * over a dark and a light background for visual inspection. It never falls back
 * to another model or to background removal: a failure is reported, not fixed.
 *
 * Selfies are personal data: keep inputs and outputs under the git-ignored .local/.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import { loadRootEnv } from "../lib/load-env";
import { analyzeTransparency, type TransparencyReport } from "../lib/image/alpha";
import { compositeOnBackground, solidBackground } from "../lib/image/composite";
import { BACKGROUND_EXACT } from "../lib/prompts/defaults";
import { finalReminder, sceneLine } from "../lib/prompts/scene";
import { STYLE_IDS, stylePrompt, type StyleId } from "../lib/prompts/styles";

loadRootEnv();

const repoRoot = path.join(import.meta.dirname, "../../..");
const { values } = parseArgs({
  options: {
    style: { type: "string", default: "cartoon" },
    inputs: { type: "string", default: path.join(repoRoot, ".local/spike-inputs") },
    out: { type: "string", default: path.join(repoRoot, ".local/spike-output") },
    model: { type: "string" },
  },
});

const style = values.style as StyleId;
if (!STYLE_IDS.includes(style)) throw new Error(`Unknown style ${style}`);
const model = values.model ?? process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2";
if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set (put it in the repo-root .env)");

const THRESHOLD_TRANSPARENT = 0.2;

/** Filenames encode subject count: "1-person*.jpg", "3-people*.jpg". */
function subjectsFromName(file: string): number {
  const m = /^(\d+)-/.exec(file);
  if (!m) throw new Error(`Cannot read subject count from ${file}; name it like 3-people.jpg`);
  return Number(m[1]);
}

function buildPrompt(subjects: number): string {
  const scene = { subjects, pet: null };
  return [stylePrompt(style), sceneLine(scene), BACKGROUND_EXACT, finalReminder(scene)].join("\n");
}

interface Result {
  file: string;
  subjects: number;
  seconds: number;
  ok: boolean;
  error?: string;
  report?: TransparencyReport;
  failedChecks?: string[];
}

const client = new OpenAI({ maxRetries: 2, timeout: 240_000 });
const files = (await readdir(values.inputs)).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
if (files.length === 0) throw new Error(`No images in ${values.inputs}`);
await mkdir(values.out, { recursive: true });

const dark = await solidBackground("#111418");
const light = await solidBackground("#f4f1ea");
// A busy test background makes halos and fringes easy to spot.
const busy = await sharp({
  create: { width: 1024, height: 1536, channels: 3, background: "#2a6f97" },
})
  .composite([
    {
      input: Buffer.from(
        `<svg width="1024" height="1536"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6bd60"/><stop offset="1" stop-color="#84a59d"/></linearGradient></defs><rect width="1024" height="1536" fill="url(#g)"/></svg>`,
      ),
    },
  ])
  .png()
  .toBuffer();

console.log(`Spike: model=${model} style=${style} images=${files.length}\n`);

// Run in parallel: each call can take up to ~2 minutes.
const results: Result[] = await Promise.all(
  files.map(async (file): Promise<Result> => {
    const subjects = subjectsFromName(file);
    const base = path.parse(file).name.replace(/[^a-z0-9-]+/gi, "_");
    // Normalize like the pipeline will (SPEC §9.2): auto-rotate, re-encode JPEG.
    const selfie = await sharp(await readFile(path.join(values.inputs, file))).rotate().jpeg({ quality: 90 }).toBuffer();
    const started = performance.now();
    try {
      const res = await client.images.edit({
        model,
        image: await toFile(selfie, "selfie.jpg", { type: "image/jpeg" }),
        prompt: buildPrompt(subjects),
        size: "1024x1536",
        quality: "high",
        output_format: "png",
        background: "transparent",
      });
      const seconds = (performance.now() - started) / 1000;
      const b64 = res.data?.[0]?.b64_json;
      if (!b64) return { file, subjects, seconds, ok: false, error: "No image in response" };
      const png = Buffer.from(b64, "base64");
      await writeFile(path.join(values.out, `${base}.raw.png`), png);

      const report = await analyzeTransparency(png);
      const failedChecks: string[] = [];
      if (!report.hasAlpha) failedChecks.push("no alpha channel");
      if (report.fullyTransparent < THRESHOLD_TRANSPARENT)
        failedChecks.push(`only ${(report.fullyTransparent * 100).toFixed(1)}% fully transparent`);
      if (report.checkerboardSuspected) failedChecks.push("checkerboard drawn into image");
      else if (report.opaqueBorder > 0.5) failedChecks.push("opaque fill around the subject");

      for (const [name, bg] of [["dark", dark], ["light", light], ["busy", busy]] as const) {
        await writeFile(path.join(values.out, `${base}.on-${name}.png`), await compositeOnBackground(png, bg));
      }
      return { file, subjects, seconds, ok: failedChecks.length === 0, report, failedChecks };
    } catch (err) {
      const seconds = (performance.now() - started) / 1000;
      const e = err as { status?: number; code?: string; message?: string };
      return { file, subjects, seconds, ok: false, error: `${e.status ?? ""} ${e.code ?? ""} ${e.message ?? String(err)}`.trim() };
    }
  }),
);

for (const r of results) {
  const pct = (n = 0) => `${(n * 100).toFixed(1)}%`;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.file}  (${r.subjects} subj, ${r.seconds.toFixed(1)}s)`);
  if (r.error) console.log(`      error: ${r.error}`);
  if (r.report)
    console.log(
      `      alpha=${r.report.hasAlpha} transparent=${pct(r.report.fullyTransparent)} soft-edge=${pct(r.report.partiallyTransparent)} opaque-border=${pct(r.report.opaqueBorder)}`,
    );
  if (r.failedChecks?.length) console.log(`      failed: ${r.failedChecks.join("; ")}`);
}
await writeFile(path.join(values.out, "report.json"), JSON.stringify({ model, style, results }, null, 2));
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed automated checks. Hair edges need a visual check: ${values.out}`);
process.exitCode = passed === results.length ? 0 : 1;
