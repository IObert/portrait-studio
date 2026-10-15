import { describe, expect, it, vi } from "vitest";
import { liveEnv } from "./env";

/**
 * Print-agent token scope against real Twilio Sync (PROTOCOL.md §2, SPEC §11.2).
 * Opt-in: RUN_LIVE_SYNC_TESTS=1; never in CI.
 */
const live = process.env.RUN_LIVE_SYNC_TESTS === "1";

describe.skipIf(!live)("print agent token (real Sync)", () => {
  it("reads and writes only its own print queue and printer status", async () => {
    const env = liveEnv(["TWILIO_ACCOUNT_SID", "TWILIO_API_KEY_SID", "TWILIO_API_KEY_SECRET", "TWILIO_SYNC_SERVICE_SID"]);
    Object.assign(process.env, env);
    const { SyncClient } = await import("twilio-sync");
    const { SyncStore } = await import("@/lib/sync/store");
    const { createTwilioSyncBackend } = await import("@/lib/sync/twilio-backend");
    const { EventRepo } = await import("@/lib/events/repo");
    const { defaultConfig } = await import("@/lib/events/schema");
    const { generatePrinterToken } = await import("@/lib/auth/printer-token");
    const { exchangePrinterToken } = await import("@/lib/agent/token");
    const { eventObjects } = await import("@/lib/sync/names");

    const sync = new SyncStore(createTwilioSyncBackend({ accountSid: env.TWILIO_ACCOUNT_SID!, apiKeySid: env.TWILIO_API_KEY_SID!, apiKeySecret: env.TWILIO_API_KEY_SECRET! , serviceSid: env.TWILIO_SYNC_SERVICE_SID! }), { warn: vi.fn() });
    const events = new EventRepo(sync);
    await events.init();
    const slug = `live-${Date.now().toString(36)}`;
    const ev = eventObjects(slug);
    await events.create(slug, { ...defaultConfig("Agent token test", "+13203780782"), printingEnabled: true });
    const { token: printerToken, hash } = generatePrinterToken(slug);
    await events.setPrinterToken(slug, printerToken, hash);
    let client: InstanceType<typeof SyncClient> | undefined;
    try {
      // A rotated or wrong printer token is refused.
      const { token: other } = generatePrinterToken(slug);
      expect(await exchangePrinterToken({ sync, events }, other)).toEqual({ ok: false, status: 401 });
      expect(await exchangePrinterToken({ sync, events }, "nonsense")).toEqual({ ok: false, status: 401 });

      const r = await exchangePrinterToken({ sync, events }, printerToken);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      client = new SyncClient(r.token);

      // Its own objects: readable and writable.
      const queue = await client.map({ id: r.objects.print, mode: "open_existing" });
      await queue.set("job_live_0001", { jobId: "job_live_0001", blobPath: "p.png", who: "x", state: "queued", attempts: 0, leaseUntil: null, error: null, timestamps: {} });
      const doc = await client.document({ id: r.objects.printer, mode: "open_existing" });
      await doc.set({ status: "idle", heartbeatAt: new Date().toISOString() });

      // Everything else is denied (54007), including other events' data.
      for (const other of ["events", ev.sessions, ev.jobs, ev.leads, ev.slideshow]) {
        await sync.ensureMap(other);
        await expect(client.map({ id: other, mode: "open_existing" }), other).rejects.toMatchObject({ code: 54007 });
      }
      // The booth document must exist, so the failure is a denial and not "not found".
      await sync.raw.putDocument(ev.booth, { state: "live" });
      await expect(client.document({ id: ev.booth, mode: "open_existing" })).rejects.toMatchObject({ code: 54007 });
    } finally {
      await client?.shutdown();
      for (const m of ev.allMaps()) await sync.deleteMap(m);
      await sync.deleteDocument(ev.printer);
      await sync.deleteDocument(ev.booth);
      await events.remove(slug);
    }
  }, 90_000);
});
