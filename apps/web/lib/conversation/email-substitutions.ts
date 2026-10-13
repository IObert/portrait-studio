import type { PortraitEvent } from "../events/schema";

/**
 * Variables for the SendGrid verification template
 * (assets/email/verification-email.html, D-20). The template holds its own
 * wording; the app sends only what varies per event. Verify adds
 * {{twilio_code}} itself. Empty values hide their block ({{#if}}).
 */
export function verificationEmailSubstitutions(event: PortraitEvent): Record<string, string> {
  const subs: Record<string, string> = { event_name: event.config.name };
  // Extras only apply with lead collection on (they are validated that way too).
  if (event.config.leadCollection) {
    if (event.config.emailPromoCode) subs.promo_code = event.config.emailPromoCode;
    if (event.config.emailShowSnippet) subs.show_snippet = "true";
  }
  return subs;
}
