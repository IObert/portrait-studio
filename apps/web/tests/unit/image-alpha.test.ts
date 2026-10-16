import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { solidifyAlpha } from "@/lib/image/alpha";
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

describe("solidifyAlpha", () => {
  it("makes near-opaque pixels opaque and keeps soft edges and transparency", async () => {
    const px = Buffer.from([255, 0, 0, 253, 255, 0, 0, 120, 0, 0, 0, 0]);
    const png = await sharp(px, { raw: { width: 3, height: 1, channels: 4 } }).png().toBuffer();
    const out = await solidifyAlpha(png);
    const { data } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    expect([data[3], data[7], data[11]]).toEqual([255, 120, 0]);
  });
});

describe("compositeOnBackground", () => {
  it("does not let the background bleed through a near-opaque subject", async () => {
    // Subject at alpha 253, as gpt-image-2.5 produces it.
    const subject = await sharp({ create: { width: CANVAS.width, height: CANVAS.height, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 253 / 255 } } }).png().toBuffer();
    const out = await compositeOnBackground(subject, await solidBackground("#0000ff"));
    expect(await pixel(out, 512, 768)).toEqual([255, 0, 0, 255]);
  });

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
