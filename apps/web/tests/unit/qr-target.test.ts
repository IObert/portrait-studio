import { describe, expect, it } from "vitest";
import { qrTarget } from "@/lib/booth/state";
import { defaultConfig, EventConfigInputSchema, type PortraitEvent } from "@/lib/events/schema";

const event = (over: Partial<PortraitEvent["config"]>): PortraitEvent => ({
  slug: "kings-night",
  state: "live",
  config: { ...defaultConfig("Kings Night", "+13203780782"), ...over },
  uploads: { frame: null, background: null },
  printerTokenHash: null,
  printerToken: null,
  createdAt: "2026-10-15T00:00:00.000Z",
  updatedAt: "2026-10-15T00:00:00.000Z",
});
const text = (url: string) => decodeURIComponent(new URL(url.replace(/^sms:/, "sms://x/")).searchParams.get(url.startsWith("sms:") ? "body" : "text") ?? "");

describe("QR link (D-37)", () => {
  it("WhatsApp: https://wa.me/<number>?text=<message with the event name>", () => {
    const url = qrTarget(event({ leadChannel: "whatsapp" }));
    expect(url.startsWith("https://wa.me/13203780782?text=")).toBe(true);
    expect(text(url)).toBe("Send this message to get your portrait from Twilio at Kings Night");
  });
  it("SMS uses the sms: link with the same message", () => {
    const url = qrTarget(event({ leadChannel: "sms" }));
    expect(url.startsWith("sms:+13203780782?&body=")).toBe(true);
    expect(text(url)).toBe("Send this message to get your portrait from Twilio at Kings Night");
  });
  it("uses the admin's message, or the event language's default when empty", () => {
    expect(text(qrTarget(event({ qrText: "Hey {event}, portrait please!" })))).toBe("Hey Kings Night, portrait please!");
    expect(text(qrTarget(event({ language: "pt_BR", qrText: "" })))).toBe("Envie esta mensagem para ganhar seu retrato da Twilio no Kings Night");
  });
  it("a message must keep {event}: it is how the booth knows the event", () => {
    const cfg = { ...defaultConfig("Kings Night", "+13203780782"), qrText: "Send this message for a portrait" };
    expect(EventConfigInputSchema.safeParse(cfg).success).toBe(false);
  });
});
