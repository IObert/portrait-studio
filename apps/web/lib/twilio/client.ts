import "server-only";
import twilio from "twilio";

/**
 * Twilio REST client with shared request options. The SDK default is a 30 s
 * timeout on a keep-alive socket; an idle socket that the network silently
 * dropped then hangs a request for the full 30 s (seen in the worker's idle
 * polls). An 8 s timeout lets the caller's retry open a fresh connection.
 */
export const TWILIO_REQUEST_TIMEOUT_MS = 8_000;

export function twilioClient(cfg: { accountSid: string; apiKeySid: string; apiKeySecret: string }, opts: { autoRetry?: boolean; maxRetries?: number } = {}) {
  return twilio(cfg.apiKeySid, cfg.apiKeySecret, {
    accountSid: cfg.accountSid,
    timeout: TWILIO_REQUEST_TIMEOUT_MS,
    keepAlive: true,
    // Recycle sockets idle longer than this, before the network can silently drop them.
    keepAliveMsecs: 5_000,
    autoRetry: opts.autoRetry ?? false,
    maxRetries: opts.maxRetries,
  });
}
