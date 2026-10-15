import type OpenAI from "openai";
import { toFile } from "openai";

/** The image API refused the request for safety reasons: the job is rejected permanently (SPEC §9.2 step 5). */
export class GenerationRefused extends Error {
  constructor(readonly stage: string | undefined) {
    super(`Image generation refused by moderation${stage ? ` (${stage})` : ""}`);
    this.name = "GenerationRefused";
  }
}

/** A reference image sent after the selfie (D-36); the prompt refers to it by name. */
export interface RefImage {
  name: string;
  png: Buffer;
}

/**
 * images.edit (SPEC §9.2 step 5): one model (OPENAI_IMAGE_MODEL, no fallback,
 * D-01), 1024×1536, high quality, PNG. The selfie goes first, then any
 * reference images in order (brand_ref_N.png, then bg_ref_N.png, D-36).
 * Transparent background only for the event's uploaded background (§8.2).
 * No input_fidelity: gpt-image-2.5-flare rejects it (400, checked live).
 */
export async function generatePortrait(
  client: OpenAI,
  opts: { model: string; selfie: Buffer; refs?: readonly RefImage[]; prompt: string; transparent: boolean; signal?: AbortSignal },
): Promise<Buffer> {
  try {
    const res = await client.images.edit(
      {
        model: opts.model,
        image: opts.refs?.length
          ? [await toFile(opts.selfie, "selfie.jpg", { type: "image/jpeg" }), ...(await Promise.all(opts.refs.map((r) => toFile(r.png, r.name, { type: "image/png" }))))]
          : await toFile(opts.selfie, "selfie.jpg", { type: "image/jpeg" }),
        prompt: opts.prompt,
        size: "1024x1536",
        quality: "high",
        output_format: "png",
        ...(opts.transparent ? { background: "transparent" as const } : {}),
      },
      { signal: opts.signal, timeout: 240_000 },
    );
    const b64 = res.data?.[0]?.b64_json;
    if (!b64) throw new Error("Image API returned no image");
    return Buffer.from(b64, "base64");
  } catch (err) {
    const e = err as { code?: string; error?: { moderation_details?: { moderation_stage?: string } } };
    if (e.code === "moderation_blocked") throw new GenerationRefused(e.error?.moderation_details?.moderation_stage);
    throw err;
  }
}
