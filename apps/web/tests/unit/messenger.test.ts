import { describe, expect, it, vi } from "vitest";
import { contentDefinition, insideWindow, Messenger, type TwilioMessagingApi } from "@/lib/messaging/outbound";
import { parseAddress, supportsMms } from "@/lib/messaging/address";
import { SyncStore } from "@/lib/sync/store";
import { FakeSync } from "../support/fake-sync";

const now = new Date("2026-10-10T12:00:00Z");
const recent = "2026-10-10T11:00:00Z";
const stale = "2026-10-09T11:00:00Z";

async function setup() {
  const api = {
    createMessage: vi.fn(async () => ({ sid: "SM" + "1".repeat(32) })),
    createContent: vi.fn(async () => ({ sid: "HX" + "a".repeat(32) })),
  } satisfies TwilioMessagingApi;
  const log = { info: vi.fn(), warn: vi.fn() };
  const sync = new SyncStore(new FakeSync(), log, { baseDelayMs: 1, maxDelayMs: 2 });
  const m = new Messenger(api, sync, "MG" + "0".repeat(32), log, () => now);
  await m.init();
  return { api, log, m };
}
const wa = parseAddress("whatsapp:+447700900123")!;
const sms = parseAddress("+447700900123")!;
const buttons = { kind: "buttons" as const, body: "Tap I agree", buttons: [{ id: "agree", title: "I agree" }], smsBody: "Reply AGREE" };

describe("Messenger", () => {
  it("sends text through the Messaging Service", async () => {
    const { api, m } = await setup();
    await m.send(wa, { kind: "text", body: "hi" }, { lastInboundAt: recent, locale: "en" });
    expect(api.createMessage).toHaveBeenCalledWith({ to: "whatsapp:+447700900123", messagingServiceSid: expect.stringMatching(/^MG/), body: "hi" });
  });

  it("names the booth number as From on WhatsApp, but lets the service pick for SMS", async () => {
    const { api, m } = await setup();
    await m.send(wa, { kind: "text", body: "hi" }, { lastInboundAt: recent, locale: "en", from: "+13203780782" });
    expect(api.createMessage).toHaveBeenLastCalledWith(expect.objectContaining({ from: "whatsapp:+13203780782" }));
    await m.send(sms, { kind: "text", body: "hi" }, { lastInboundAt: null, locale: "en", from: "+13203780782" });
    expect(api.createMessage).toHaveBeenLastCalledWith(expect.not.objectContaining({ from: expect.anything() }));
  });

  it("skips and logs WhatsApp free-form outside the 24h window (SPEC §5.11)", async () => {
    const { api, log, m } = await setup();
    expect(await m.send(wa, { kind: "text", body: "hi" }, { lastInboundAt: stale, locale: "en" })).toEqual({ status: "skipped", reason: "outside-24h-window" });
    expect(api.createMessage).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ event: "send_skipped", to: "whatsapp:+44…23" }), expect.any(String));
  });

  it("sends SMS regardless of the WhatsApp window, as the text fallback", async () => {
    const { api, m } = await setup();
    await m.send(sms, buttons, { lastInboundAt: null, locale: "en" });
    expect(api.createMessage).toHaveBeenCalledWith(expect.objectContaining({ to: "+447700900123", body: "Reply AGREE" }));
    expect(api.createContent).not.toHaveBeenCalled();
  });

  it("creates a runtime Content template once and reuses it from the cache", async () => {
    const { api, m } = await setup();
    await m.send(wa, buttons, { lastInboundAt: recent, locale: "en" });
    await m.send(wa, buttons, { lastInboundAt: recent, locale: "en" });
    expect(api.createContent).toHaveBeenCalledTimes(1);
    expect(api.createMessage).toHaveBeenLastCalledWith(expect.objectContaining({ contentSid: "HX" + "a".repeat(32) }));
    await m.send(wa, buttons, { lastInboundAt: recent, locale: "pt_BR" });
    expect(api.createContent).toHaveBeenCalledTimes(2); // different language, different template
  });
});

describe("contentDefinition", () => {
  it("pairs interactive types with a twilio/text fallback and enforces limits", () => {
    expect(contentDefinition(buttons)).toEqual({
      "twilio/text": { body: "Reply AGREE" },
      "twilio/quick-reply": { body: "Tap I agree", actions: [{ id: "agree", title: "I agree" }] },
    });
    const list = { kind: "list" as const, body: "Pick", button: "Choose", smsBody: "1. A", items: [{ id: "a", title: "A".repeat(30) }] };
    expect((contentDefinition(list)["twilio/list-picker"] as { items: { item: string }[] }).items[0]!.item).toHaveLength(24);
    expect(() => contentDefinition({ ...buttons, buttons: Array.from({ length: 4 }, (_, i) => ({ id: `${i}`, title: "x" })) })).toThrow(/3 buttons/);
    expect(() => contentDefinition({ ...list, items: Array.from({ length: 11 }, (_, i) => ({ id: `${i}`, title: "x" })) })).toThrow(/10 items/);
  });
});

describe("addresses", () => {
  it("detects the channel from the whatsapp: prefix", () => {
    expect(parseAddress("whatsapp:+13203780782")).toEqual({ channel: "whatsapp", e164: "+13203780782" });
    expect(parseAddress("+13203780782")).toEqual({ channel: "sms", e164: "+13203780782" });
    expect(parseAddress("not a number")).toBeNull();
  });
  it("uses MMS for US, CA and AU only, not +1 Caribbean numbers (SPEC §6.1)", () => {
    expect(supportsMms("+12025550123")).toBe(true); // US
    expect(supportsMms("+14165550123")).toBe(true); // CA
    expect(supportsMms("+61412345678")).toBe(true); // AU
    expect(supportsMms("+18765550123")).toBe(false); // Jamaica
    expect(supportsMms("+447700900123")).toBe(false); // UK
    expect(supportsMms("+5511987654321")).toBe(false); // BR
  });
  it("checks the window boundary", () => {
    expect(insideWindow(recent, now)).toBe(true);
    expect(insideWindow(stale, now)).toBe(false);
    expect(insideWindow(null, now)).toBe(false);
  });
});
