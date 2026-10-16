import sharp from "sharp";

/**
 * gpt-image-2.5 renders the subject at alpha ~253, never 255, so ~1% of the
 * background would show through the person. Snap near-opaque pixels to fully
 * opaque; soft edges (hair) below the threshold are left untouched.
 */
export async function solidifyAlpha(png: Buffer, threshold = 250): Promise<Buffer> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 3; i < data.length; i += 4) if (data[i]! >= threshold) data[i] = 255;
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}
