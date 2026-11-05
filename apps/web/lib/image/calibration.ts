import sharp from "sharp";
import type { PrintCalibration } from "../events/schema";
import { PRINT } from "./frame";

/**
 * The page the clipping chart fills (D-45): the CP-D70DW's "10x15" driver page (448×295 pt, landscape)
 * turned upright, at 300 DPI. CUPS prints a picture of this size 1:1, so a number read off the chart is
 * mm on this canvas. Must match assets/calibration/clipping-chart.png.
 */
export const CALIBRATION_PAGE = { width: 1229, height: 1867 } as const;

const PX_PER_MM = PRINT.dpi / 25.4;

export const hasCalibration = (c: PrintCalibration) => c.top + c.right + c.bottom + c.left > 0;

/**
 * Fits a print into the part of the page the printer does not trim: scaled down, never cropped, so a
 * frame or border stays whole. What is left over is filled by repeating the picture's edge pixels, which
 * is mostly the trimmed strip nobody sees. The result is the chart's page size; with nothing trimmed
 * the print is not touched.
 */
export async function applyCalibration(png: Buffer, c: PrintCalibration): Promise<Buffer> {
  if (!hasCalibration(c)) return png;
  const { width: W, height: H } = CALIBRATION_PAGE;
  const px = (mm: number) => Math.round(mm * PX_PER_MM);
  const box = { left: px(c.left), top: px(c.top), width: W - px(c.left) - px(c.right), height: H - px(c.top) - px(c.bottom) };
  const { data, info } = await sharp(png).resize(box.width, box.height, { fit: "inside" }).toBuffer({ resolveWithObject: true });
  const left = box.left + Math.floor((box.width - info.width) / 2);
  const top = box.top + Math.floor((box.height - info.height) / 2);
  return sharp(data)
    .extend({ left, top, right: W - left - info.width, bottom: H - top - info.height, extendWith: "copy" })
    .withMetadata({ density: PRINT.dpi })
    .png({ compressionLevel: 9 })
    .toBuffer();
}
