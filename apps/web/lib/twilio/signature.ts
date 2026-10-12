import "server-only";
import twilio from "twilio";

/**
 * Validates X-Twilio-Signature (SPEC §5.1). The URL is rebuilt from
 * PUBLIC_BASE_URL, not the request's Host header: behind Azure ingress or a
 * tunnel the internal URL differs from the one Twilio signed.
 */
export function isValidTwilioSignature(opts: {
  authToken: string;
  publicBaseUrl: string;
  pathAndQuery: string;
  signature: string | null;
  params: Record<string, string>;
}): boolean {
  if (!opts.signature) return false;
  const url = new URL(opts.pathAndQuery, opts.publicBaseUrl).toString();
  return twilio.validateRequest(opts.authToken, opts.signature, url, opts.params);
}
