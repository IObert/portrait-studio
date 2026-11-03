import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { NO_CALIBRATION, PrintCalibrationSchema } from "@/lib/events/schema";
import { applyCalibration, CALIBRATION_PAGE, hasCalibration } from "@/lib/image/calibration";

/** A 1200×1800 print: red 20 px border around blue. */
async function print() {
  const svg = `<svg width="1200" height="1800" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="1800" fill="#ff0000"/><rect x="20" y="20" width="1160" height="1760" fill="#0000ff"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
async function pixel(png: Buffer, x: number, y: number) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * 4;
  return [data[i], data[i + 1], data[i + 2]];
}
const MM = 300 / 25.4;

describe("printer calibration (D-45)", () => {
  it("leaves a print alone when nothing is trimmed", async () => {
    const png = await print();
    expect(hasCalibration(NO_CALIBRATION)).toBe(false);
    expect(await applyCalibration(png, NO_CALIBRATION)).toBe(png);
  });

  it("fits the print inside what is left of the chart's page, whole", async () => {
    const out = await applyCalibration(await print(), { top: 2, right: 3, bottom: 4, left: 1 });
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height, meta.density]).toEqual([CALIBRATION_PAGE.width, CALIBRATION_PAGE.height, 300]);
    // Inside the visible area: from `left` mm to `right` mm from the edge, nothing cropped.
    const visible = { x0: Math.round(1 * MM), x1: CALIBRATION_PAGE.width - Math.round(3 * MM), y0: Math.round(2 * MM), y1: CALIBRATION_PAGE.height - Math.round(4 * MM) };
    expect(await pixel(out, (visible.x0 + visible.x1) / 2, (visible.y0 + visible.y1) / 2)).toEqual([0, 0, 255]);
    // The red border (outermost 20 px of the print, about 18 px once scaled) is still there, on all four sides.
    const midX = Math.round((visible.x0 + visible.x1) / 2), midY = Math.round((visible.y0 + visible.y1) / 2);
    expect(await pixel(out, visible.x0 + 3, midY)).toEqual([255, 0, 0]);
    expect(await pixel(out, visible.x1 - 3, midY)).toEqual([255, 0, 0]);
    expect(await pixel(out, midX, visible.y0 + 3 + 24)).toEqual([255, 0, 0]);
    expect(await pixel(out, midX, visible.y1 - 3 - 24)).toEqual([255, 0, 0]);
  });

  it("fills the trimmed strips with the picture's own edge, not white", async () => {
    const out = await applyCalibration(await print(), { top: 12, right: 12, bottom: 12, left: 12 });
    for (const [x, y] of [[0, 0], [CALIBRATION_PAGE.width - 1, CALIBRATION_PAGE.height - 1], [0, Math.floor(CALIBRATION_PAGE.height / 2)]] as const)
      expect(await pixel(out, x, y), `${x},${y}`).toEqual([255, 0, 0]);
  });

  it("keeps the chart and the page size in step", async () => {
    const meta = await sharp(readFileSync(path.join(import.meta.dirname, "../../assets/calibration/clipping-chart.png"))).metadata();
    expect([meta.width, meta.height]).toEqual([CALIBRATION_PAGE.width, CALIBRATION_PAGE.height]);
  });

  it("only accepts whole mm from 0 to 12", () => {
    expect(PrintCalibrationSchema.safeParse({ top: 0, right: 12, bottom: 5, left: 1 }).success).toBe(true);
    for (const bad of [-1, 13, 1.5, Number.NaN]) expect(PrintCalibrationSchema.safeParse({ ...NO_CALIBRATION, left: bad }).success, String(bad)).toBe(false);
  });
});
