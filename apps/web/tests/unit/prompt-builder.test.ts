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

  it("uses one composition everywhere: chest up, never waist up (§17 Q3)", () => {
    for (const style of STYLE_IDS) {
      const p = buildPrompt(style, "gradient", { subjects: 1, pet: null });
      expect(p, style).toContain("from the chest up");
      expect(p, style).not.toMatch(/waist up/i);
    }
  });

  it("cartoon never draws eyes on sunglasses (D-38)", () => {
    expect(buildPrompt("cartoon", "gradient", { subjects: 1, pet: null })).toContain("never draw eyes on or through them");
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
