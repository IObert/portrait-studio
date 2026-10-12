import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed, expiring media links (SPEC §6.1: "an app route that streams the
 * blob"). Twilio fetches /m/<token>; the token names the blob path and an
 * expiry and is HMAC-signed, so links cannot be guessed or altered. Works
 * locally through a tunnel, where Azurite SAS URLs are unreachable.
 */
export interface MediaClaim {
  /** Blob path, e.g. events/<slug>/generated/<job>.jpg */
  p: string;
  /** Expiry, seconds since epoch. */
  e: number;
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");

export function signMedia(secret: string, blobPath: string, ttlSeconds: number, now = Date.now()): string {
  const body = b64(JSON.stringify({ p: blobPath, e: Math.floor(now / 1000) + ttlSeconds } satisfies MediaClaim));
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

/** Returns the claim if the signature is valid and unexpired, else null. */
export function verifyMedia(secret: string, token: string, now = Date.now()): MediaClaim | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claim = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as MediaClaim;
    if (typeof claim.p !== "string" || typeof claim.e !== "number") return null;
    // Only generated images may be served this way.
    if (!/^events\/[a-z0-9-]+\/generated\/[A-Za-z0-9_-]+\.(jpg|print\.png)$/.test(claim.p)) return null;
    return claim.e * 1000 > now ? claim : null;
  } catch {
    return null;
  }
}
