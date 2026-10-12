import { parsePhoneNumberFromString } from "libphonenumber-js/max";

export type Channel = "whatsapp" | "sms";

/** An attendee address as Twilio sends it, split into channel + E.164 number. */
export interface Address {
  channel: Channel;
  /** E.164, without the `whatsapp:` prefix. */
  e164: string;
}

/** Channel detection from the `whatsapp:` prefix (SPEC §5.1). */
export function parseAddress(raw: string): Address | null {
  const channel: Channel = raw.startsWith("whatsapp:") ? "whatsapp" : "sms";
  const e164 = raw.replace(/^whatsapp:/, "").trim();
  return /^\+[1-9]\d{6,14}$/.test(e164) ? { channel, e164 } : null;
}

/** Key for sessions, bindings and leads (SPEC §3.4). */
export function keyOf(a: Address): string {
  return `${a.channel}:${a.e164}`;
}

/** The `To` value for sending to this address. */
export function twilioAddress(a: Address): string {
  return a.channel === "whatsapp" ? `whatsapp:${a.e164}` : a.e164;
}

/** Masked for logs and print items: personal data is never logged in full. */
export function mask(a: Address): string {
  return `${a.channel}:${a.e164.slice(0, 3)}…${a.e164.slice(-2)}`;
}

/**
 * MMS is only used for US, CA and AU numbers (SPEC §6.1). libphonenumber
 * resolves the region, so +1 Caribbean numbers are not treated as US/CA.
 */
const MMS_REGIONS = new Set(["US", "CA", "AU"]);
export function supportsMms(e164: string): boolean {
  const n = parsePhoneNumberFromString(e164);
  return !!n?.country && MMS_REGIONS.has(n.country);
}
