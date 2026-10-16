import { afterEach, describe, expect, it, vi } from "vitest";

const phoneNumbers = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("@/lib/twilio/client", () => ({
  twilioClient: () => ({ messaging: { v1: { services: () => ({ phoneNumbers: { list: phoneNumbers } }) } } }),
}));

const cfg = { accountSid: "AC" + "1".repeat(32), apiKeySid: "SK" + "1".repeat(32), apiKeySecret: "s", messagingServiceSid: "MG" + "1".repeat(32) };

function stubFetch(wa: { sender_id: string; status: string }[], pool: { sender: string; sender_type: string }[]) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.includes("Channel=whatsapp") ? { senders: wa } : { senders: pool })));
}

describe("QR senders (D-37)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("one entry per number and channel: WhatsApp when it is an online sender, SMS when the number can text", async () => {
    phoneNumbers.mockResolvedValue([
      { phoneNumber: "+13203780782", capabilities: ["SMS", "MMS", "Voice"] },
      { phoneNumber: "+14155550100", capabilities: ["Voice"] },
    ]);
    stubFetch([{ sender_id: "whatsapp:+13203780782", status: "ONLINE" }, { sender_id: "whatsapp:+14155550100", status: "OFFLINE" }], []);
    const { listSenders } = await import("@/lib/twilio/senders");
    expect(await listSenders(cfg)).toEqual([
      { e164: "+13203780782", channel: "whatsapp" },
      { e164: "+13203780782", channel: "sms" },
    ]);
  });

  it("a WhatsApp sender attached to the service lists even when its number is not in the pool", async () => {
    phoneNumbers.mockResolvedValue([{ phoneNumber: "+13203780782", capabilities: ["SMS"] }]);
    stubFetch(
      [{ sender_id: "whatsapp:+13203780782", status: "ONLINE" }, { sender_id: "whatsapp:+14155550100", status: "ONLINE" }, { sender_id: "whatsapp:+14155550199", status: "ONLINE" }],
      [{ sender: "whatsapp:+14155550100", sender_type: "WhatsApp" }],
    );
    const { listSenders } = await import("@/lib/twilio/senders");
    expect(await listSenders(cfg)).toEqual([
      { e164: "+13203780782", channel: "whatsapp" },
      { e164: "+13203780782", channel: "sms" },
      { e164: "+14155550100", channel: "whatsapp" },
    ]);
  });

  it("an RCS sender in the service marks the SMS entries", async () => {
    phoneNumbers.mockResolvedValue([{ phoneNumber: "+13203780782", capabilities: ["SMS"] }]);
    stubFetch([], [{ sender: "rcs:brand_agent", sender_type: "RCS" }]);
    const { listSenders } = await import("@/lib/twilio/senders");
    expect(await listSenders(cfg)).toEqual([{ e164: "+13203780782", channel: "sms", rcs: true }]);
  });

  it("a failing Senders API still lists the SMS numbers", async () => {
    phoneNumbers.mockResolvedValue([{ phoneNumber: "+13203780782", capabilities: ["SMS"] }]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    const { listSenders } = await import("@/lib/twilio/senders");
    expect(await listSenders(cfg)).toEqual([{ e164: "+13203780782", channel: "sms" }]);
  });
});
