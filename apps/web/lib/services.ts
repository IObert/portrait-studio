import "server-only";
import { createAzureBlobStore } from "./blob/azure";
import type { BlobStore } from "./blob/store";
import { getEnv, requireEnv } from "./env";
import { log } from "./log";
import { SyncStore } from "./sync/store";
import { createTwilioSyncBackend } from "./sync/twilio-backend";
import { FakeBlob } from "./testing/memory-blob";
import { FakeSync } from "./testing/memory-sync";

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
  if (process.env.PORTRAIT_E2E_FAKE_SYNC === "1") return (services = testServices());
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

/**
 * In-memory Sync and Blob for the Playwright suite only, so CI needs no Twilio
 * or Azure credentials. This holds state in process memory, which SPEC §1.2
 * forbids for the real app, so it requires an explicit opt-in and logs loudly.
 */
function testServices(): Services {
  if (process.env.NODE_ENV === "production" && process.env.PORTRAIT_E2E !== "1") {
    throw new Error("PORTRAIT_E2E_FAKE_SYNC is for tests only; set PORTRAIT_E2E=1 to run the e2e suite");
  }
  // Next.js loads instrumentation and routes as separate module graphs; keep one
  // shared in-memory store per process so the e2e seed is visible to pages.
  const g = globalThis as { __portraitE2eServices?: Services };
  if (!g.__portraitE2eServices) {
    log.warn({ event: "e2e_fake_backends" }, "USING IN-MEMORY SYNC AND BLOB (TEST ONLY)");
    g.__portraitE2eServices = { sync: new SyncStore(new FakeSync(), log), blob: new FakeBlob() };
  }
  return g.__portraitE2eServices;
}
