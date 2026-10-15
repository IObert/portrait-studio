/**
 * Regenerates the style thumbnails in public/previews/styles from one selfie,
 * with the production prompt (style + gradient background + one person) and model,
 * so the admin's style picker shows what attendees actually get. Run:
 *   pnpm --filter web previews:styles --input <selfie.jpg>
 * One image call per style. The selfie stays where it is; only the thumbnails are written.
 */
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import OpenAI from "openai";
import sharp from "sharp";
import { loadRootEnv } from "../lib/load-env";
import { generatePortrait } from "../lib/pipeline/generate";
import { buildPrompt } from "../lib/prompts/build";
import { STYLE_IDS } from "../lib/prompts/styles";

loadRootEnv();

const { values } = parseArgs({ options: { input: { type: "string" }, only: { type: "string" } } });
if (!values.input) throw new Error("Pass --input <selfie.jpg>");
const model = process.env.OPENAI_IMAGE_MODEL;
if (!process.env.OPENAI_API_KEY || !model) throw new Error("OPENAI_API_KEY and OPENAI_IMAGE_MODEL must be set (repo-root .env.local)");

const out = path.join(process.cwd(), "public/previews/styles");
await mkdir(out, { recursive: true });
const selfie = await sharp(await readFile(values.input)).rotate().jpeg({ quality: 92 }).toBuffer();
const client = new OpenAI();
const styles = values.only ? STYLE_IDS.filter((s) => values.only!.split(",").includes(s)) : STYLE_IDS;

const results = await Promise.allSettled(
  styles.map(async (style) => {
    const png = await generatePortrait(client, { model, selfie, prompt: buildPrompt(style, "gradient", { subjects: 1, pet: null }), transparent: false });
    // 240×360 is twice the tile size: sharp on high-DPI screens, ~15 KB each.
    await sharp(png).resize(240, 360, { fit: "cover", position: "top" }).webp({ quality: 80 }).toFile(path.join(out, `${style}.webp`));
    return style;
  }),
);
for (const [i, r] of results.entries()) console.log(styles[i], r.status === "fulfilled" ? "ok" : `FAILED: ${(r.reason as Error).message}`);
if (results.some((r) => r.status === "rejected")) process.exitCode = 1;
