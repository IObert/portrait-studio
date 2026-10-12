import { createHmac } from "node:crypto";
import twilio from "twilio";
import { describe, expect, it } from "vitest";
import { isValidTwilioSignature } from "@/lib/twilio/signature";

const token = "0123456789abcdef0123456789abcdef";
const base = "https://booth.example.com";
const params = { MessageSid: "SM" + "1".repeat(32), From: "whatsapp:+447700900123", Body: "Hi #ev" };

/** Twilio's documented algorithm: HMAC-SHA1 of URL + sorted key/value pairs, base64. */
function sign(url: string, p: Record<string, string>) {
  const data = url + Object.keys(p).sort().map((k) => k + p[k]).join("");
  return createHmac("sha1", token).update(Buffer.from(data, "utf-8")).digest("base64");
}

describe("Twilio signature validation (SPEC §5.1)", () => {
  it("accepts a correctly signed request against PUBLIC_BASE_URL", () => {
    const signature = sign(`${base}/api/twilio/inbound`, params);
    expect(signature).toBe(twilio.getExpectedTwilioSignature(token, `${base}/api/twilio/inbound`, params));
    expect(isValidTwilioSignature({ authToken: token, publicBaseUrl: base, pathAndQuery: "/api/twilio/inbound", signature, params })).toBe(true);
  });

  it("validates against the public URL, not the internal host", () => {
    // Signed for the public origin; the app sees an internal Host behind ingress.
    const signature = sign(`${base}/api/twilio/inbound`, params);
    expect(isValidTwilioSignature({ authToken: token, publicBaseUrl: "http://10.0.0.5:3000", pathAndQuery: "/api/twilio/inbound", signature, params })).toBe(false);
    expect(isValidTwilioSignature({ authToken: token, publicBaseUrl: base, pathAndQuery: "/api/twilio/inbound", signature, params })).toBe(true);
  });

  it("rejects tampered params, a missing signature and a wrong token", () => {
    const signature = sign(`${base}/api/twilio/inbound`, params);
    const v = (o: Partial<Parameters<typeof isValidTwilioSignature>[0]>) =>
      isValidTwilioSignature({ authToken: token, publicBaseUrl: base, pathAndQuery: "/api/twilio/inbound", signature, params, ...o });
    expect(v({ params: { ...params, Body: "Hi #other" } })).toBe(false);
    expect(v({ signature: null })).toBe(false);
    expect(v({ authToken: "f".repeat(32) })).toBe(false);
  });
});
