import sharp from "sharp";
import type { InboundMedia } from "../twilio/inbound";

/** Selfie input limits (SPEC §9.2). HEIC is not supported: WhatsApp converts photos (docs/decisions.md). */
export const MAX_SELFIE_BYTES = 20 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function isImage(m: InboundMedia): boolean {
  return IMAGE_TYPES.has(m.contentType.split(";")[0]!.trim().toLowerCase());
}

export type MediaFetch = (url: string) => Promise<Response>;

/** Twilio media URLs need account credentials; they redirect to a signed CDN URL. */
export function twilioMediaFetch(username: string, password: string): MediaFetch {
  const auth = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
  return async (url) => {
    // Only fetch Twilio's own media host: the URL comes from a (signed) webhook, but never trust it blindly.
    const host = new URL(url).hostname;
    if (host !== "api.twilio.com" && !host.endsWith(".twilio.com")) throw new Error("Unexpected media host");
    return fetch(url, { headers: { authorization: auth }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
  };
}

/**
 * Downloads and normalizes a selfie (SPEC §9.2 step 1): auto-rotate, strip
 * metadata, re-encode as JPEG. Bytes live in memory only during this call.
 * Returns null if the file is not a usable image.
 */
export async function downloadSelfie(m: InboundMedia, fetchMedia: MediaFetch): Promise<Buffer | null> {
  if (!isImage(m)) return null;
  const res = await fetchMedia(m.url);
  if (!res.ok) throw new Error(`Media download failed: ${res.status}`);
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_SELFIE_BYTES) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.byteLength > MAX_SELFIE_BYTES) return null;
  try {
    return await sharp(bytes, { failOn: "error", limitInputPixels: 50_000_000 })
      .rotate()
      .resize(2048, 2048, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();
  } catch {
    return null;
  }
}
