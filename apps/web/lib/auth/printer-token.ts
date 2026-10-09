import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { SlugSchema } from "../sync/names";

/**
 * Per-event printer token (SPEC §4.2, §10.1): `pst_<slug>_<43 chars base64url>`.
 * The slug prefix lets the agent API find the event; 256 random bits make it
 * unguessable. Only the SHA-256 is stored; the token is shown once.
 */
export function generatePrinterToken(slug: string): { token: string; hash: string } {
  const token = `pst_${SlugSchema.parse(slug)}_${randomBytes(32).toString("base64url")}`;
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Extracts the slug, or null if the token is malformed. */
export function slugFromToken(token: string): string | null {
  const m = /^pst_([a-z0-9-]{1,40})_([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) return null;
  return SlugSchema.safeParse(m[1]).success ? m[1]! : null;
}

/** Constant-time comparison of a presented token with the stored hash. */
export function verifyPrinterToken(token: string, storedHash: string | null): boolean {
  if (!storedHash || !/^[0-9a-f]{64}$/.test(storedHash)) return false;
  return timingSafeEqual(Buffer.from(hashToken(token), "hex"), Buffer.from(storedHash, "hex"));
}
