import twilio from "twilio";
import { describe, expect, it, vi } from "vitest";
import { EventRepo } from "@/lib/events/repo";
import { defaultConfig } from "@/lib/events/schema";
import { eventObjects, Global } from "@/lib/sync/names";
import { SyncStore } from "@/lib/sync/store";
import { createTwilioSyncBackend } from "@/lib/sync/twilio-backend";
import { liveEnv } from "./env";

/**
 * Full live run, local only (RUN_LIVE_DELIVERY_TESTS=1, needs ngrok + `pnpm dev`
 * on :3200 + `pnpm worker`). Replays a real inbound WhatsApp photo
 * (LIVE_SELFIE_MESSAGE_SID) to the webhook, so the selfie is fetched from
 * Twilio exactly as in production. The portrait is delivered to LIVE_TEST_PHONE.
 */
const live = process.env.RUN_LIVE_DELIVERY_TESTS === "1";
const BASE = process.env.LIVE_BASE ?? "http://localhost:3200";
const BOOTH = "+13203780782";

describe.skipIf(!live)("delivery (live, local only)", () => {
  it("generates and delivers a portrait from a real WhatsApp selfie", async () => {
    const env = liveEnv(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_API_KEY_SID", "TWILIO_API_KEY_SECRET", "TWILIO_SYNC_SERVICE_SID", "PUBLIC_BASE_URL", "LIVE_TEST_PHONE"]);
    const selfieSid = process.env.LIVE_SELFIE_MESSAGE_SID;
    if (!selfieSid) throw new Error("Set LIVE_SELFIE_MESSAGE_SID to an inbound WhatsApp message with a photo");
    const client = twilio(env.TWILIO_API_KEY_SID!, env.TWILIO_API_KEY_SECRET!, { accountSid: env.TWILIO_ACCOUNT_SID! });
    const media = await client.messages(selfieSid).media.list({ limit: 1 });
    expect(media).toHaveLength(1);
    const mediaUrl = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages/${selfieSid}/Media/${media[0]!.sid}`;

    const from = `whatsapp:${env.LIVE_TEST_PHONE}`;
    const key = from;
    const sync = new SyncStore(createTwilioSyncBackend({ accountSid: env.TWILIO_ACCOUNT_SID!, apiKeySid: env.TWILIO_API_KEY_SID!, apiKeySecret: env.TWILIO_API_KEY_SECRET!, serviceSid: env.TWILIO_SYNC_SERVICE_SID! }), { warn: vi.fn() });
    const events = new EventRepo(sync);
    await events.init();
    const slug = `live-${Date.now().toString(36)}`;
    let n = 0;
    async function send(body: string, extra: Record<string, string> = {}) {
      const params: Record<string, string> = { MessageSid: `SM${(Date.now() * 100 + n++).toString(16).padStart(32, "0")}`, AccountSid: env.TWILIO_ACCOUNT_SID!, From: from, To: `whatsapp:${BOOTH}`, Body: body, NumMedia: "0", ...extra };
      const signature = twilio.getExpectedTwilioSignature(env.TWILIO_AUTH_TOKEN!, `${env.PUBLIC_BASE_URL}/api/twilio/inbound`, params);
      const res = await fetch(`${BASE}/api/twilio/inbound`, { method: "POST", headers: { "x-twilio-signature": signature, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
      expect(res.status).toBe(200);
    }

    const started = new Date(Date.now() - 5_000);
    await events.create(slug, { ...defaultConfig("Portrait Studio live test", BOOTH), leadCollection: false, styles: ["cartoon"], backgrounds: ["gradient"], frame: "twilio-tab-bottom" });
    await events.setState(slug, "live");
    try {
      await send(`#${slug}`);
      await send("", { ButtonPayload: "ps:agree" });
      await send("", { NumMedia: "1", MediaUrl0: mediaUrl, MediaContentType0: media[0]!.contentType });

      // Wait for the worker: generation is ~20–30 s.
      let job: { state: string; shareId: string } | undefined;
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        for await (const it of sync.raw.listItems(eventObjects(slug).jobs)) job = it.data as typeof job;
        if (job && ["delivered", "flagged", "rejected", "failed"].includes(job.state)) break;
      }
      console.log("job ended:", job?.state);
      expect(job?.state).toBe("delivered");

      await new Promise((r) => setTimeout(r, 8000));
      const out = (await client.messages.list({ to: from, dateSentAfter: started, limit: 20 })).filter((m) => m.direction.startsWith("outbound"));
      const withImage = out.find((m) => Number(m.numMedia) > 0);
      console.log("replies:", out.map((m) => `${m.status}${Number(m.numMedia) ? " [image]" : ""}`).join(", "));
      expect(withImage, "portrait message").toBeDefined();
      expect(withImage!.status).toMatch(/^(sent|delivered|read)$/);
      const share = await fetch(`${env.PUBLIC_BASE_URL}/s/${job!.shareId}`);
      expect(share.status).toBe(200);
      expect(await share.text()).toContain("Portrait Studio live test");
    } finally {
      for (const m of [...eventObjects(slug).allMaps()]) await sync.deleteMap(m);
      await sync.raw.deleteItem(Global.bindings, key);
      // The share record and blobs expire after 7 days; the event is removed now.
      await events.remove(slug);
    }
  }, 300_000);
});
