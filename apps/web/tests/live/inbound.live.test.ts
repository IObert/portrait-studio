import twilio from "twilio";
import { describe, expect, it, vi } from "vitest";
import { EventRepo } from "@/lib/events/repo";
import { defaultConfig } from "@/lib/events/schema";
import { eventObjects, Global } from "@/lib/sync/names";
import { SyncStore } from "@/lib/sync/store";
import { createTwilioSyncBackend } from "@/lib/sync/twilio-backend";
import { liveEnv } from "./env";

/**
 * Local end-to-end run against real Twilio. Opt-in with RUN_LIVE_INBOUND_TESTS=1;
 * never in CI. Needs `pnpm dev` on LIVE_BASE (default http://localhost:3200)
 * using the same .env.local. It sends signed webhooks as if LIVE_TEST_PHONE
 * messaged the booth, so every reply is a real message to that phone. On
 * WhatsApp, message the booth number first to open the 24h window.
 * Only the webhook goes over HTTP; setup and checks use Sync directly.
 */
const live = process.env.RUN_LIVE_INBOUND_TESTS === "1";
const BASE = process.env.LIVE_BASE ?? "http://localhost:3200";
const BOOTH = "+13203780782";

describe.skipIf(!live)("inbound webhook (live, local only)", () => {
  it("runs a Case C conversation over real Twilio", async () => {
    const env = liveEnv(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_API_KEY_SID", "TWILIO_API_KEY_SECRET", "TWILIO_SYNC_SERVICE_SID", "PUBLIC_BASE_URL", "LIVE_TEST_PHONE", "LIVE_TEST_CHANNEL"]);
    const wa = env.LIVE_TEST_CHANNEL !== "sms";
    const from = wa ? `whatsapp:${env.LIVE_TEST_PHONE}` : env.LIVE_TEST_PHONE!;
    const key = wa ? `whatsapp:${env.LIVE_TEST_PHONE}` : `sms:${env.LIVE_TEST_PHONE}`;
    const sync = new SyncStore(
      createTwilioSyncBackend({ accountSid: env.TWILIO_ACCOUNT_SID!, apiKeySid: env.TWILIO_API_KEY_SID!, apiKeySecret: env.TWILIO_API_KEY_SECRET!, serviceSid: env.TWILIO_SYNC_SERVICE_SID! }),
      { warn: vi.fn() },
    );
    const events = new EventRepo(sync);
    await events.init();
    const slug = `live-${Date.now().toString(36)}`;
    let n = 0;

    async function send(body: string, extra: Record<string, string> = {}) {
      const params: Record<string, string> = {
        MessageSid: `SM${(Date.now() * 100 + n++).toString(16).padStart(32, "0")}`,
        AccountSid: env.TWILIO_ACCOUNT_SID!,
        From: from,
        To: wa ? `whatsapp:${BOOTH}` : BOOTH,
        Body: body,
        NumMedia: "0",
        ...extra,
      };
      const signature = twilio.getExpectedTwilioSignature(env.TWILIO_AUTH_TOKEN!, `${env.PUBLIC_BASE_URL}/api/twilio/inbound`, params);
      const res = await fetch(`${BASE}/api/twilio/inbound`, {
        method: "POST",
        headers: { "x-twilio-signature": signature, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params),
      });
      expect(res.status).toBe(200);
    }
    const session = async () => (await sync.raw.getItem(eventObjects(slug).sessions, key))?.data as { step: string; optedIn: boolean } | undefined;

    // Unsigned requests are refused.
    expect((await fetch(`${BASE}/api/twilio/inbound`, { method: "POST", body: new URLSearchParams({ From: from }) })).status).toBe(403);

    const started = new Date(Date.now() - 5_000);
    await events.create(slug, { ...defaultConfig("Portrait Studio live test", BOOTH), leadCollection: false });
    await events.setState(slug, "live");
    try {
      await send(`Hi! I want my AI portrait #${slug}`); // reply: consent prompt with an "I agree" button
      expect(await session()).toMatchObject({ step: "awaiting_agree", optedIn: false });
      await send("", { ButtonPayload: "ps:agree" }); // reply: "Send us a selfie…"
      expect(await session()).toMatchObject({ step: "ready", optedIn: true });
      expect(await sync.raw.getItem(Global.bindings, key)).toMatchObject({ data: { eventSlug: slug } });

      // Accepted is not delivered: check Twilio's view of the replies we just caused.
      const client = twilio(env.TWILIO_API_KEY_SID!, env.TWILIO_API_KEY_SECRET!, { accountSid: env.TWILIO_ACCOUNT_SID! });
      await new Promise((r) => setTimeout(r, 8000));
      const replies = (await client.messages.list({ to: from, dateSentAfter: started, limit: 10 })).filter((m) => m.direction.startsWith("outbound"));
      expect(replies.length).toBeGreaterThanOrEqual(2);
      for (const m of replies) expect({ status: m.status, error: m.errorCode }).toMatchObject({ status: expect.stringMatching(/^(sent|delivered|read)$/) });
    } finally {
      // Clean up the throwaway event and everything it created.
      for (const m of eventObjects(slug).allMaps()) await sync.deleteMap(m);
      await sync.raw.deleteItem(Global.bindings, key);
      await events.remove(slug);
    }
  }, 120_000);
});
