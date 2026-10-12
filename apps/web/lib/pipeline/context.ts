import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import { getEventRepo } from "../admin/context";
import type { PortraitEvent } from "../events/schema";
import { FIXED_FRAMES } from "../events/schema";
import { getEnv, requireEnv } from "../env";
import { type Job, JobSchema } from "../jobs/schema";
import { log } from "../log";
import { Messenger } from "../messaging/outbound";
import { getServices } from "../services";
import { eventObjects } from "../sync/names";
import { SKIP } from "../sync/store";
import { createTwilioMessagingApi } from "../twilio/messaging-api";
import { releaseInFlight, type WorkerDeps } from "./worker";

const FRAMES_DIR = path.join(import.meta.dirname, "../../assets/frames");

/** Fixed frames shipped in apps/web/assets/frames (SPEC §8.3). */
async function loadFixedFrame(id: string): Promise<Buffer | null> {
  if (id === "none" || !(FIXED_FRAMES as readonly string[]).includes(id)) return null;
  return readFile(path.join(FRAMES_DIR, `${id}.png`));
}

/** Vision models that do not accept reasoning effort "none" (verified 2026-10-12, docs/decisions.md D-14). */
const NO_EFFORT_NONE = /^gpt-6(\.\d+)?-(sol|astra)/;

export async function buildWorkerDeps(workerId: string): Promise<WorkerDeps> {
  const env = requireEnv(getEnv(), ["OPENAI_API_KEY", "OPENAI_VISION_MODEL", "TWILIO_ACCOUNT_SID", "TWILIO_API_KEY_SID", "TWILIO_API_KEY_SECRET", "TWILIO_MESSAGING_SERVICE_SID"]);
  const { sync, blob } = getServices();
  const messenger = new Messenger(
    createTwilioMessagingApi({ accountSid: env.TWILIO_ACCOUNT_SID, apiKeySid: env.TWILIO_API_KEY_SID, apiKeySecret: env.TWILIO_API_KEY_SECRET }),
    sync,
    env.TWILIO_MESSAGING_SERVICE_SID,
    log,
  );
  await messenger.init();
  return {
    sync,
    events: await getEventRepo(),
    messenger,
    // Retries are ours (SPEC §9.1): the SDK must not retry on its own.
    pipeline: {
      openai: new OpenAI({ apiKey: env.OPENAI_API_KEY, maxRetries: 0 }),
      blob,
      imageModel: env.OPENAI_IMAGE_MODEL,
      vision: { model: env.OPENAI_VISION_MODEL, effort: NO_EFFORT_NONE.test(env.OPENAI_VISION_MODEL) ? "low" : "none" },
      loadFixedFrame,
    },
    log,
    workerId,
    // TODO(milestone g): deliver the portrait (SPEC §6), count quota, enqueue print, ask slideshow consent.
    // Until then a passed job is marked delivered without sending, so the lease does not re-run it.
    onReady: async (event: PortraitEvent, job: Job) => {
      await sync.map(eventObjects(event.slug).jobs, JobSchema).update(job.jobId, (cur) =>
        cur?.state === "processing" ? { ...cur, state: "delivered", timestamps: { ...cur.timestamps, delivered: new Date().toISOString() } } : SKIP,
      );
      await releaseInFlight({ sync }, event, job.address);
      log.warn({ event: "delivery_not_implemented", slug: event.slug, jobId: job.jobId }, "portrait ready; delivery arrives in milestone g");
    },
  };
}
