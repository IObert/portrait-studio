import type { Catalog } from "../../i18n/types";

/**
 * SendGrid substitutions for the verification email (SPEC §5.4, §12). Every
 * visible string comes from the catalog; the template
 * (assets/email/verification-email.html) only lays them out. Verify adds
 * {{twilio_code}} itself.
 */
export function verificationEmailSubstitutions(c: Catalog, eventName: string, privacyUrl: string): Record<string, string> {
  const e = c.email;
  return {
    subject: e.subject({ eventName }),
    preheader: e.preheader,
    eyebrow: e.eyebrow,
    event_name: eventName,
    headline: e.headline,
    intro: e.intro({ eventName }),
    consent_text: c.consent.emailConsentText,
    consent_after_link: c.consent.emailConsentAfterLink,
    privacy_url: privacyUrl,
    privacy_link: e.privacyLink,
    snippet_title: e.snippetTitle,
    cta_label: e.ctaLabel,
    sign_off: e.signOff,
    team: e.team,
    tagline: e.tagline,
    ignore: e.ignore,
  };
}
