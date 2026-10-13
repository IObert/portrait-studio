import "server-only";
import { twilioClient } from "./client";
import type { TwilioMessagingApi } from "../messaging/outbound";

/** Twilio implementation of the sender's API slice: Messages via the SDK, Content via REST JSON. */
export function createTwilioMessagingApi(cfg: { accountSid: string; apiKeySid: string; apiKeySecret: string }): TwilioMessagingApi {
  const client = twilioClient(cfg, { autoRetry: true, maxRetries: 3 });
  const auth = "Basic " + Buffer.from(`${cfg.apiKeySid}:${cfg.apiKeySecret}`).toString("base64");
  return {
    async createMessage(p) {
      const m = await client.messages.create(p);
      return { sid: m.sid };
    },
    async createContent(p) {
      const res = await fetch("https://content.twilio.com/v1/Content", {
        method: "POST",
        headers: { authorization: auth, "content-type": "application/json" },
        body: JSON.stringify(p),
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
      if (!res.ok || !body.sid) throw new Error(`Content create failed: ${res.status} ${body.code ?? ""} ${body.message ?? ""}`.trim());
      return { sid: body.sid };
    },
  };
}
