import "server-only";
import { createAzureBlobStore } from "./blob/azure";
import type { BlobStore } from "./blob/store";
import { getEnv, requireEnv } from "./env";
import { log } from "./log";
import { SyncStore } from "./sync/store";
import { createTwilioSyncBackend } from "./sync/twilio-backend";

export interface Services {
  sync: SyncStore;
  blob: BlobStore;
}

let services: Services | undefined;

/**
 * Composition root for web and worker. These are stateless clients, not
 * application state (SPEC §1.2). Throws, naming the missing variables, if the
 * configuration is incomplete.
 */
export function getServices(): Services {
  if (services) return services;
  const env = requireEnv(getEnv(), [
    "TWILIO_ACCOUNT_SID",
    "TWILIO_API_KEY_SID",
    "TWILIO_API_KEY_SECRET",
    "TWILIO_SYNC_SERVICE_SID",
    "AZURE_STORAGE_CONNECTION_STRING",
  ]);
  const backend = createTwilioSyncBackend({
    accountSid: env.TWILIO_ACCOUNT_SID,
    apiKeySid: env.TWILIO_API_KEY_SID,
    apiKeySecret: env.TWILIO_API_KEY_SECRET,
    serviceSid: env.TWILIO_SYNC_SERVICE_SID,
  });
  services = {
    sync: new SyncStore(backend, log),
    blob: createAzureBlobStore(env.AZURE_STORAGE_CONNECTION_STRING, env.AZURE_STORAGE_CONTAINER),
  };
  return services;
}
