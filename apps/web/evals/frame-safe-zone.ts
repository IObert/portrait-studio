import sharp from "sharp";

/**
 * Frame safe zone (docs/decisions.md D-41). The DS620 prints borderless and loses up to ~36 px (3 mm) per edge, a bit
 * more at the bottom than at the top. Artwork that is anchored to an edge (a tab, a border) may run off the canvas.
 * Anything else, such as a logo or text, must stay at least SAFE_ZONE_PX inside every edge.
 */
export const SAFE_ZONE_PX = 60;
/** Fully opaque or not: pixels at or above this alpha are part of the frame. */
const OPAQUE = 128;
/** Colour distance (sum of channel differences) from the frame's base colour that makes a pixel "content". */
const CONTENT_DISTANCE = 120;
/** Specks smaller than this many pixels are anti-aliasing noise, not content. */
const MIN_CONTENT_PIXELS = 12;

export interface Feature {
  /** Pixel bounds, inclusive. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  pixels: number;
  /** Distance in px from each canvas edge to the nearest feature pixel. */
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface FrameReport {
  width: number;
  height: number;
  /** The colour that most of the frame is filled with: tab or border colour. */
  base: [number, number, number];
  /** Content that does not touch an edge and sits closer than SAFE_ZONE_PX to one. */
  violations: Feature[];
  /** Smallest edge distance over all the content that does not touch an edge. */
  minDistance: number;
}

/**
 * Finds the logos and text of a frame without knowing the design: take the frame's most common colour (the tab or
 * border), call every opaque pixel that differs strongly from it "content", group content into connected shapes, and
 * measure each shape's distance to the canvas edges. Shapes that touch an edge are bleed (a tower, a tab outline) and
 * are exempt.
 */
export async function checkFrame(file: string | Buffer): Promise<FrameReport> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  // Raw RGBA bytes; the buffer is always in range, so the lookups cannot be undefined.
  const at = (i: number, c: number) => data[i * 4 + c]!;

  const votes = new Map<number, number>();
  for (let i = 0; i < w * h; i++) {
    if (at(i, 3) < OPAQUE) continue;
    const key = ((at(i, 0) >> 4) << 8) | ((at(i, 1) >> 4) << 4) | (at(i, 2) >> 4);
    votes.set(key, (votes.get(key) ?? 0) + 1);
  }
  const top = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  const base: [number, number, number] = [((top >> 8) & 15) * 16 + 8, ((top >> 4) & 15) * 16 + 8, (top & 15) * 16 + 8];

  const content = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (at(i, 3) < OPAQUE) continue;
    const d = Math.abs(at(i, 0) - base[0]) + Math.abs(at(i, 1) - base[1]) + Math.abs(at(i, 2) - base[2]);
    if (d > CONTENT_DISTANCE) content[i] = 1;
  }

  const seen = new Uint8Array(w * h);
  const features: Feature[] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!content[start] || seen[start]) continue;
    let x0 = w, y0 = h, x1 = -1, y1 = -1, pixels = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w, y = (i - x) / w;
      pixels++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && content[j] && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    if (pixels < MIN_CONTENT_PIXELS) continue;
    features.push({ x0, y0, x1, y1, pixels, left: x0, top: y0, right: w - 1 - x1, bottom: h - 1 - y1 });
  }

  const inside = features.filter((f) => Math.min(f.left, f.top, f.right, f.bottom) > 0);
  return {
    width: w,
    height: h,
    base,
    violations: inside.filter((f) => Math.min(f.left, f.top, f.right, f.bottom) < SAFE_ZONE_PX),
    minDistance: inside.length ? Math.min(...inside.map((f) => Math.min(f.left, f.top, f.right, f.bottom))) : Infinity,
  };
}
