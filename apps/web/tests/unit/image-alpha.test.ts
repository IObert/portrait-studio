import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { analyzeTransparency } from "@/lib/image/alpha";
import { CANVAS, compositeOnBackground, solidBackground } from "@/lib/image/composite";

/** Fixture: transparent canvas with an opaque red ellipse in the middle. */
async function cutoutFixture(): Promise<Buffer> {
  const svg = `<svg width="${CANVAS.width}" height="${CANVAS.height}"><ellipse cx="512" cy="768" rx="300" ry="500" fill="#ff0000"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function pixel(png: Buffer, x: number, y: number) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
}

describe("analyzeTransparency", () => {
  it("reports real transparency for a cut-out", async () => {
    const r = await analyzeTransparency(await cutoutFixture());
    expect(r.hasAlpha).toBe(true);
    expect(r.fullyTransparent).toBeGreaterThan(0.2);
    expect(r.opaqueBorder).toBe(0);
    expect(r.checkerboardSuspected).toBe(false);
  });

  it("flags a drawn checkerboard", async () => {
    const tile = 32;
    const squares: string[] = [];
    for (let y = 0; y < CANVAS.height; y += tile)
      for (let x = 0; x < CANVAS.width; x += tile)
        squares.push(`<rect x="${x}" y="${y}" width="${tile}" height="${tile}" fill="${(x / tile + y / tile) % 2 ? "#cccccc" : "#ffffff"}"/>`);
    const svg = `<svg width="${CANVAS.width}" height="${CANVAS.height}">${squares.join("")}</svg>`;
    const r = await analyzeTransparency(await sharp(Buffer.from(svg)).ensureAlpha().png().toBuffer());
    expect(r.fullyTransparent).toBe(0);
    expect(r.checkerboardSuspected).toBe(true);
  });

  it("flags a solid fill", async () => {
    const r = await analyzeTransparency(await sharp(await solidBackground("#ffffff")).ensureAlpha().png().toBuffer());
    expect(r.opaqueBorder).toBe(1);
    expect(r.fullyTransparent).toBe(0);
  });
});

describe("compositeOnBackground", () => {
  it("shows the background through transparent areas and keeps the subject", async () => {
    const bg = await solidBackground("#0000ff");
    const out = await compositeOnBackground(await cutoutFixture(), bg);
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([CANVAS.width, CANVAS.height]);
    expect(await pixel(out, 10, 10)).toEqual([0, 0, 255, 255]);
    expect(await pixel(out, 512, 768)).toEqual([255, 0, 0, 255]);
  });

  it("scales a larger, differently shaped background to cover the canvas", async () => {
    const wide = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#00ff00" } }).png().toBuffer();
    const out = await compositeOnBackground(await cutoutFixture(), wide);
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([CANVAS.width, CANVAS.height]);
    expect(await pixel(out, 1, 1)).toEqual([0, 255, 0, 255]);
  });
});
