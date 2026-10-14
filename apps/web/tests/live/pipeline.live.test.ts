import { readFileSync } from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { defaultConfig, type PortraitEvent } from "@/lib/events/schema";
import { type Job, JobSchema } from "@/lib/jobs/schema";
import { runPipeline } from "@/lib/pipeline/run";
import { FakeBlob } from "../support/fake-blob";
import { liveEnv } from "./env";

/**
 * Full pipeline against the real OpenAI API with the uploaded background
 * (SPEC §8.2, §16). Opt-in: RUN_LIVE_AI_TESTS=1. Costs ~$0.20. Uses a local
 * spike selfie from .local/ (git-ignored; never committed).
 */
const live = process.env.RUN_LIVE_AI_TESTS === "1";
const SELFIE = path.join(import.meta.dirname, "../../../../.local/spike-inputs/1-person.jpg");
const OUT = path.join(import.meta.dirname, "../../../../.local/pipeline-live");

describe.skipIf(!live)("pipeline (live AI)", () => {
  it("moderates, analyses, generates transparent, composites, frames and reviews", async () => {
    const env = liveEnv(["OPENAI_API_KEY"]);
    const blob = new FakeBlob();
    const selfie = await sharp(readFileSync(SELFIE)).rotate().jpeg({ quality: 90 }).toBuffer();
    await blob.put("events/ev/selfies/s.jpg", selfie, "image/jpeg");
    // A busy uploaded background makes compositing errors obvious.
    const bg = await sharp(Buffer.from(`<svg width="1024" height="1536" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="#f6bd60"/><stop offset="1" stop-color="#2a6f97"/></linearGradient></defs><rect width="1024" height="1536" fill="url(#g)"/></svg>`)).jpeg().toBuffer();
    await blob.put("assets/events/ev/background.jpg", bg, "image/jpeg");

    const event: PortraitEvent = {
      slug: "ev",
      state: "live",
      config: { ...defaultConfig("Live pipeline", "+13203780782"), backgrounds: ["uploaded"], uploadedBackgroundName: "Stage", frame: "twilio-tab-bottom" },
      uploads: { frame: null, background: { blobPath: "assets/events/ev/background.jpg", contentType: "image/jpeg", width: 1024, height: 1536, uploadedAt: new Date().toISOString() } },
      printerTokenHash: null,
      printerTokenCreatedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const job: Job = JobSchema.parse({ jobId: "live_job_1", address: "whatsapp:+10000000000", channel: "whatsapp", style: "cartoon", background: "uploaded", selfieBlob: "events/ev/selfies/s.jpg", shareId: "s".repeat(24), state: "processing", timestamps: {} });

    const t0 = performance.now();
    const outcome = await runPipeline(
      {
        openai: new OpenAI({ apiKey: env.OPENAI_API_KEY, maxRetries: 0 }),
        blob,
        imageModel: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2.5-flare",
        vision: { model: process.env.OPENAI_VISION_MODEL ?? "gpt-6.1-sol", effort: "low" },
        loadFixedFrame: async (id) => readFileSync(path.join(import.meta.dirname, `../../assets/frames/${id}.png`)),
      },
      event,
      job,
    );
    const seconds = (performance.now() - t0) / 1000;
    console.log(`pipeline: ${outcome.kind} in ${seconds.toFixed(1)}s`, outcome.kind === "flagged" ? outcome.reason : "");
    expect(["ready", "flagged"]).toContain(outcome.kind);
    if (outcome.kind === "rejected") return;

    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(OUT, { recursive: true });
    writeFileSync(path.join(OUT, "print.png"), (await blob.get(outcome.outputBlobs.printPng))!);
    writeFileSync(path.join(OUT, "delivery.jpg"), (await blob.get(outcome.outputBlobs.deliveryJpeg))!);
    const meta = await sharp((await blob.get(outcome.outputBlobs.printPng))!).metadata();
    expect([meta.width, meta.height, meta.density]).toEqual([1200, 1800, 300]);
  }, 300_000);
});
