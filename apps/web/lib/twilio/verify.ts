import "server-only";
import twilio from "twilio";

/** Result of checking an email code with Verify (SPEC §5.4). */
export type CodeCheck = "approved" | "wrong" | "locked" | "expired";

export interface EmailVerifier {
  /** Sends a code. `locked` when Verify's send limit is reached (60203). */
  send(opts: { email: string; locale: "en" | "pt_BR"; substitutions: Record<string, string> }): Promise<"sent" | "locked">;
  check(opts: { email: string; code: string }): Promise<CodeCheck>;
}

/** Verify email via the SendGrid integration linked to the service (docs/decisions.md D-10). */
export function createEmailVerifier(cfg: { accountSid: string; apiKeySid: string; apiKeySecret: string; serviceSid: string }): EmailVerifier {
  const client = twilio(cfg.apiKeySid, cfg.apiKeySecret, { accountSid: cfg.accountSid, autoRetry: true, maxRetries: 2 });
  const svc = client.verify.v2.services(cfg.serviceSid);
  const code = (err: unknown) => (err as { code?: number }).code;

  return {
    async send({ email, locale, substitutions }) {
      try {
        await svc.verifications.create({
          to: email,
          channel: "email",
          // Verify's own locales: "en" and "pt-BR".
          locale: locale === "pt_BR" ? "pt-BR" : "en",
          channelConfiguration: { substitutions },
        });
        return "sent";
      } catch (err) {
        if (code(err) === 60203) return "locked"; // max send attempts
        throw err;
      }
    },
    async check({ email, code: entered }) {
      try {
        const r = await svc.verificationChecks.create({ to: email, code: entered });
        return r.status === "approved" ? "approved" : "wrong";
      } catch (err) {
        if (code(err) === 60202) return "locked"; // max check attempts
        if (code(err) === 20404) return "expired"; // no pending verification (expired or used)
        throw err;
      }
    },
  };
}
