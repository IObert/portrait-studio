import { describe, expect, it } from "vitest";
import { catalogs } from "@/i18n";
import type { Catalog } from "@/i18n";
import { LOCALES } from "@/lib/events/schema";
import { STYLE_IDS } from "@/lib/prompts/styles";

/** Every leaf (string, string[] or function) in a catalog, with its path. */
function leaves(obj: unknown, path: string[] = []): [string, unknown][] {
  if (obj && typeof obj === "object" && !Array.isArray(obj))
    return Object.entries(obj).flatMap(([k, v]) => leaves(v, [...path, k]));
  return [[path.join("."), obj]];
}

describe.each(LOCALES)("catalog %s", (locale) => {
  const c: Catalog = catalogs[locale];

  it("has the same keys as English (runtime check on top of the type)", () => {
    expect(leaves(c).map(([k]) => k).sort()).toEqual(leaves(catalogs.en).map(([k]) => k).sort());
  });

  it("has no empty strings", () => {
    for (const [k, v] of leaves(c)) if (typeof v === "string") expect(v.trim(), k).not.toBe("");
  });

  it("keeps button and list titles within Content API limits", () => {
    expect(c.consent.agreeButton.length).toBeLessThanOrEqual(20);
    for (const id of STYLE_IDS) expect(c.styles[id].name.length, id).toBeLessThanOrEqual(24);
    for (const b of Object.values(c.backgrounds)) expect(b.name.length).toBeLessThanOrEqual(24);
    for (const k of ["pickEventButton"] as const) expect(c.routing[k].length).toBeLessThanOrEqual(20);
    for (const k of ["styleButton", "backgroundButton"] as const) expect(c.menus[k].length).toBeLessThanOrEqual(20);
  });

  it("puts the event code in the QR prefill", () => {
    expect(c.qrPrefill({ code: "SPLONDON" })).toContain("#SPLONDON");
  });

  it("states privacy, the link and marketing consent in the code request (SPEC §5.4)", () => {
    const text = c.consent.askCode({ email: "a@b.co", privacyUrl: "https://x.test/privacy/ev", resendKeyword: "RESEND" });
    expect(text).toContain("https://x.test/privacy/ev");
    expect(text).toContain("RESEND");
    expect(text.toLowerCase()).toMatch(/marketing/);
  });

  it("links the privacy notice in every consent message", () => {
    const url = "https://x.test/privacy/ev";
    expect(c.consent.welcomeBack({ firstName: "Ana", privacyUrl: url })).toContain(url);
    expect(c.consent.agreeOnly({ eventName: "Ev", privacyUrl: url })).toContain(url);
    expect(c.consent.emailConsentText({ eventName: "Ev", privacyUrl: url })).toContain(url);
  });

  it("offers at least one agree and one resend keyword", () => {
    expect(c.consent.agreeKeywords.length).toBeGreaterThan(0);
    expect(c.consent.resendKeywords.length).toBeGreaterThan(0);
  });
});

describe("catalog limits", () => {
  it("the code-request text is under WhatsApp's 1024-char body limit", () => {
    for (const l of LOCALES)
      expect(catalogs[l].consent.askCode({ email: "a.very.long.address@example-company.com", privacyUrl: "https://portrait-studio.example.com/privacy/some-event-code", resendKeyword: "REENVIAR" }).length).toBeLessThan(1024);
  });
});
