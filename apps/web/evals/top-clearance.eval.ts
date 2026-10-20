import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import sharp from "sharp";
import { LA_KINGS } from "../lib/brands/la-kings";
import type { BackgroundId } from "../lib/events/schema";
import { generatePortrait, type RefImage } from "../lib/pipeline/generate";
import { buildPrompt } from "../lib/prompts/build";
import { bgRefName, brandRefName } from "../lib/prompts/brand";
import type { StyleId } from "../lib/prompts/styles";
import { calibrationImages, judgeTopBand, markTopBand, type Verdict } from "./top-clearance";
import { evalEnv } from "./env";

/**
 * Eval: does a generated portrait keep the top 10% free? (docs/decisions.md D-40)
 *
 *   pnpm --filter @portrait-studio/web eval:top-clearance            # calibrate the judge, then 12 images (~$3)
 *   pnpm --filter @portrait-studio/web eval:top-clearance --dry-run  # print the plan and the cost, spend nothing
 *   pnpm --filter @portrait-studio/web eval:top-clearance --calibrate-only
 *
 * Calls the real OpenAI API with the real prompt builder. Not part of `pnpm test`.
 * Needs OPENAI_API_KEY in .env.local and the spike photos in .local/spike-inputs/.
 */
const ROOT = path.join(import.meta.dirname, "../../..");
const INPUTS = path.join(ROOT, ".local/spike-inputs");
const OUT = path.join(ROOT, ".local/eval-top-clearance");

const PEOPLE = [
  { id: "1-person", file: "1-person.jpg", subjects: 1 },
  { id: "3-people", file: "3-people.jpg", subjects: 3 },
] as const;
const BACKGROUNDS = ["original", "crypto-arena", "uploaded"] as const satisfies readonly BackgroundId[];
const STYLES = ["cartoon", "watercolor"] as const satisfies readonly StyleId[];
/** Rough cost of one 1024x1536 high-quality generation plus one judge call. */
const COST_PER_IMAGE_USD = 0.25;

interface Case {
  name: string;
  people: (typeof PEOPLE)[number];
  background: (typeof BACKGROUNDS)[number];
  style: StyleId;
}
const CASES: Case[] = PEOPLE.flatMap((people) =>
  BACKGROUNDS.flatMap((background) => STYLES.map((style) => ({ name: `${people.id}/${background}/${style}`, people, background, style }))),
);

const args = new Set(process.argv.slice(2));

async function main() {
  console.log(`${CASES.length} images, about $${(CASES.length * COST_PER_IMAGE_USD).toFixed(2)}`);
  if (args.has("--dry-run")) {
    for (const c of CASES) console.log("  " + c.name);
    return;
  }
  const env = evalEnv(["OPENAI_API_KEY"]);
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY, maxRetries: 1, timeout: 240_000 });
  const vision = { model: process.env.OPENAI_VISION_MODEL ?? "gpt-6.1-sol", effort: "low" } as const;
  const model = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2.5-flare";
  mkdirSync(OUT, { recursive: true });

  // 1. The judge must tell a head in the band from a clear one, or its verdicts mean nothing.
  const cal = await calibrationImages();
  const [inBand, clear] = await Promise.all([judgeTopBand(client, vision, cal.headInBand), judgeTopBand(client, vision, cal.clear)]);
  writeFileSync(path.join(OUT, "calibration-head-in-band.jpg"), await markTopBand(cal.headInBand));
  writeFileSync(path.join(OUT, "calibration-clear.jpg"), await markTopBand(cal.clear));
  console.log(`judge calibration: head in the band -> ${inBand.pass ? "PASS (WRONG)" : "FAIL (right)"}, clear -> ${clear.pass ? "PASS (right)" : "FAIL (WRONG)"}`);
  if (inBand.pass || !clear.pass) {
    console.error("The judge cannot tell these apart; fix the judge before trusting any result. Nothing was generated.");
    process.exitCode = 2;
    return;
  }
  if (args.has("--calibrate-only")) return;

  // 2. Generate with the real prompt, judge the top band.
  const results: { c: Case; verdict: Verdict | { error: string } }[] = [];
  for (const c of CASES) {
    try {
      const selfie = await sharp(readFileSync(path.join(INPUTS, c.people.file))).rotate().jpeg({ quality: 90 }).toBuffer();
      const uploaded = c.background === "uploaded";
      const arena = c.background === "crypto-arena";
      const refs: RefImage[] = arena
        ? [
            ...LA_KINGS.refs.map((f, i) => ({ name: brandRefName(i), png: readFileSync(path.join(import.meta.dirname, "../assets", LA_KINGS.key, f)) })),
            { name: bgRefName(0), png: readFileSync(path.join(import.meta.dirname, "../assets", LA_KINGS.key, LA_KINGS.scenes["crypto-arena"]!.ref)) },
          ]
        : [];
      // No frame: the rule is "every portrait, always", so it must hold with nothing in the prompt about a frame.
      const prompt = buildPrompt(c.style, c.background, { subjects: c.people.subjects, pet: null }, undefined, arena ? LA_KINGS : undefined);
      const png = await generatePortrait(client, { model, selfie, refs, prompt, transparent: uploaded });
      // The uploaded path draws the person on transparency, then composites. Judge what a guest would see.
      const seen = uploaded ? await sharp({ create: { width: 1024, height: 1536, channels: 3, background: "#7aa6c2" } }).composite([{ input: png }]).png().toBuffer() : png;
      const verdict = await judgeTopBand(client, vision, seen);
      writeFileSync(path.join(OUT, `${c.name.replaceAll("/", "_")}.${verdict.pass ? "pass" : "FAIL"}.jpg`), await markTopBand(seen));
      results.push({ c, verdict });
    } catch (err) {
      results.push({ c, verdict: { error: (err as Error).message.slice(0, 120) } });
    }
    const last = results.at(-1)!;
    console.log(`  ${last.c.name.padEnd(38)} ${"error" in last.verdict ? "ERROR " + last.verdict.error : last.verdict.pass ? "pass" : "FAIL " + last.verdict.reason}`);
  }

  const judged = results.filter((r) => !("error" in r.verdict));
  const failed = judged.filter((r) => "pass" in r.verdict && !r.verdict.pass);
  console.log(`\n${failed.length}/${judged.length} portraits reach into the top 10%` + (judged.length < results.length ? ` (${results.length - judged.length} errored, not counted)` : ""));
  console.log(`marked images: ${OUT}`);
  const byBackground = (bg: string) => judged.filter((r) => r.c.background === bg);
  for (const bg of BACKGROUNDS) {
    const rows = byBackground(bg);
    console.log(`  ${bg.padEnd(14)} ${rows.filter((r) => "pass" in r.verdict && !r.verdict.pass).length}/${rows.length} fail`);
  }
  process.exitCode = failed.length ? 1 : 0;
}

await main();
