import "server-only";
import { twilioClient } from "./client";

export interface Sender {
  e164: string;
  sms: boolean;
  whatsapp: boolean;
}

/**
 * Senders available for the QR code (SPEC §4.2): the Messaging Service's phone
 * numbers, flagged as WhatsApp when they are an ONLINE WhatsApp sender.
 * (WhatsApp senders are not linked to services in the Senders API, so the
 * service's number pool is the source of truth; docs/decisions.md D-10.)
 */
export async function listSenders(cfg: { accountSid: string; apiKeySid: string; apiKeySecret: string; messagingServiceSid: string }): Promise<Sender[]> {
  const client = twilioClient(cfg);
  const auth = "Basic " + Buffer.from(`${cfg.apiKeySid}:${cfg.apiKeySecret}`).toString("base64");
  const [numbers, wa] = await Promise.all([
    client.messaging.v1.services(cfg.messagingServiceSid).phoneNumbers.list({ limit: 100 }),
    fetch("https://messaging.twilio.com/v2/Channels/Senders?Channel=whatsapp&PageSize=100", { headers: { authorization: auth }, signal: AbortSignal.timeout(10_000) })
      .then((r) => (r.ok ? (r.json() as Promise<{ senders: { sender_id: string; status: string }[] }>) : { senders: [] })),
  ]);
  const onlineWa = new Set(wa.senders.filter((s) => s.status === "ONLINE").map((s) => s.sender_id.replace(/^whatsapp:/, "")));
  return numbers
    .map((n) => ({ e164: n.phoneNumber, sms: (n.capabilities ?? []).map(String).includes("SMS"), whatsapp: onlineWa.has(n.phoneNumber) }))
    .sort((a, b) => a.e164.localeCompare(b.e164));
}
