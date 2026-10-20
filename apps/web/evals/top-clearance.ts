import sharp from "sharp";
import type OpenAI from "openai";
import { ask, type VisionConfig } from "../lib/pipeline/vision";

/**
 * The top of every portrait stays free (docs/decisions.md D-40): a frame may
 * cover it, so no head, hair or face may reach into it. This is the judge for
 * the eval; `evals/top-clearance.eval.ts` generates the images.
 */

/** Fraction of the image height that must stay free at the top. */
export const TOP_FRACTION = 0.1;

/**
 * Draws the band the judge must look at: the top 10% is dimmed and a red line
 * marks its lower edge. A model answers far more reliably about a marked image
 * than when asked to imagine "the top 10%".
 */
export async function markTopBand(png: Buffer): Promise<Buffer> {
  const { width, height } = await sharp(png).metadata();
  if (!width || !height) throw new Error("Image has no size");
  const band = Math.round(height * TOP_FRACTION);
  const overlay = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect x="0" y="0" width="${width}" height="${band}" fill="rgb(255,0,0)" fill-opacity="0.25"/>` +
      `<rect x="0" y="${band - 2}" width="${width}" height="4" fill="rgb(255,0,0)"/></svg>`,
  );
  return sharp(png).flatten({ background: "#ffffff" }).composite([{ input: overlay }]).jpeg({ quality: 90 }).toBuffer();
}

export const JUDGE_PROMPT = `This portrait has a red-tinted band across the top, ending at a solid red line. A decorative frame may cover that band, so nothing important may be inside it.

Look only at what is inside the red band, above the red line. Does any person's head, hair, forehead, face, ears, a hat or raised hands reach into the band, or get cut off by the top edge of the image?
Background, sky, ceiling, lights and scenery inside the band are fine.

Reply with only PASS if the band holds nothing but background. Otherwise reply FAIL: followed by what reaches into the band.`;

export type Verdict = { pass: true } | { pass: false; reason: string };

export function parseVerdict(answer: string): Verdict {
  const t = answer.trim();
  if (/^PASS\b/i.test(t)) return { pass: true };
  const fail = /^FAIL\b\s*:?\s*([\s\S]*)$/i.exec(t);
  if (fail) return { pass: false, reason: (fail[1] || "no reason given").trim().slice(0, 300) };
  throw new Error(`Could not parse the judge's answer: ${JSON.stringify(t.slice(0, 80))}`);
}

/** Asks the vision model whether the top band of a generated image is free of people. */
export async function judgeTopBand(client: OpenAI, cfg: VisionConfig, png: Buffer): Promise<Verdict> {
  const marked = await markTopBand(png);
  return parseVerdict(await ask(client, cfg, [{ jpeg: marked, detail: "high" }], JUDGE_PROMPT));
}

/** Synthetic calibration images: a plain scene with one head inside the band, and one well below it. */
export async function calibrationImages(): Promise<{ headInBand: Buffer; clear: Buffer }> {
  const W = 1024;
  const H = 1536;
  const scene = (headCy: number) =>
    sharp(
      Buffer.from(
        `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">` +
          `<rect width="${W}" height="${H}" fill="#9ec5e8"/>` +
          `<ellipse cx="${W / 2}" cy="${headCy + 330}" rx="260" ry="330" fill="#2f4858"/>` + // shoulders / torso
          `<ellipse cx="${W / 2}" cy="${headCy}" rx="150" ry="190" fill="#e8b98f"/>` + // head
          `<ellipse cx="${W / 2}" cy="${headCy - 120}" rx="165" ry="95" fill="#3b2a1d"/>` + // hair
          `</svg>`,
      ),
    )
      .png()
      .toBuffer();
  return { headInBand: await scene(120), clear: await scene(560) };
}
