import sharp from "sharp";
import { PRINT, transparentWindow } from "./frame";

/** How much of the portrait window a frame covers at the top and bottom, as a fraction of its height (0–1). */
export interface FrameClearance {
  top: number;
  bottom: number;
}

/**
 * Overlap below this is a thin border, ornament or the wedge of a tilted
 * window (the red-border frames measure 3–5%), not something a head could
 * hide behind. The logo tabs measure 12–14%.
 */
export const CLEARANCE_MIN = 0.08;

/**
 * Measures where a frame's opaque parts cover the portrait window (D-27).
 * Only the middle 40% of the width counts: that is where a head and hair
 * are, so corner logos and side borders do not push people around. For each
 * column, the deepest opaque pixel from the window's top (and bottom) edge
 * within the top (and bottom) half is taken; the widest such band wins.
 */
export async function frameClearance(framePng: Buffer): Promise<FrameClearance> {
  const frame = await sharp(framePng).resize(PRINT.width, PRINT.height, { fit: "fill" }).ensureAlpha().png().toBuffer();
  const box = await transparentWindow(frame);
  const { data, info } = await sharp(frame).raw().toBuffer({ resolveWithObject: true });
  const opaque = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3]! >= 128;
  const half = Math.floor(box.height / 2);
  const x0 = box.left + Math.floor(box.width * 0.3);
  const x1 = box.left + Math.ceil(box.width * 0.7);
  let top = 0;
  let bottom = 0;
  for (let x = x0; x < x1; x++) {
    for (let k = half - 1; k >= 0; k--) {
      if (opaque(x, box.top + k)) {
        top = Math.max(top, k + 1);
        break;
      }
    }
    for (let k = half - 1; k >= 0; k--) {
      if (opaque(x, box.top + box.height - 1 - k)) {
        bottom = Math.max(bottom, k + 1);
        break;
      }
    }
  }
  const round = (px: number) => Math.round((px / box.height) * 100) / 100;
  return { top: round(top), bottom: round(bottom) };
}
