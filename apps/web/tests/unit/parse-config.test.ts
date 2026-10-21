import { describe, expect, it } from "vitest";
import { parseConfig } from "@/lib/admin/parse-config";
import { defaultConfig } from "@/lib/events/schema";

/** The form as the browser submits it: unchecked boxes are absent, hidden options are still sent. */
function form(over: Record<string, string | null> = {}) {
  const c = defaultConfig("Ev", "+13203780782");
  const base: Record<string, string | null> = {
    name: c.name, language: c.language, leadChannel: c.leadChannel, qrSender: c.qrSender, qrText: c.qrText,
    frame: c.frame, maxImagesPerPerson: "10", maxPrintsPerPerson: "6", shareText: c.shareText, ctaHeadline: c.ctaText.headline,
    uploadedBackgroundName: "", promoText: "Win!", emailPromoCode: "KINGS10",
  };
  const f = new FormData();
  for (const [k, v] of Object.entries({ ...base, ...over })) if (v !== null) f.set(k, v);
  for (const s of c.styles) f.append("styles", s);
  for (const b of c.backgrounds) f.append("backgrounds", b);
  return f;
}

describe("event form parsing", () => {
  it("printing off saves even though the hidden promo option is still submitted", () => {
    const cfg = parseConfig(form({ leadCollection: "on", printingEnabled: null, promoEnabled: "on" }));
    expect(cfg.printingEnabled).toBe(false);
    expect(cfg.promo.enabled).toBe(false);
  });

  it("leads off saves even though a hidden email promo code is still submitted", () => {
    const cfg = parseConfig(form({ leadCollection: null, emailShowSnippet: "on" }));
    expect(cfg).toMatchObject({ leadCollection: false, emailPromoCode: "", emailShowSnippet: false });
  });

  it("keeps the options while their toggle is on", () => {
    const cfg = parseConfig(form({ leadCollection: "on", printingEnabled: "on", promoEnabled: "on", emailShowSnippet: "on" }));
    expect(cfg).toMatchObject({ emailPromoCode: "KINGS10", emailShowSnippet: true, printingEnabled: true, promo: { enabled: true, text: "Win!" } });
  });
});
