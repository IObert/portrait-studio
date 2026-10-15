import type { BackgroundId } from "../events/schema";

/**
 * A brand outfit (D-36): reference images the model copies the outfit from,
 * the wardrobe instruction, and the brand's own background scenes. Static
 * config in code: a second brand is a new definition, not new code.
 */
export interface Brand {
  key: string;
  name: string;
  /** Files in apps/web/assets/<key>/, sent as brand_ref_N.png. */
  refs: readonly string[];
  /** PROMPTS.md §E4 `brandPrompt`. */
  wardrobe: string;
  /** Background scenes (AI mode, §E6): one reference image each plus a scene prompt. */
  scenes: Partial<Record<BackgroundId, { ref: string; prompt: string }>>;
}

export const LA_KINGS: Brand = {
  key: "la-kings",
  name: "LA Kings",
  refs: ["LAK-jersey.png", "LAK-uniforms.png", "LAK-gear.png"],
  wardrobe:
    "Dress the subject in the black Los Angeles Kings home hockey jersey: the 'Los Angeles KINGS' crest with the crown on the chest, the Mercury Insurance patch on the upper right chest, the NHL logo at the collar, and silver and white stripes on the sleeves and hem.",
  scenes: {
    "ice-rink": {
      ref: "bg-ice-rink.png",
      prompt: "The subject stands on the ice inside Crypto.com Arena, the home of the LA Kings.",
    },
    "crypto-arena": {
      ref: "bg-crypto-arena.png",
      prompt: "The subject stands on the plaza in front of Crypto.com Arena in Los Angeles at dusk.",
    },
  },
};
