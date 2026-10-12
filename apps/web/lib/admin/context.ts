import "server-only";
import { cleanupHooks } from "../events/cleanup";
import type { DeleteHooks } from "../events/delete";
import { EventRepo } from "../events/repo";
import { getEnv, requireEnv } from "../env";
import { getServices } from "../services";
import { createMemoryClient } from "../twilio/memory";

let events: EventRepo | undefined;
let ready: Promise<void> | undefined;

/** Event repository bound to the shared Sync store; the `events` map is created on first use. */
export async function getEventRepo(): Promise<EventRepo> {
  events ??= new EventRepo(getServices().sync);
  ready ??= events.init().catch((err) => {
    ready = undefined;
    throw err;
  });
  await ready;
  return events;
}

/** Bindings and Conversation Memory clean-up for delete and End (SPEC §4.1, §4.4). */
export function getDeleteHooks(): DeleteHooks {
  // e2e mode: no Memory credentials; the in-memory Memory client stands in (test only).
  if (process.env.PORTRAIT_E2E_FAKE_SYNC === "1") {
    return cleanupHooks(getServices().sync, { lookup: async () => null, upsert: async () => "mem_profile_e2e", erase: async () => {} });
  }
  const env = requireEnv(getEnv(), ["TWILIO_API_KEY_SID", "TWILIO_API_KEY_SECRET", "TWILIO_MEMORY_STORE_ID"]);
  const memory = createMemoryClient({ storeId: env.TWILIO_MEMORY_STORE_ID, username: env.TWILIO_API_KEY_SID, password: env.TWILIO_API_KEY_SECRET });
  return cleanupHooks(getServices().sync, memory);
}
