import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import { getEventRepo } from "../admin/context";
import { appDir } from "../app-dir";
import type { PortraitEvent } from "../events/schema";
import { FIXED_FRAMES } from "../events/schema";
import { getEnv, requireEnv } from "../env";
import type { Job } from "../jobs/schema";
import { log } from "../log";
import { Messenger } from "../messaging/outbound";
import { getServices } from "../services";
import type { SyncStore } from "../sync/store";
import { createTwilioMessagingApi } from "../twilio/messaging-api";
import { deliver, type DeliveryDeps } from "../delivery/deliver";
import { signMedia } from "../media-token";
import { addressFromKey, type WorkerDeps } from "./worker";

/** Fixed frames shipped in apps/web/assets/frames (SPEC §8.3). */
async function loadFixedFrame(id: string): Promise<Buffer | null> {
  if (id === "none" || !(FIXED_FRAMES as readonly string[]).includes(id)) return null;
  return readFile(path.join(appDir(), "assets/frames", `${id}.png`));
}

/** Brand reference images, shipped in apps/web/assets/<brand key>/ (D-36). Only known file names. */
async function loadBrandAsset(brandKey: string, file: string): Promise<Buffer> {
  if (!/^[a-z0-9-]+$/.test(brandKey) || !/^[A-Za-z0-9._-]+\.png$/.test(file)) throw new Error("Invalid brand asset");
  return readFile(path.join(appDir(), "assets", brandKey, file));
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
  const delivery = deliveryDeps(sync, messenger);
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
      loadBrandAsset,
    },
    log,
    workerId,
    // Passed review: deliver (SPEC §6).
    onReady: async (event: PortraitEvent, job: Job) => {
      const address = addressFromKey(job.address);
      if (!address) throw new Error("Job has an invalid address");
      await deliver(delivery, event, job, address);
    },
  };
}

/** Delivery wiring shared by the worker and admin approval (SPEC §6, §5.7). */
export function deliveryDeps(sync: SyncStore, messenger: Messenger): DeliveryDeps {
  const env = requireEnv(getEnv(), ["PUBLIC_BASE_URL", "MEDIA_SIGNING_SECRET"]);
  return {
    sync,
    messenger,
    publicBaseUrl: env.PUBLIC_BASE_URL,
    mediaUrl: (blobPath, ttl) => new URL(`/m/${signMedia(env.MEDIA_SIGNING_SECRET, blobPath, ttl)}`, env.PUBLIC_BASE_URL).toString(),
    templates: { en: env.TWILIO_TEMPLATE_DELIVERY_EN, pt_BR: env.TWILIO_TEMPLATE_DELIVERY_PT_BR },
    log,
  };
}
