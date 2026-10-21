import { describe, expect, it } from "vitest";
import { catalogs } from "@/i18n";
import { ACTION, advanceConsent, beginConsent, type ConsentInput } from "@/lib/conversation/consent";
import { newSession, type Session } from "@/lib/conversation/session";
import { defaultConfig, type PortraitEvent } from "@/lib/events/schema";

const now = new Date("2026-10-10T12:00:00Z");
const c = catalogs.en;
const privacyUrl = "https://x.test/privacy/ev";
const event = (leadCollection: boolean): PortraitEvent => ({
  slug: "ev",
  state: "live",
  config: { ...defaultConfig("SIGNAL London", "+13203780782"), leadCollection },
  uploads: { frame: null, background: null },
  printerTokenHash: null, printerToken: null,
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
});
const msg = (text: string, extra: Partial<ConsentInput> = {}): ConsentInput => ({ channel: "whatsapp", text, ...extra });
const session = () => newSession("en", now);
const bodies = (r: { messages: { kind: string; body: string; smsBody?: string }[] }) => r.messages.map((m) => m.body);

describe("Case A: returning profile with a name", () => {
  it("greets by name, links privacy and asks only for agreement", () => {
    const r = beginConsent(session(), event(true), c, { id: "mem_profile_1", firstName: "Ana" }, privacyUrl, "whatsapp");
    expect(r.session.step).toBe("awaiting_agree");
    expect(r.messages[0]).toMatchObject({ kind: "buttons", buttons: [{ id: ACTION.agree }] });
    expect(bodies(r)[0]).toContain("Welcome back, Ana");
    expect(bodies(r)[0]).toContain(privacyUrl);
    expect(r.effects).toEqual([]); // no email code for returning profiles
  });

  it("opts in as 'returning' on agree", () => {
    const begun = beginConsent(session(), event(true), c, { id: "mem_profile_1", firstName: "Ana" }, privacyUrl, "whatsapp");
    const r = advanceConsent(begun.session, event(true), c, msg("", { selection: ACTION.agree }), privacyUrl);
    expect(r.session).toMatchObject({ step: "ready", optedIn: true });
    expect(r.effects).toEqual([
      { type: "opt-in", method: "returning", firstName: "Ana", memoryProfileId: "mem_profile_1" },
      { type: "proceed" },
    ]);
  });
});

describe("Case B: unknown person, lead collection on", () => {
  const ev = event(true);
  it("walks name → email → code in three replies (SPEC §13 'easy start')", () => {
    const s0 = beginConsent(session(), ev, c, null, privacyUrl, "whatsapp");
    expect(s0.session.step).toBe("awaiting_name");

    expect(advanceConsent(s0.session, ev, c, msg("Ana"), privacyUrl).messages[0]).toMatchObject({ body: c.consent.nameInvalid });
    const s1 = advanceConsent(s0.session, ev, c, msg("Ana Maria Souza"), privacyUrl);
    expect(s1.session).toMatchObject({ step: "awaiting_email", lead: { firstName: "Ana", lastName: "Maria Souza" } });

    expect(advanceConsent(s1.session, ev, c, msg("not-an-email"), privacyUrl).messages[0]).toMatchObject({ body: c.consent.emailInvalid });
    const asked = advanceConsent(s1.session, ev, c, msg("Ana@Example.COM"), privacyUrl);
    expect(asked.effects).toEqual([{ type: "send-code", email: "ana@example.com" }]);
    expect(asked.messages).toEqual([]);

    const s2 = advanceConsent(asked.session, ev, c, msg("Ana@Example.COM"), privacyUrl, undefined, "sent");
    expect(s2.session.step).toBe("awaiting_code");
    const body = bodies(s2)[0]!;
    expect(body).toContain("ana@example.com");
    expect(body).toContain(privacyUrl);
    expect(body.toLowerCase()).toContain("marketing");
  });

  it("verifies the code and opts in with the verified email", () => {
    const s: Session = { ...session(), step: "awaiting_code", lead: { firstName: "Ana", lastName: "Souza", email: "ana@example.com" } };
    expect(advanceConsent(s, ev, c, msg("123456"), privacyUrl).effects).toEqual([{ type: "check-code", email: "ana@example.com", code: "123456" }]);
    const ok = advanceConsent(s, ev, c, msg("123 456"), privacyUrl, "approved");
    expect(ok.session).toMatchObject({ step: "ready", optedIn: true, lead: null });
    expect(ok.effects[0]).toEqual({ type: "opt-in", method: "verified_email", firstName: "Ana", lastName: "Souza", email: "ana@example.com", memoryProfileId: null });
  });

  it("stays locked out on wrong, locked or expired codes", () => {
    const s: Session = { ...session(), step: "awaiting_code", lead: { firstName: "Ana", lastName: "S", email: "ana@example.com" } };
    for (const [result, expected] of [["wrong", "didn't work"], ["expired", "didn't work"], ["locked", "Too many attempts"]] as const) {
      const r = advanceConsent(s, ev, c, msg("000000"), privacyUrl, result);
      expect(r.session.optedIn).toBe(false);
      expect(bodies(r)[0]).toContain(expected);
      expect(r.effects).toEqual([]);
    }
  });

  it("resends on the localized keyword", () => {
    const s: Session = { ...session(), step: "awaiting_code", lead: { firstName: "A", lastName: "B", email: "ana@example.com" } };
    expect(advanceConsent(s, ev, c, msg("resend"), privacyUrl).effects).toEqual([{ type: "resend-code", email: "ana@example.com" }]);
    expect(bodies(advanceConsent(s, ev, c, msg("RESEND"), privacyUrl, undefined, "sent"))[0]).toContain("new code to ana@example.com");
    expect(bodies(advanceConsent(s, ev, c, msg("resend"), privacyUrl, undefined, "locked"))[0]).toContain("Too many attempts");
  });

  it("lets a corrected email address restart the code step", () => {
    const s: Session = { ...session(), step: "awaiting_code", lead: { firstName: "A", lastName: "B", email: "typo@example.com" } };
    const r = advanceConsent(s, ev, c, msg("ana@example.com"), privacyUrl);
    expect(r.effects).toEqual([{ type: "send-code", email: "ana@example.com" }]);
  });

  it("never opts in without a valid code (SPEC §5.4)", () => {
    let s: Session = { ...session(), step: "awaiting_code", lead: { firstName: "A", lastName: "B", email: "a@b.co" } };
    for (const text of ["hello", "selfie please", "0000"]) s = advanceConsent(s, ev, c, msg(text), privacyUrl, "wrong").session;
    expect(s.optedIn).toBe(false);
    expect(s.step).toBe("awaiting_code");
  });
});

