import "server-only";
import { twilioClient } from "./client";

export type QrChannel = "whatsapp" | "sms";

/** One way to reach the booth: a number on one channel (D-37). */
export interface Sender {
  e164: string;
  channel: QrChannel;
  /** SMS only: the service also has an RCS sender, so replies may arrive as RCS (Twilio falls back to SMS). */
  rcs?: boolean;
}

/**
 * QR choices (SPEC §4.2, D-37): every number in the Messaging Service
 * (TWILIO_MESSAGING_SERVICE_SID), once per channel it can be messaged on.
 * WhatsApp needs an ONLINE WhatsApp sender for the number (WhatsApp senders
 * are not linked to services in the Senders API, so the service's number
 * pool is the source of truth; D-10). RCS has no QR link of its own: it is an
 * agent, not a number, so it is shown as a badge on the SMS entries.
 */
export async function listSenders(cfg: { accountSid: string; apiKeySid: string; apiKeySecret: string; messagingServiceSid: string }): Promise<Sender[]> {
  const client = twilioClient(cfg);
  const auth = "Basic " + Buffer.from(`${cfg.apiKeySid}:${cfg.apiKeySecret}`).toString("base64");
  const json = <T>(url: string, empty: T) =>
    fetch(url, { headers: { authorization: auth }, signal: AbortSignal.timeout(10_000) }).then((r) => (r.ok ? (r.json() as Promise<T>) : empty)).catch(() => empty);
  const [numbers, wa, pool] = await Promise.all([
    client.messaging.v1.services(cfg.messagingServiceSid).phoneNumbers.list({ limit: 100 }),
    json<{ senders: { sender_id: string; status: string }[] }>("https://messaging.twilio.com/v2/Channels/Senders?Channel=whatsapp&PageSize=100", { senders: [] }),
    json<{ senders: { sender: string; sender_type: string }[] }>(
      `https://messaging.twilio.com/v1/Services/${encodeURIComponent(cfg.messagingServiceSid)}/ChannelSenders?PageSize=100`,
      { senders: [] },
    ),
  ]);
  const onlineWa = new Set(wa.senders.filter((s) => s.status === "ONLINE").map((s) => s.sender_id.replace(/^whatsapp:/, "")));
  const rcs = pool.senders.some((s) => /rcs/i.test(s.sender_type) || s.sender.startsWith("rcs:"));
  const out: Sender[] = [];
  for (const n of [...numbers].sort((a, b) => a.phoneNumber.localeCompare(b.phoneNumber))) {
    if (onlineWa.has(n.phoneNumber)) out.push({ e164: n.phoneNumber, channel: "whatsapp" });
    if ((n.capabilities ?? []).map(String).includes("SMS")) out.push({ e164: n.phoneNumber, channel: "sms", ...(rcs ? { rcs: true } : {}) });
  }
  return out;
}
