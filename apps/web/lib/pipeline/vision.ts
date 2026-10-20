import type OpenAI from "openai";
import { REVIEW_CRITERIA, reviewPrompt } from "../prompts/review";
import { FACE_DETECTION, SCENE_ANALYSIS } from "../prompts/vision";
import type { Scene } from "../prompts/scene";

/**
 * Safety and quality checks (SPEC §9.2). Every function here fails closed:
 * an API error or an answer we cannot parse throws, so the job is retried or
 * failed and never passed by default (SPEC §1.2).
 */

/** Model output that could not be parsed; retried like a transient error (SPEC §9.2 step 3). */
export class UnparseableAnswer extends Error {
  constructor(readonly check: string, answer: string) {
    // The answer is model text about the image, not personal data, but keep it short.
    super(`${check}: could not parse model answer ${JSON.stringify(answer.slice(0, 80))}`);
    this.name = "UnparseableAnswer";
  }
}

export interface VisionConfig {
  model: string;
  /** Lowest reasoning effort the model accepts ("none" is not supported by every model). */
  effort: "none" | "low";
}

const dataUrl = (jpeg: Buffer) => `data:image/jpeg;base64,${jpeg.toString("base64")}`;

export async function ask(client: OpenAI, cfg: VisionConfig, images: { jpeg: Buffer; detail: "low" | "high" }[], text: string): Promise<string> {
  const r = await client.responses.create({
    model: cfg.model,
    reasoning: { effort: cfg.effort },
    input: [
      {
        role: "user",
        content: [...images.map((i) => ({ type: "input_image" as const, image_url: dataUrl(i.jpeg), detail: i.detail })), { type: "input_text" as const, text }],
      },
    ],
  });
  return r.output_text.trim();
}

/** omni-moderation-latest on the image (SPEC §9.2 step 2). True = flagged. */
export async function moderate(client: OpenAI, jpeg: Buffer): Promise<boolean> {
  const r = await client.moderations.create({ model: "omni-moderation-latest", input: [{ type: "image_url", image_url: { url: dataUrl(jpeg) } }] });
  const result = r.results[0];
  if (!result) throw new UnparseableAnswer("moderation", "no result");
  return result.flagged;
}

/** PROMPTS.md §A1 at detail low. Only an unambiguous YES or NO is accepted. */
export async function detectFace(client: OpenAI, cfg: VisionConfig, jpeg: Buffer): Promise<boolean> {
  const answer = await ask(client, cfg, [{ jpeg, detail: "low" }], FACE_DETECTION);
  const word = answer.toUpperCase().replace(/[^A-Z]/g, "");
  if (word === "YES") return true;
  if (word === "NO") return false;
  throw new UnparseableAnswer("face", answer);
}

/**
 * PROMPTS.md §A2. Unlike V1 there is no fallback to "1 subject": an
 * unparseable answer throws (SPEC §9.2 step 3).
 */
export async function analyzeScene(client: OpenAI, cfg: VisionConfig, jpeg: Buffer): Promise<Scene> {
  const answer = await ask(client, cfg, [{ jpeg, detail: "high" }], SCENE_ANALYSIS);
  return parseScene(answer);
}

export function parseScene(answer: string): Scene {
  const subjects = /Subjects:\s*\[?\s*(\d+)/i.exec(answer);
  const pets = /Pets:\s*\[?\s*([^\]\n]+)/i.exec(answer);
  if (!subjects || !pets) throw new UnparseableAnswer("scene", answer);
  const n = Number(subjects[1]);
  if (!Number.isInteger(n) || n < 0 || n > 50) throw new UnparseableAnswer("scene", answer);
  const pet = pets[1]!.trim().replace(/\.$/, "").toLowerCase();
  return { subjects: n, pet: pet === "none" || pet === "" ? null : pet.slice(0, 30) };
}

export type ReviewResult = { pass: true } | { pass: false; reason: string };

/** PROMPTS.md §B1, all criteria that apply (no brand refs), with the generation prompt as context (SPEC §9.2 step 7). */
export async function review(client: OpenAI, cfg: VisionConfig, selfie: Buffer, output: Buffer, generationPrompt: string): Promise<ReviewResult> {
  const answer = await ask(
    client,
    cfg,
    [
      { jpeg: selfie, detail: "high" },
      { jpeg: output, detail: "high" },
    ],
    reviewPrompt(REVIEW_CRITERIA, generationPrompt),
  );
  return parseReview(answer);
}

export function parseReview(answer: string): ReviewResult {
  const t = answer.trim();
  if (/^-?\s*PASS\b/i.test(t)) return { pass: true };
  const fail = /^-?\s*FAIL\b\s*:?\s*([\s\S]*)$/i.exec(t);
  if (fail) return { pass: false, reason: (fail[1] || "no reason given").trim().slice(0, 1000) };
  throw new UnparseableAnswer("review", answer);
}