describe("Case C: unknown person, lead collection off", () => {
  const ev = event(false);
  it("asks only for agreement and creates no Memory profile (SPEC §5.4)", () => {
    const r = beginConsent(session(), ev, c, null, privacyUrl, "whatsapp");
    expect(r.session).toMatchObject({ step: "awaiting_agree", memoryProfileId: null });
    expect(bodies(r)[0]).toContain(privacyUrl);
    const agreed = advanceConsent(r.session, ev, c, msg("", { selection: ACTION.agree }), privacyUrl);
    expect(agreed.effects[0]).toEqual({ type: "opt-in", method: "agree_only", firstName: undefined, memoryProfileId: null });
  });
});

describe("the gate holds", () => {
  const ev = event(false);
  it("re-prompts and never proceeds for any other message", () => {
    const s = beginConsent(session(), ev, c, null, privacyUrl, "whatsapp").session;
    for (const input of [msg("hi"), msg("I want a portrait"), msg(""), msg("yes please")]) {
      const r = advanceConsent(s, ev, c, input, privacyUrl);
      expect(r.session.optedIn).toBe(false);
      expect(r.effects).toEqual([]);
      expect(bodies(r)[0]).toBe(c.consent.agreeReminder);
    }
  });

  it("accepts exact keywords on SMS but not free text", () => {
    const s = beginConsent(session(), ev, c, null, privacyUrl, "sms").session;
    expect(advanceConsent(s, ev, c, msg("AGREE", { channel: "sms" }), privacyUrl).session.optedIn).toBe(true);
    expect(advanceConsent(s, ev, c, msg("i agree!", { channel: "sms" }), privacyUrl).session.optedIn).toBe(true);
    expect(advanceConsent(s, ev, c, msg("I agree to everything", { channel: "sms" }), privacyUrl).session.optedIn).toBe(false);
    // A button payload is still honoured if it somehow arrives on SMS.
    expect(advanceConsent(s, ev, c, msg("", { channel: "sms", selection: ACTION.agree }), privacyUrl).session.optedIn).toBe(true);
  });

  it("does not treat an SMS keyword as agreement on WhatsApp, where a button exists", () => {
    const s = beginConsent(session(), ev, c, null, privacyUrl, "whatsapp").session;
    expect(advanceConsent(s, ev, c, msg("agree"), privacyUrl).session.optedIn).toBe(false);
  });

  it("includes an SMS hint with the localized keyword", () => {
    const r = beginConsent(session(), ev, c, null, privacyUrl, "sms");
    expect(r.messages[0]).toMatchObject({ smsBody: expect.stringContaining("AGREE") });
  });
});

describe("pt_BR runs the same flow", () => {
  it("asks for the name and code in Portuguese", () => {
    const pt = catalogs.pt_BR;
    const ev = event(true);
    const s0 = beginConsent(newSession("pt_BR", now), ev, pt, null, privacyUrl, "whatsapp");
    expect(bodies(s0)[0]).toContain("nome completo");
    const s1 = advanceConsent(s0.session, ev, pt, msg("Ana Souza"), privacyUrl);
    const s2 = advanceConsent(s1.session, ev, pt, msg("ana@example.com"), privacyUrl, undefined, "sent");
    expect(bodies(s2)[0]).toContain("código de 6 dígitos");
    expect(advanceConsent(s2.session, ev, pt, msg("reenviar"), privacyUrl).effects).toEqual([{ type: "resend-code", email: "ana@example.com" }]);
  });
});
