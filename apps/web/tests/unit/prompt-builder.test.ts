import { describe, expect, it } from "vitest";
import { BACKGROUND_IDS, KINGS_BACKGROUNDS } from "@/lib/events/schema";

// Without the LA Kings promotion, its scenes cannot be chosen (D-36).
const PLAIN_BACKGROUNDS = BACKGROUND_IDS.filter((b) => !(KINGS_BACKGROUNDS as readonly string[]).includes(b));
import { buildPrompt } from "@/lib/prompts/build";
import { STYLE_IDS } from "@/lib/prompts/styles";

describe("prompt builder (SPEC §9.3)", () => {
  // One snapshot per style × background (SPEC §9.3, §16).
  for (const style of STYLE_IDS)
    for (const bg of PLAIN_BACKGROUNDS)
      it(`${style} × ${bg}`, () => {
        expect(buildPrompt(style, bg, { subjects: 1, pet: null })).toMatchSnapshot();
      });

  it("uses one composition everywhere: chest up, never waist up (SPEC §9.3)", () => {
    for (const style of STYLE_IDS) {
      const p = buildPrompt(style, "gradient", { subjects: 1, pet: null });
      expect(p, style).toContain("from the chest up");
      expect(p, style).not.toMatch(/waist up/i);
    }
  });

  it("cartoon and anime never draw eyes on sunglasses (D-38)", () => {
    for (const style of ["cartoon", "anime"] as const)
      expect(buildPrompt(style, "gradient", { subjects: 1, pet: null }), style).toContain("never draw eyes on or through them");
  });

  it("adds the scene line and the matching final reminder for groups and pets", () => {
    const group = buildPrompt("anime", "original", { subjects: 3, pet: null });
    expect(group).toContain("exactly 3 HUMAN subjects");
    expect(group).toContain("FINAL REMINDER: Exactly 3 humans");
    expect(group).toContain("DISTINCT facial features");
    const pet = buildPrompt("sketch", "solid-white", { subjects: 1, pet: "dog" });
    expect(pet).toContain("1 person and a dog");
    expect(pet).toContain("Exactly 1 human and 1 dog");
  });

  it("uses the exact-mode transparent background for the uploaded background", () => {
    expect(buildPrompt("cartoon", "uploaded", { subjects: 1, pet: null })).toContain("must be fully transparent");
  });

  it("never includes out-of-scope blocks", () => {
    const all = STYLE_IDS.flatMap((s) => PLAIN_BACKGROUNDS.map((b) => buildPrompt(s, b, { subjects: 2, pet: "cat" }))).join("\n");
    for (const banned of ["STYLE LOCK", "CARICATURE", "Override from reviewer", "landscape", "Clothing:", "REMINDER: The art style"]) expect(all).not.toContain(banned);
  });
});

describe("top margin (D-40)", () => {
  const scene = { subjects: 1, pet: null };
  it("is in every prompt, with or without a frame or a brand, before the final reminder", () => {
    for (const style of STYLE_IDS)
      for (const bg of PLAIN_BACKGROUNDS) {
        const p = buildPrompt(style, bg, scene);
        expect(p, `${style} × ${bg}`).toContain("Keep the top 13% of the image height free");
        expect(p.indexOf("Top margin:")).toBeLessThan(p.indexOf("FINAL REMINDER"));
      }
  });
  it("asks for more than the 10% the eval checks, so a model that stops at the line still clears it (D-51)", () => {
    expect(buildPrompt("anime", "gradient", scene)).toContain("about 200 px of a 1536 px tall image");
  });
  it("fills the strip with the scene for a scene background, and never asks for a blank band (D-51)", () => {
    for (const style of STYLE_IDS) {
      const p = buildPrompt(style, "original", scene);
      expect(p, style).toContain("Fill the strip with the background: continue the scene up to the top edge");
      expect(p, style).toContain("The background still fills it, with no blank band.");
      expect(p, style).not.toContain("plain background");
    }
  });
  it("keeps the strip transparent for the uploaded background and plain for gradients and solids (D-51)", () => {
    expect(buildPrompt("anime", "uploaded", scene)).toContain("The strip stays transparent.");
    for (const bg of ["gradient", "solid-white", "solid-black"] as const) expect(buildPrompt("anime", bg, scene)).toContain("The strip is simply more of the plain background.");
  });
  it("comes before the frame line, and the frame line still names its own larger share", () => {
    const p = buildPrompt("anime", "gradient", scene, { top: 0.12, bottom: 0 });
    expect(p.indexOf("Top margin:")).toBeLessThan(p.indexOf("Frame clearance:"));
    expect(p).toContain("the top 15%");
  });
});
