import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { verificationEmailSubstitutions } from "@/lib/conversation/email-substitutions";
import { defaultConfig, type EventConfigInput, type PortraitEvent } from "@/lib/events/schema";
import { PRIVACY_NOTICE_URL } from "@/lib/privacy";

const html = readFileSync("assets/email/verification-email.html", "utf8");
const body = html.replace(/<!--[\s\S]*?-->/g, "");
const vars = new Set([...body.matchAll(/\{\{\s*(?:#if\s+)?([a-z_]+)\s*\}\}/g)].map((m) => m[1]!));
const event = (over: Partial<EventConfigInput>): PortraitEvent => ({
  slug: "ev", state: "live", config: { ...defaultConfig("SIGNAL London", "+13203780782"), ...over },
  uploads: { frame: null, background: null }, printerTokenHash: null, printerToken: null, createdAt: "", updatedAt: "",
});

describe("verification email (D-20)", () => {
  it("uses only valid Handlebars variable names (no hyphens)", () => {
    expect([...vars].sort()).toEqual(["event_name", "promo_code", "show_snippet", "twilio_code"]);
    expect(body).not.toMatch(/\{\{[^}]*-[^}]*\}\}/);
    expect(body.match(/\{\{#if/g)?.length).toBe(body.match(/\{\{\/if\}\}/g)?.length);
  });

  it("links only the Twilio Privacy Notice", () => {
    expect(body).toContain(`href="${PRIVACY_NOTICE_URL}"`);
    expect(body).not.toMatch(/\/privacy\//);
  });

  it("is renamed to Portrait Studio", () => {
    for (const s of ["Mixologist", "ordering", "wearedevs", "event-name"]) expect(body, s).not.toContain(s);
    expect(body).toContain("Portrait Studio");
  });

  it("sends the promo code and snippet flag per event, only with lead collection on", () => {
    expect(verificationEmailSubstitutions(event({ emailPromoCode: "SIGNAL-25", emailShowSnippet: true }))).toEqual({ event_name: "SIGNAL London", promo_code: "SIGNAL-25", show_snippet: "true" });
    expect(verificationEmailSubstitutions(event({ emailShowSnippet: false }))).toEqual({ event_name: "SIGNAL London" });
    expect(verificationEmailSubstitutions(event({ leadCollection: false, emailPromoCode: "X", emailShowSnippet: true }))).toEqual({ event_name: "SIGNAL London" });
  });
});
