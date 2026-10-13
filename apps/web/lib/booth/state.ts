import "server-only";
import QRCode from "qrcode";
import { catalogs } from "@/i18n";
import { SlideshowItemSchema } from "../delivery/slideshow";
import { getEnv, requireEnv } from "../env";
import type { EventState, PortraitEvent } from "../events/schema";
import { signMedia } from "../media-token";
import { getServices } from "../services";
import { eventObjects } from "../sync/names";

/** Everything the booth screen shows (SPEC §10.4). No personal data. */
export interface BoothState {
  state: Exclude<EventState, "draft">;
  name: string;
  locale: "en" | "pt_BR";
  cta: { headline: string; steps: string[] };
  /** QR code SVG for the event's lead channel (SPEC §4.2, §5.2). */
  qrSvg: string;
  /** Number shown under the QR code. */
  number: string;
  /** Consented images, newest first; signed links valid for 24 h. */
  slides: { id: string; url: string }[];
  messages: { onBreak: string; ended: string };
}

/** Link the QR code opens (SPEC §5.2): WhatsApp or SMS, prefilled with the event code. */
export function qrTarget(event: PortraitEvent): string {
  const text = catalogs[event.config.language].qrPrefill({ eventName: event.config.name });
  const number = event.config.qrSender.replace(/^\+/, "");
  if (event.config.leadChannel === "whatsapp") return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
  // `sms:<n>?&body=` works on both iOS and Android (SPEC §5.2).
  return `sms:+${number}?&body=${encodeURIComponent(text)}`;
}

/** Ids of slideshow images, oldest first. A cheap read for change detection. */
export async function slideIds(slug: string): Promise<string[]> {
  const { sync } = getServices();
  const items: { id: string; addedAt: string }[] = [];
  for await (const [id, it] of sync.map(eventObjects(slug).slideshow, SlideshowItemSchema).entries()) items.push({ id, addedAt: it.addedAt });
  return items.sort((a, b) => a.addedAt.localeCompare(b.addedAt)).map((i) => i.id);
}

export async function buildBoothState(event: PortraitEvent): Promise<BoothState | null> {
  if (event.state === "draft") return null;
  const { sync } = getServices();
  const env = requireEnv(getEnv(), ["MEDIA_SIGNING_SECRET", "PUBLIC_BASE_URL"]);
  const c = catalogs[event.config.language];
  const slides: BoothState["slides"] = [];
  if (event.state === "live") {
    const items: { id: string; blobPath: string; addedAt: string }[] = [];
    for await (const [id, it] of sync.map(eventObjects(event.slug).slideshow, SlideshowItemSchema).entries()) items.push({ id, ...it });
    items.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    for (const it of items.slice(0, 50)) {
      slides.push({ id: it.id, url: new URL(`/m/${signMedia(env.MEDIA_SIGNING_SECRET, it.blobPath, 24 * 60 * 60)}`, env.PUBLIC_BASE_URL).toString() });
    }
  }
  return {
    state: event.state,
    name: event.config.name,
    locale: event.config.language,
    cta: { headline: event.config.ctaText.headline, steps: event.config.ctaText.steps },
    qrSvg: await QRCode.toString(qrTarget(event), { type: "svg", margin: 1, errorCorrectionLevel: "M" }),
    number: event.config.qrSender,
    slides,
    messages: { onBreak: c.routing.onBreak, ended: c.routing.ended },
  };
}
