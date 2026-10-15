import "server-only";
import { getEventRepo } from "../admin/context";
import { slideUrl } from "../booth/state";
import { getEnv, requireEnv } from "../env";
import OpenAI from "openai";
import { log } from "../log";
import { signMedia } from "../media-token";
import { Messenger } from "../messaging/outbound";
import { getServices } from "../services";
import { createTwilioMessagingApi } from "../twilio/messaging-api";
import { createMemoryClient } from "../twilio/memory";
import { createEmailVerifier } from "../twilio/verify";
import { type Deps, initInbound } from "./inbound";
import { twilioMediaFetch } from "./media";

let deps: Promise<Deps> | undefined;

/** Wires the inbound handler to real services. Clients only; no app state (SPEC §1.2). */
export function getInboundDeps(): Promise<Deps> {
  deps ??= build().catch((err) => {
    deps = undefined;
    throw err;
  });
  return deps;
}

async function build(): Promise<Deps> {
  const env = requireEnv(getEnv(), [
    "TWILIO_ACCOUNT_SID",
    "TWILIO_API_KEY_SID",
    "TWILIO_API_KEY_SECRET",
    "TWILIO_MESSAGING_SERVICE_SID",
    "TWILIO_VERIFY_SERVICE_SID",
    "TWILIO_MEMORY_STORE_ID",
    "PUBLIC_BASE_URL",
    "MEDIA_SIGNING_SECRET",
    "OPENAI_API_KEY",
  ]);
  const { sync, blob } = getServices();
  const creds = { accountSid: env.TWILIO_ACCOUNT_SID, apiKeySid: env.TWILIO_API_KEY_SID, apiKeySecret: env.TWILIO_API_KEY_SECRET };
  const messenger = new Messenger(createTwilioMessagingApi(creds), sync, env.TWILIO_MESSAGING_SERVICE_SID, log);
  await Promise.all([messenger.init(), initInbound(sync)]);
  return {
    sync,
    blob,
    events: await getEventRepo(),
    messenger,
    memory: createMemoryClient({ storeId: env.TWILIO_MEMORY_STORE_ID, username: creds.apiKeySid, password: creds.apiKeySecret }),
    verifier: createEmailVerifier({ ...creds, serviceSid: env.TWILIO_VERIFY_SERVICE_SID }),
    fetchMedia: twilioMediaFetch(creds.apiKeySid, creds.apiKeySecret),
    publicBaseUrl: env.PUBLIC_BASE_URL,
    slideUrl,
    // 10 s: a tool call measured 6.6 s live. Twilio waits 15 s; a slow answer falls back to the selfie prompt.
    chat: { client: new OpenAI({ apiKey: env.OPENAI_API_KEY, maxRetries: 0, timeout: 10_000 }), model: env.OPENAI_CHAT_MODEL },
    mediaUrl: (blobPath, ttl) => new URL(`/m/${signMedia(env.MEDIA_SIGNING_SECRET, blobPath, ttl)}`, env.PUBLIC_BASE_URL).toString(),
    log,
  };
}
