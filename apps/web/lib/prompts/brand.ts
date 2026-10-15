import type { Brand } from "../brands/la-kings";
import type { BackgroundId } from "../events/schema";
import type { Scene } from "./scene";
import type { StyleId } from "./styles";

/**
 * Brand parts of the generation prompt (D-36), verbatim from PROMPTS.md:
 * §C preserveBrand and promptBrandInstruction, §D brandCore, §E4 brand block
 * ("with brand references but no analysis"), §E6 AI-mode background, §E10
 * style lock. The reference images do the work; there is no analysis call.
 */

/** §C `promptPreserveBrand`: replaces the style's preserve line, which would keep the person's own clothing. */
export const PRESERVE_BRAND = "Preserve accurately: skin tone, eye color, hair color and style, facial hair, glasses, facial structure.";

/** §C `promptBrandInstruction`. */
export const BRAND_INSTRUCTION =
  "Logos and text: Copy the exact logos, crests, numbers, and text from the reference images. Do NOT invent, add, or modify any text or symbols. If you cannot reproduce text exactly, omit it entirely rather than rendering incorrect or gibberish text. Never add text that is not in the reference images.";

/** §E4 reminder, whenever brand references are present. */
export const BRAND_REMINDER =
  "REMINDER: The art style described above takes ABSOLUTE priority. The brand/clothing references are ONLY for the outfit — do NOT let them influence the rendering style, line work, colors, or visual aesthetic.";

/** §D `brandCore` per style, used by the style lock (§E10). */
export const BRAND_CORE: Record<StyleId, string> = {
  cartoon: "Pixar-style 3D animated portrait with warm colors and rich textures.",
  "pop-art": "Pop art style with halftone dots and high contrast.",
  watercolor: "Soft watercolor painting with flowing brushstrokes and gentle blending.",
  anime: "Anime style with large expressive eyes and clean line art.",
  sketch: "Hand-drawn pencil sketch with cross-hatching and graphite shading.",
  "pixel-art": "Pixel art style with visible pixels and retro 16-bit aesthetic.",
};

/** Input-image names, in the order they are sent: the prompt refers to them (§E4, §E6). */
export const brandRefName = (i: number) => `brand_ref_${i}.png`;
export const bgRefName = (i: number) => `bg_ref_${i}.png`;

/** §E4 with references, no analysis: clothing, then preserve, instruction, wardrobe, reminder. */
export function brandBlock(brand: Brand, { subjects: n, pet }: Scene): string {
  const s = brand.refs.length === 1 ? "" : "s";
  const petNote = pet ? (n > 1 ? ` Include the ${pet} naturally without branded clothing.` : ` Include the ${pet} naturally in the image.`) : "";
  const names = brand.refs.map((_, i) => brandRefName(i)).join(", ");
  const clothing =
    n > 1
      ? `Clothing: There are ${n} people — dress EVERY person in the outfit/gear from the brand reference photo${s}.${petNote}`
      : `Clothing: Dress the subject in the outfit/gear from the brand reference photo${s}.${petNote}`;
  const preserve = n > 1 ? `Preserve accurately for every subject: ${PRESERVE_BRAND.replace(/^Preserve accurately:\s*/, "")}` : PRESERVE_BRAND;
  return [`${clothing}\n\nThe input images named ${names} show the outfit visually.`, preserve, BRAND_INSTRUCTION, brand.wardrobe, BRAND_REMINDER].join("\n");
}

/** §E6 AI mode, with a reference and no analysis. Null when the background is not one of the brand's scenes. */
export function brandScene(brand: Brand, background: BackgroundId): string | null {
  const scene = brand.scenes[background];
  if (!scene) return null;
  return `Background: Match the background shown in the reference image. The input image named ${bgRefName(0)} shows the background visually. ${scene.prompt}`;
}

/** §E10, whenever brand content is present. */
export function styleLock(style: StyleId): string {
  return `FINAL STYLE LOCK: Render the entire output in this exact art style: ${BRAND_CORE[style]} The clothing and background descriptions above describe subject matter, not rendering technique — they must not override the chosen art style.`;
}
