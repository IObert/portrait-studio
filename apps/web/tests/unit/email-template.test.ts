import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { catalogs } from "@/i18n";
import { verificationEmailSubstitutions } from "@/lib/conversation/email-substitutions";
import { LOCALES } from "@/lib/events/schema";

const html = readFileSync("assets/email/verification-email.html", "utf8");
const placeholders = new Set([...html.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]!));

describe("verification email template", () => {
  it.each(LOCALES)("every placeholder is filled for %s (Verify adds twilio_code)", (locale) => {
    const subs = verificationEmailSubstitutions(catalogs[locale], "Ev", "https://x.test/privacy/ev");
    for (const p of placeholders) if (p !== "twilio_code") expect(subs, p).toHaveProperty(p);
    for (const k of Object.keys(subs)) expect(placeholders, `unused substitution ${k}`).toContain(k);
    for (const v of Object.values(subs)) expect(v.trim()).not.toBe("");
  });

  it("carries the consent statement and privacy link (SPEC §5.4)", () => {
    expect(placeholders).toContain("consent_text");
    expect(placeholders).toContain("privacy_url");
    expect(placeholders).toContain("twilio_code");
  });

  it("has no leftovers from the Mixologist template", () => {
    for (const s of ["Mixologist", "ordering", "wearedevs", "event-name", "Twilio credit"]) expect(html, s).not.toContain(s);
  });
});
