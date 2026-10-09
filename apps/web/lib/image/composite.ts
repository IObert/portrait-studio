import sharp from "sharp";
import { solidifyAlpha } from "./alpha";

/** Generation canvas (SPEC §9.2): 1024×1536 portrait. */
export const CANVAS = { width: 1024, height: 1536 } as const;

/**
 * Composites a transparent portrait onto an uploaded background (SPEC §8.2):
 * the background is scaled to cover the canvas, the portrait is centered on top.
 * Near-opaque subject pixels are made fully opaque first (see solidifyAlpha).
 * Returns a PNG at canvas size.
 */
export async function compositeOnBackground(portraitPng: Buffer, background: Buffer): Promise<Buffer> {
  const bg = await sharp(background)
    .rotate()
    .resize(CANVAS.width, CANVAS.height, { fit: "cover", position: "centre" })
    .removeAlpha()
    .toBuffer();
  const portrait = await sharp(await solidifyAlpha(portraitPng))
    .ensureAlpha()
    .resize(CANVAS.width, CANVAS.height, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  return sharp(bg).composite([{ input: portrait, gravity: "centre" }]).png().toBuffer();
}

/** Solid-colour canvas, used for edge inspection over dark and light backgrounds. */
export function solidBackground(hex: string): Promise<Buffer> {
  return sharp({
    create: { width: CANVAS.width, height: CANVAS.height, channels: 3, background: hex },
  })
    .png()
    .toBuffer();
}
