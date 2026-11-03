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

  it("unlimited prints needs printing on", () => {
    expect(parseConfig(form({ printingEnabled: "on", unlimitedPrints: "on" })).unlimitedPrints).toBe(true);
    expect(parseConfig(form({ printingEnabled: null, unlimitedPrints: "on" })).unlimitedPrints).toBe(false);
  });

  it("keeps the options while their toggle is on", () => {
    const cfg = parseConfig(form({ leadCollection: "on", printingEnabled: "on", promoEnabled: "on", emailShowSnippet: "on" }));
    expect(cfg).toMatchObject({ emailPromoCode: "KINGS10", emailShowSnippet: true, printingEnabled: true, promo: { enabled: true, text: "Win!" } });
  });

  it("reads the four calibration numbers, and treats missing ones as nothing trimmed", () => {
    expect(parseConfig(form({ calibrationTop: "2", calibrationRight: "3", calibrationBottom: "4", calibrationLeft: "1" })).printCalibration).toEqual({ top: 2, right: 3, bottom: 4, left: 1 });
    expect(parseConfig(form()).printCalibration).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(parseConfig(form({ calibrationTop: "" })).printCalibration.top).toBe(0);
  });

  it("rejects calibration numbers the chart cannot give", () => {
    for (const bad of ["13", "-1", "1.5", "abc"]) expect(() => parseConfig(form({ calibrationLeft: bad })), bad).toThrow();
  });
});
