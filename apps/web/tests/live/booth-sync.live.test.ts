import { describe, expect, it, vi } from "vitest";
import { liveEnv } from "./env";

/**
 * Booth screen live updates over the Sync client SDK (D-17), against real
 * Twilio Sync. Opt-in: RUN_LIVE_SYNC_TESTS=1; never in CI. Checks the read-only
 * token's scope (ACLs) and that server changes are pushed.
 */
const live = process.env.RUN_LIVE_SYNC_TESTS === "1";

describe.skipIf(!live)("booth live updates (real Sync)", () => {
  it("reads only its own event, and receives pushes", async () => {
    const env = liveEnv(["TWILIO_ACCOUNT_SID", "TWILIO_API_KEY_SID", "TWILIO_API_KEY_SECRET", "TWILIO_SYNC_SERVICE_SID", "MEDIA_SIGNING_SECRET", "PUBLIC_BASE_URL"]);
    Object.assign(process.env, env);
    const { SyncClient } = await import("twilio-sync");
    const { SyncStore } = await import("@/lib/sync/store");
    const { createTwilioSyncBackend } = await import("@/lib/sync/twilio-backend");
    const { EventRepo } = await import("@/lib/events/repo");
    const { defaultConfig } = await import("@/lib/events/schema");
    const { BoothDocSchema, publishBooth } = await import("@/lib/booth/state");
    const { boothToken } = await import("@/lib/booth/token");
    const { eventObjects } = await import("@/lib/sync/names");

    const sync = new SyncStore(createTwilioSyncBackend({ accountSid: env.TWILIO_ACCOUNT_SID!, apiKeySid: env.TWILIO_API_KEY_SID!, apiKeySecret: env.TWILIO_API_KEY_SECRET!, serviceSid: env.TWILIO_SYNC_SERVICE_SID! }), { warn: vi.fn() });
    const events = new EventRepo(sync);
    await events.init();
    const slug = `live-${Date.now().toString(36)}`;
    const ev = eventObjects(slug);
    const event = await events.setState((await events.create(slug, defaultConfig("Booth live test", "+13203780782"))).slug, "live");
    let client: InstanceType<typeof SyncClient> | undefined;
    try {
      await publishBooth(sync, event);
      client = new SyncClient((await boothToken(sync, slug)).token);
      const doc = await client.document({ id: ev.booth, mode: "open_existing" });
      expect((doc.data as { state: string }).state).toBe("live");

      // Scope: the global events map (every event's config) exists and is denied.
      await expect(client.map({ id: "events", mode: "open_existing" })).rejects.toMatchObject({ code: 54007 });
      // Per-event data maps are never readable: denied, or not created yet (no traffic).
      for (const other of [ev.sessions, ev.jobs, ev.leads]) {
        await sync.ensureMap(other);
        await expect(client.map({ id: other, mode: "open_existing" }), other).rejects.toMatchObject({ code: 54007 });
      }

      // Push: a server-side change reaches the SDK without polling.
      const pushed = new Promise<string>((resolve) => doc.on("updated", (e: { data: { state: string } }) => resolve(e.data.state)));
      await sync.document(ev.booth, BoothDocSchema).put({ ...BoothDocSchema.parse(doc.data), state: "break" });
      expect(await Promise.race([pushed, new Promise((r) => setTimeout(() => r("TIMEOUT"), 10_000))])).toBe("break");

      const map = await client.map({ id: ev.slideshow, mode: "open_existing" });
      const added = new Promise<string>((resolve) => map.on("itemAdded", (e: { item: { key: string } }) => resolve(e.item.key)));
      await sync.raw.createItem(ev.slideshow, "job_live_0001", { blobPath: "events/x/generated/a.jpg", addedAt: new Date().toISOString(), url: "https://example.com/a.jpg" });
      expect(await Promise.race([added, new Promise((r) => setTimeout(() => r("TIMEOUT"), 10_000))])).toBe("job_live_0001");
    } finally {
      await client?.shutdown();
      for (const m of ev.allMaps()) await sync.deleteMap(m);
      await sync.deleteDocument(ev.booth);
      await events.remove(slug);
    }
  }, 60_000);
});
