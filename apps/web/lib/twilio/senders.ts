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
 * WhatsApp needs an ONLINE WhatsApp sender for the number, either a pool number
 * or a WhatsApp channel sender attached to the service (D-10). RCS has no QR link of its own: it is an
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
  // A WhatsApp sender added to the service is a channel sender, not a pool number.
  const poolWa = pool.senders.map((s) => s.sender).filter((s) => s.startsWith("whatsapp:")).map((s) => s.replace(/^whatsapp:/, ""));
  const byNumber = new Map<string, Sender[]>();
  for (const n of numbers) {
    const list: Sender[] = [];
    if ((n.capabilities ?? []).map(String).includes("SMS")) list.push({ e164: n.phoneNumber, channel: "sms", ...(rcs ? { rcs: true } : {}) });
    byNumber.set(n.phoneNumber, list);
  }
  for (const e164 of new Set([...numbers.map((n) => n.phoneNumber), ...poolWa])) {
    if (!onlineWa.has(e164) || !(byNumber.has(e164) || poolWa.includes(e164))) continue;
    byNumber.set(e164, [{ e164, channel: "whatsapp" }, ...(byNumber.get(e164) ?? [])]);
  }
  return [...byNumber.keys()].sort().flatMap((k) => byNumber.get(k)!);
}
