import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { SlugSchema } from "../sync/names";

/**
 * Per-event printer token (SPEC §4.2, §10.1), short enough to type by hand on the
 * printer laptop: `<slug>.XXXX-XXXX-XXXX-XXXX` (user decision, D-33).
 *
 * The slug lets the agent API find the event. The secret is 16 Crockford base32
 * characters (80 random bits): no I, L, O or U, so it reads aloud and types cleanly.
 * Only guessable online, one request at a time, which 80 bits makes hopeless.
 *
 * Typing is forgiving: case, spaces, missing dashes and the look-alikes O→0, I/L→1
 * are normalised before the hash is compared.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const GROUPS = 4;
const GROUP_LEN = 4;

export function generatePrinterToken(slug: string): { token: string; hash: string } {
  // 32 divides 256, so masking a byte to 5 bits is uniform.
  const chars = [...randomBytes(GROUPS * GROUP_LEN)].map((b) => ALPHABET[b & 31]!).join("");
  const secret = chars.match(new RegExp(`.{${GROUP_LEN}}`, "g"))!.join("-");
  const token = `${SlugSchema.parse(slug)}.${secret}`;
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** The canonical form of a typed token, or null if it cannot be one. */
export function normalizeToken(input: string): string | null {
  const raw = input.trim();
  const dot = raw.lastIndexOf(".");
  if (dot < 1) return null;
  const slug = raw.slice(0, dot).toLowerCase();
  const secret = raw
    .slice(dot + 1)
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (!SlugSchema.safeParse(slug).success) return null;
  if (secret.length !== GROUPS * GROUP_LEN || [...secret].some((c) => !ALPHABET.includes(c))) return null;
  return `${slug}.${secret.match(new RegExp(`.{${GROUP_LEN}}`, "g"))!.join("-")}`;
}

/** Extracts the slug, or null if the token is malformed. */
export function slugFromToken(token: string): string | null {
  const canonical = normalizeToken(token);
  if (!canonical) return null;
  const slug = canonical.slice(0, canonical.lastIndexOf("."));
  return SlugSchema.safeParse(slug).success ? slug : null;
}

/** Constant-time comparison of a presented token with the stored hash. */
export function verifyPrinterToken(token: string, storedHash: string | null): boolean {
  if (!storedHash || !/^[0-9a-f]{64}$/.test(storedHash)) return false;
  const canonical = normalizeToken(token);
  if (!canonical) return false;
  return timingSafeEqual(Buffer.from(hashToken(canonical), "hex"), Buffer.from(storedHash, "hex"));
}
