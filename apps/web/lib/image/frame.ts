import sharp from "sharp";

/** 4x6 portrait at 300 DPI (SPEC §8.3, §9.2 step 6). */
export const PRINT = { width: 1200, height: 1800, dpi: 300 } as const;
/** Delivery JPEG limit (SPEC §6.1). */
export const MAX_DELIVERY_BYTES = 5 * 1024 * 1024;

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Bounding box of the frame's transparent window (alpha < 128, SPEC §8.3). */
export async function transparentWindow(framePng: Buffer): Promise<Box> {
  const { data, info } = await sharp(framePng).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width, minY = info.height, maxX = -1, maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3]! < 128) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error("Frame has no transparent window");
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Places the portrait under the frame (SPEC §8.3): scale it to cover the
 * window, center it there, then draw the frame on top. Output is 1200×1800.
 */
export async function applyFrame(portrait: Buffer, framePng: Buffer): Promise<Buffer> {
  const frame = await sharp(framePng).resize(PRINT.width, PRINT.height, { fit: "fill" }).ensureAlpha().png().toBuffer();
  const box = await transparentWindow(frame);
  const fitted = await sharp(portrait).resize(box.width, box.height, { fit: "cover", position: "centre" }).toBuffer();
  return sharp({ create: { width: PRINT.width, height: PRINT.height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
    .composite([
      { input: fitted, left: box.left, top: box.top },
      { input: frame, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
}

/** Final print PNG: 1200×1800 at 300 DPI, opaque (SPEC §9.2 step 6). */
export async function toPrintPng(image: Buffer): Promise<Buffer> {
  return sharp(image)
    .resize(PRINT.width, PRINT.height, { fit: "cover", position: "centre" })
    .flatten({ background: "#ffffff" })
    .withMetadata({ density: PRINT.dpi })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** Delivery JPEG ≤ 5 MB (SPEC §6.1): step quality down until it fits. */
export async function toDeliveryJpeg(printPng: Buffer): Promise<Buffer> {
  for (const quality of [90, 82, 74, 66, 58]) {
    const jpeg = await sharp(printPng).jpeg({ quality, mozjpeg: true }).toBuffer();
    if (jpeg.byteLength <= MAX_DELIVERY_BYTES) return jpeg;
  }
  return sharp(printPng).resize(900, 1350).jpeg({ quality: 70, mozjpeg: true }).toBuffer();
}
