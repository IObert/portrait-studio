import "server-only";
import QRCode from "qrcode";
import { z } from "zod";
import { catalogs } from "@/i18n";
import { SlideshowItemSchema } from "../delivery/slideshow";
import { getEnv, requireEnv } from "../env";
import type { PortraitEvent } from "../events/schema";
import { signMedia } from "../media-token";
import { eventObjects } from "../sync/names";
import type { SyncStore } from "../sync/store";

/**
 * Public booth-screen state in `ev_<slug>_booth` (SPEC §10.4, D-17). Pushed to
 * the booth over the Sync SDK; no personal data.
 */
export const BoothDocSchema = z.object({
  state: z.enum(["live", "break", "ended"]),
  name: z.string(),
  locale: z.enum(["en", "pt_BR"]),
  cta: z.object({ headline: z.string(), steps: z.array(z.string()) }),
  qrSvg: z.string(),
  number: z.string(),
  messages: z.object({ onBreak: z.string(), ended: z.string() }),
});
export type BoothDoc = z.infer<typeof BoothDocSchema>;

/** A slideshow image as the booth screen receives it. */
export interface BoothSlide {
  id: string;
  url: string;
  addedAt: string;
}

/** Link the QR code opens (SPEC §5.2): WhatsApp or SMS, prefilled with a message naming the event. */
export function qrTarget(event: PortraitEvent): string {
  const text = catalogs[event.config.language].qrPrefill({ eventName: event.config.name });
  const number = event.config.qrSender.replace(/^\+/, "");
  if (event.config.leadChannel === "whatsapp") return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
  // `sms:<n>?&body=` works on both iOS and Android (SPEC §5.2).
  return `sms:+${number}?&body=${encodeURIComponent(text)}`;
}

export async function boothDoc(event: PortraitEvent): Promise<BoothDoc | null> {
  if (event.state === "draft") return null;
  const c = catalogs[event.config.language];
  return {
    state: event.state,
    name: event.config.name,
    locale: event.config.language,
    cta: { headline: event.config.ctaText.headline, steps: event.config.ctaText.steps },
    qrSvg: await QRCode.toString(qrTarget(event), { type: "svg", margin: 1, errorCorrectionLevel: "M" }),
    number: event.config.qrSender,
    messages: { onBreak: c.routing.onBreak, ended: c.routing.ended },
  };
}

/**
 * Writes the booth document and makes sure the slideshow map exists, so a
 * read-only booth token can open both (`open_existing`). Call after every
 * change to the event. A draft event has no booth document.
 */
export async function publishBooth(sync: SyncStore, event: PortraitEvent): Promise<void> {
  const ev = eventObjects(event.slug);
  const doc = await boothDoc(event);
  if (!doc) {
    await sync.deleteDocument(ev.booth);
    return;
  }
  await sync.ensureMap(ev.slideshow);
  await sync.document(ev.booth, BoothDocSchema).put(doc);
}

/** Signed image link for a slideshow item; valid as long as the image itself (7 days). */
export function slideUrl(blobPath: string): string {
  const env = requireEnv(getEnv(), ["MEDIA_SIGNING_SECRET", "PUBLIC_BASE_URL"]);
  return new URL(`/m/${signMedia(env.MEDIA_SIGNING_SECRET, blobPath, 7 * 24 * 60 * 60)}`, env.PUBLIC_BASE_URL).toString();
}

/** Current slides, newest first (server render; the SDK keeps them live after that). */
export async function boothSlides(sync: SyncStore, slug: string): Promise<BoothSlide[]> {
  const items: BoothSlide[] = [];
  for await (const [id, it] of sync.map(eventObjects(slug).slideshow, SlideshowItemSchema).entries()) {
    items.push({ id, url: it.url ?? slideUrl(it.blobPath), addedAt: it.addedAt });
  }
  return items.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
}
