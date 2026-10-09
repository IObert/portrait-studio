import sharp from "sharp";

export interface TransparencyReport {
  width: number;
  height: number;
  hasAlpha: boolean;
  /** Share of pixels with alpha === 0. */
  fullyTransparent: number;
  /** Share of pixels with 0 < alpha < 255 (soft edges such as hair). */
  partiallyTransparent: number;
  /** Share of the outer 4% border band that is opaque (alpha === 255). */
  opaqueBorder: number;
  /** True if the opaque border looks like a drawn two-tone checkerboard. */
  checkerboardSuspected: boolean;
}

/**
 * Measures how "real" a PNG's transparency is (SPEC §8.2 spike checks).
 * A drawn checkerboard or solid fill shows up as an opaque border band.
 */
export async function analyzeTransparency(png: Buffer): Promise<TransparencyReport> {
  const meta = await sharp(png).metadata();
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const band = Math.max(1, Math.round(Math.min(width, height) * 0.04));

  let full = 0;
  let partial = 0;
  let borderTotal = 0;
  let borderOpaque = 0;
  const borderGrays = new Map<number, number>();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = data[i + 3]!;
      if (a === 0) full++;
      else if (a < 255) partial++;
      const inBorder = x < band || y < band || x >= width - band || y >= height - band;
      if (!inBorder) continue;
      borderTotal++;
      if (a !== 255) continue;
      borderOpaque++;
      const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
      // Checkerboards are two low-saturation light tones; bucket them coarsely.
      if (Math.max(r, g, b) - Math.min(r, g, b) < 12 && r > 150) {
        const bucket = Math.round(r / 16);
        borderGrays.set(bucket, (borderGrays.get(bucket) ?? 0) + 1);
      }
    }
  }

  const total = width * height;
  const topTwo = [...borderGrays.values()].sort((a, b) => b - a).slice(0, 2);
  const checkerboardSuspected =
    borderOpaque > borderTotal * 0.5 &&
    topTwo.length === 2 &&
    topTwo.every((n) => n > borderOpaque * 0.2);

  return {
    width,
    height,
    hasAlpha: meta.hasAlpha === true,
    fullyTransparent: full / total,
    partiallyTransparent: partial / total,
    opaqueBorder: borderTotal ? borderOpaque / borderTotal : 0,
    checkerboardSuspected,
  };
}
