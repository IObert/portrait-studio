import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { loadRootEnv } from "@/lib/load-env";
import { SyncError, SyncErrorCode } from "@/lib/sync/errors";
import { SyncStore } from "@/lib/sync/store";
import { createTwilioSyncBackend } from "@/lib/sync/twilio-backend";

// Runs against a real Sync Service: RUN_LIVE_SYNC_TESTS=1 with Twilio credentials
// in .env.local. Uses a throwaway map that is deleted afterwards.
loadRootEnv();
const live = process.env.RUN_LIVE_SYNC_TESTS === "1";

describe.skipIf(!live)("Twilio Sync (live)", () => {
  it("supports If-Match updates, conditional create and the documented error codes", async () => {
    // Built inside the test: describe bodies run even when the suite is skipped.
    const backend = createTwilioSyncBackend({
      accountSid: process.env.TWILIO_ACCOUNT_SID!,
      apiKeySid: process.env.TWILIO_API_KEY_SID!,
      apiKeySecret: process.env.TWILIO_API_KEY_SECRET!,
      serviceSid: process.env.TWILIO_SYNC_SERVICE_SID!,
    });
    const store = new SyncStore(backend, { warn: vi.fn() });
    const name = `test_${randomUUID().slice(0, 8)}`;
    const map = store.map(name, z.object({ n: z.number() }));
    await store.ensureMap(name);
    await store.ensureMap(name); // idempotent
    try {
      expect(await map.create("k", { n: 1 })).toBe(true);
      expect(await map.create("k", { n: 2 })).toBe(false); // 54208

      const v = await map.getVersioned("k");
      await backend.updateItem(name, "k", { n: 5 }, { ifMatch: v!.revision });
      const stale = await backend.updateItem(name, "k", { n: 6 }, { ifMatch: v!.revision }).catch((e: SyncError) => e);
      expect(stale).toBeInstanceOf(SyncError);
      expect((stale as SyncError).code).toBe(SyncErrorCode.mapItemRevisionMismatch);

      await Promise.all(Array.from({ length: 5 }, () => map.update("k", (c) => ({ n: (c?.n ?? 0) + 1 }))));
      expect(await map.get("k")).toEqual({ n: 10 });
      expect(await map.get("missing")).toBeNull();

      const keys: string[] = [];
      for await (const [k] of map.entries()) keys.push(k);
      expect(keys).toEqual(["k"]);
    } finally {
      await store.deleteMap(name);
    }
  }, 60_000);
});
