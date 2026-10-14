import type OpenAI from "openai";
import sharp from "sharp";
import type { BlobStore } from "../blob/store";
import { BlobPaths } from "../blob/paths";
import type { PortraitEvent } from "../events/schema";
import { compositeOnBackground } from "../image/composite";
import { applyFrame, toDeliveryJpeg, toPrintPng } from "../image/frame";
import { frameClearance } from "../image/frame-clearance";
import type { Job } from "../jobs/schema";
import { buildPrompt } from "../prompts/build";
import { GenerationRefused, generatePortrait } from "./generate";
import { analyzeScene, detectFace, moderate, review, type VisionConfig } from "./vision";

/** How a job ended (SPEC §9.1). `ready` = passed review; delivery is milestone g. */
export type PipelineOutcome =
  | { kind: "ready"; outputBlobs: { printPng: string; deliveryJpeg: string }; subjects: number; prompt: string }
  | { kind: "flagged"; outputBlobs: { printPng: string; deliveryJpeg: string }; subjects: number; reason: string }
  | { kind: "rejected"; reason: "moderation" | "no_face" | "too_many_people" | "generation_refused" };

export interface PipelineDeps {
  openai: OpenAI;
  blob: BlobStore;
  imageModel: string;
  vision: VisionConfig;
  /** Loads a fixed frame from apps/web/assets/frames (null for `none`). */
  loadFixedFrame: (id: string) => Promise<Buffer | null>;
  signal?: AbortSignal;
}

const MAX_SUBJECTS = 4;

/** Result of screening a photo before the menus (SPEC §9.2 steps 1–3, D-18). */
export type ScreeningOutcome =
  | { kind: "passed"; subjects: number; pet: string | null }
  | { kind: "rejected"; reason: "moderation" | "no_face" | "too_many_people" };

async function loadSelfie(deps: Pick<PipelineDeps, "blob">, job: Job): Promise<Buffer> {
  const selfie = await deps.blob.get(job.selfieBlob);
  if (!selfie) throw new Error("Selfie blob missing");
  // Selfies were normalized on arrival (auto-rotated JPEG); re-encode defensively.
  return sharp(selfie).rotate().jpeg({ quality: 90 }).toBuffer();
}

/**
 * Safety checks right after the photo arrives, before any menu (D-18).
 * Fails closed: errors throw (the caller retries, then fails the job).
 */
export async function screenPhoto(deps: PipelineDeps, job: Job): Promise<ScreeningOutcome> {
  const jpeg = await loadSelfie(deps, job);
  // 2. Moderation.
  if (await moderate(deps.openai, jpeg)) return { kind: "rejected", reason: "moderation" };
  // 3. Face detection and scene analysis, in parallel.
  const [hasFace, scene] = await Promise.all([detectFace(deps.openai, deps.vision, jpeg), analyzeScene(deps.openai, deps.vision, jpeg)]);
  if (!hasFace || scene.subjects === 0) return { kind: "rejected", reason: "no_face" };
  if (scene.subjects > MAX_SUBJECTS) return { kind: "rejected", reason: "too_many_people" };
  return { kind: "passed", subjects: scene.subjects, pet: scene.pet };
}

/**
 * Generation for a screened job with chosen options (SPEC §9.2 steps 4–7).
 * Throws on transient or unparseable failures. Never passes a check by default.
 */
export async function runPipeline(deps: PipelineDeps, event: PortraitEvent, job: Job): Promise<PipelineOutcome> {
  if (!job.style || !job.background || job.subjects === null) throw new Error("Job is not screened or has no choices");
  const jpeg = await loadSelfie(deps, job);
  const scene = { subjects: job.subjects, pet: job.pet };

  // The frame is needed before generation now: the prompt keeps people clear of what it covers (D-27).
  const framePng =
    event.config.frame === "none"
      ? null
      : event.config.frame === "uploaded"
        ? await deps.blob.get(event.uploads.frame?.blobPath ?? "")
        : await deps.loadFixedFrame(event.config.frame);
  if (event.config.frame !== "none" && !framePng) throw new Error("Selected frame is missing");

  // 4. Prompt.
  const prompt = buildPrompt(job.style, job.background, scene, framePng ? await frameClearance(framePng) : undefined);

  // 5. Generate.
  const uploaded = job.background === "uploaded";
  let generated: Buffer;
  try {
    generated = await generatePortrait(deps.openai, { model: deps.imageModel, selfie: jpeg, prompt, transparent: uploaded, signal: deps.signal });
  } catch (err) {
    if (err instanceof GenerationRefused) return { kind: "rejected", reason: "generation_refused" };
    throw err;
  }

  // 6. Background, frame, resize.
  let image = generated;
  if (uploaded) {
    const bgPath = event.uploads.background?.blobPath;
    const bg = bgPath ? await deps.blob.get(bgPath) : null;
    if (!bg) throw new Error("Uploaded background is missing");
    image = await compositeOnBackground(generated, bg);
  }
  if (framePng) image = await applyFrame(image, framePng);

  const printPng = await toPrintPng(image);
  const deliveryJpeg = await toDeliveryJpeg(printPng);
  const outputBlobs = { printPng: BlobPaths.printPng(event.slug, job.jobId), deliveryJpeg: BlobPaths.deliveryJpeg(event.slug, job.jobId) };
  await Promise.all([
    deps.blob.put(outputBlobs.printPng, printPng, "image/png"),
    deps.blob.put(outputBlobs.deliveryJpeg, deliveryJpeg, "image/jpeg"),
  ]);

  // 7. AI review of the final (framed) output, with the selfie and the generation prompt.
  const verdict = await review(deps.openai, deps.vision, jpeg, deliveryJpeg, prompt);
  return verdict.pass
    ? { kind: "ready", outputBlobs, subjects: scene.subjects, prompt }
    : { kind: "flagged", outputBlobs, subjects: scene.subjects, reason: verdict.reason };
}
