/**
 * Moves a frame's logos and text away from the canvas edges, for the DS620 trim (docs/decisions.md D-41).
 * A thin band next to the edge, where the artwork is only plain colour, is stretched to make room, and everything
 * behind it moves inward. The tab or tower itself still runs off the canvas, so the cut never shows a gap.
 *
 *   node --import tsx scripts/frame-safe-zone-fix.ts <in.png> <out.png> top:46:15 bottom:40:24 left:14:40
 *
 * Each step is `edge:shift:band`: the band is the strip (in px) at that edge that gets stretched by `shift` px.
 * `top` steps only touch the top half and `bottom` steps the bottom half, so a frame with a tab at each end can use both.
 */
import sharp from "sharp";

type Edge = "top" | "bottom" | "left";

async function stretch(img: Buffer, w: number, h: number, edge: Edge, shift: number, band: number): Promise<Buffer> {
  const horizontal = edge === "left";
  const len = horizontal ? w : h;
  const part = (from: number, size: number) =>
    horizontal ? { left: from, top: 0, width: size, height: h } : { left: 0, top: from, width: w, height: size };
  const size = (n: number) => (horizontal ? { width: n, height: h } : { width: w, height: n });
  const pos = (at: number) => (horizontal ? { left: at, top: 0 } : { left: 0, top: at });

  const bandFrom = edge === "bottom" ? len - band : 0;
  const bandImg = await sharp(img).extract(part(bandFrom, band)).resize({ ...size(band + shift), fit: "fill" }).png().toBuffer();
  const restFrom = edge === "bottom" ? shift : band;
  const restImg = await sharp(img).extract(part(restFrom, len - band - shift)).png().toBuffer();
  const parts =
    edge === "bottom"
      ? [{ input: restImg, ...pos(0) }, { input: bandImg, ...pos(len - band - shift) }]
      : [{ input: bandImg, ...pos(0) }, { input: restImg, ...pos(band + shift) }];
  return sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(parts)
    .png()
    .toBuffer();
}

export async function fixFrame(input: Buffer, steps: { edge: Edge; shift: number; band: number }[]): Promise<Buffer> {
  const { width: w, height: h } = await sharp(input).metadata() as { width: number; height: number };
  const half = h / 2;
  let img: Buffer = await sharp(input).ensureAlpha().png().toBuffer();
  for (const { edge, shift, band } of steps) {
    if (edge === "left") {
      img = await stretch(img, w, h, edge, shift, band);
      continue;
    }
    // top steps work on the top half, bottom steps on the bottom half
    const y = edge === "top" ? 0 : half;
    const section = await sharp(img).extract({ left: 0, top: y, width: w, height: half }).png().toBuffer();
    const moved = await stretch(section, w, half, edge, shift, band);
    const other = await sharp(img)
      .extract({ left: 0, top: edge === "top" ? half : 0, width: w, height: half })
      .png()
      .toBuffer();
    img = await sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: moved, left: 0, top: y }, { input: other, left: 0, top: edge === "top" ? half : 0 }])
      .png()
      .toBuffer();
  }
  return img;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [input, output, ...specs] = process.argv.slice(2);
  if (!input || !output) throw new Error("usage: frame-safe-zone-fix.ts <in.png> <out.png> edge:shift:band…");
  const steps = specs.map((s) => {
    const [edge, shift, band] = s.split(":");
    return { edge: edge as Edge, shift: Number(shift), band: Number(band) };
  });
  const { readFileSync, writeFileSync } = await import("node:fs");
  writeFileSync(output, await fixFrame(readFileSync(input), steps));
}
