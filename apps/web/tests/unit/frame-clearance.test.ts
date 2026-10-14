import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { frameClearance } from "@/lib/image/frame-clearance";
import { buildPrompt } from "@/lib/prompts/build";
import { frameLine } from "@/lib/prompts/frame";

const frame = (id: string) => readFileSync(`assets/frames/${id}.png`);

describe("frame clearance (D-27)", () => {
  it("measures the logo tabs on the shipped frames", async () => {
    expect(await frameClearance(frame("twilio-tab-top"))).toMatchObject({ top: 0.12, bottom: 0 });
    expect((await frameClearance(frame("twilio-tab-bottom"))).bottom).toBeGreaterThanOrEqual(0.12);
    expect((await frameClearance(frame("twilio-tab-bottom-left"))).bottom).toBeGreaterThanOrEqual(0.12);
  });

  it("frames with their own window add no line", async () => {
    for (const id of ["twilio-border-left", "twilio-border-right"]) expect(frameLine(await frameClearance(frame(id))), id).toBeNull();
  });

  it("a thin border is ignored; a frame without overlap gives zero", async () => {
    const thin = await sharp(Buffer.from(`<svg width="1200" height="1800" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="40" fill="#000"/></svg>`)).png().toBuffer();
    expect(frameLine(await frameClearance(thin))).toBeNull();
  });

  it("tells the model which edge to keep free, with a margin", () => {
    const top = frameLine({ top: 0.12, bottom: 0 })!;
    expect(top).toContain("the top 15%");
    expect(top).not.toContain("bottom");
    expect(frameLine({ top: 0, bottom: 0.14 })).toContain("the bottom 20%");
    expect(frameLine({ top: 0.12, bottom: 0.14 })).toContain("the top 15% and the bottom 20%");
  });

  it("goes before the final reminder, and only when needed", () => {
    const scene = { subjects: 1, pet: null };
    const p = buildPrompt("anime", "gradient", scene, { top: 0.12, bottom: 0 });
    expect(p.indexOf("Frame clearance:")).toBeGreaterThan(-1);
    expect(p.indexOf("Frame clearance:")).toBeLessThan(p.indexOf("FINAL REMINDER"));
    // No frame, or a frame that covers nothing: exactly the PROMPTS.md prompt.
    expect(buildPrompt("anime", "gradient", scene, { top: 0, bottom: 0 })).toBe(buildPrompt("anime", "gradient", scene));
  });
});
