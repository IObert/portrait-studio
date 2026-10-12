import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { applyFrame, MAX_DELIVERY_BYTES, PRINT, toDeliveryJpeg, toPrintPng, transparentWindow } from "@/lib/image/frame";

/** Frame fixture: opaque red border with a transparent window at (100,150) 1000×1400. */
async function frame() {
  const svg = `<svg width="1200" height="1800" xmlns="http://www.w3.org/2000/svg"><defs><mask id="m"><rect width="1200" height="1800" fill="white"/><rect x="100" y="150" width="1000" height="1400" fill="black"/></mask></defs><rect width="1200" height="1800" fill="#ff0000" mask="url(#m)"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
const portrait = () => sharp({ create: { width: 1024, height: 1536, channels: 3, background: "#0000ff" } }).png().toBuffer();

async function px(png: Buffer, x: number, y: number) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * 4;
  return [data[i], data[i + 1], data[i + 2]];
}

describe("frame compositing (SPEC §8.3)", () => {
  it("finds the transparent window", async () => {
    expect(await transparentWindow(await frame())).toEqual({ left: 100, top: 150, width: 1000, height: 1400 });
  });

  it("puts the portrait in the window and the frame on top", async () => {
    const out = await applyFrame(await portrait(), await frame());
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([1200, 1800]);
    expect(await px(out, 600, 900)).toEqual([0, 0, 255]); // portrait through the window
    expect(await px(out, 20, 20)).toEqual([255, 0, 0]); // border on top
    expect(await px(out, 600, 1700)).toEqual([255, 0, 0]);
  });

  it("works with the shipped placeholder frame", async () => {
    const out = await applyFrame(await portrait(), readFileSync("assets/frames/placeholder-border.png"));
    expect(await px(out, 600, 900)).toEqual([0, 0, 255]);
  });

  it("rejects a frame with no window", async () => {
    const solid = await sharp({ create: { width: 1200, height: 1800, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
    await expect(applyFrame(await portrait(), solid)).rejects.toThrow(/no transparent window/);
  });
});

describe("outputs (SPEC §9.2 step 6)", () => {
  it("print PNG is 1200×1800 at 300 DPI and opaque", async () => {
    const png = await toPrintPng(await portrait());
    const meta = await sharp(png).metadata();
    expect([meta.width, meta.height, meta.density, meta.format]).toEqual([PRINT.width, PRINT.height, 300, "png"]);
  });

  it("delivery JPEG stays under 5 MB even for noisy images", async () => {
    // Random noise is the worst case for JPEG size.
    const noise = Buffer.alloc(1200 * 1800 * 3);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24;
    const png = await sharp(noise, { raw: { width: 1200, height: 1800, channels: 3 } }).png().toBuffer();
    const jpeg = await toDeliveryJpeg(png);
    expect(jpeg.byteLength).toBeLessThanOrEqual(MAX_DELIVERY_BYTES);
    expect((await sharp(jpeg).metadata()).format).toBe("jpeg");
  });
});
