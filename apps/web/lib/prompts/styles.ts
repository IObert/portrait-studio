import { COMPOSITION, PRESERVE } from "./defaults";

// Built-in styles, verbatim from PROMPTS.md §D (sticker excluded, SPEC §8.1).
// Paragraphs are joined with a blank line. Cartoon's hard-coded "Frame from the
// waist up." is replaced by the shared composition (SPEC §9.3). The two
// styles that ask for big expressive eyes yield to sunglasses (D-38).

/** Cartoon and anime paint eyes onto sunglasses without this (D-38). */
export const SUNGLASSES = "If a subject wears sunglasses or other glasses that hide the eyes, keep the lenses opaque and reflective as in the photo, and never draw eyes on or through them.";

export const STYLE_IDS = ["cartoon", "pop-art", "watercolor", "anime", "sketch", "pixel-art"] as const;
export type StyleId = (typeof STYLE_IDS)[number];

const PARAGRAPHS: Record<StyleId, readonly string[]> = {
  cartoon: [
    "Transform this photo into a 3D animated character portrait in the style of Pixar and Disney Animation Studios (The Incredibles, Coco, Up, Brave). Do not add anyone not in the original photo.",
    PRESERVE,
    `Style: High-quality Pixar-style 3D render with warm, rich color grading. Big round expressive eyes with detailed iris reflections, soft rounded features with a touch of stylization. ${SUNGLASSES} Smooth subsurface scattering on skin for that signature Pixar porcelain glow. Rich fabric and hair textures with individual strand detail. Every surface should have the polished, tactile quality of a Pixar film frame.`,
    "Body proportions: Keep the body realistically proportioned — normal adult height, limbs, and torso like The Incredibles characters. Do NOT make the body short, stocky, or compressed. The face and head can be slightly stylized but the body should look natural and well-proportioned.",
    "Lighting: Warm cinematic Pixar-style lighting — soft key light with golden tones, gentle fill light, and a subtle cool rim light. Soft ambient occlusion in creases and under the chin.",
    `${COMPOSITION} Give them a warm, friendly expression.`,
  ],
  "pop-art": [
    "Transform this photo into a bold pop art portrait in the style of Andy Warhol and Roy Lichtenstein. Do not add anyone not in the original photo.",
    PRESERVE,
    "Style: Bold black outlines, flat vibrant colors with high saturation, and Ben-Day dots or halftone patterns for shading. Use a limited but striking color palette with strong contrast. The overall look should feel like a hand-pulled screen print or comic-book panel.",
    "Lighting: Flat, graphic lighting with strong shadows rendered as solid color blocks.",
    COMPOSITION,
  ],
  watercolor: [
    "Transform this photo into a beautiful watercolor painting portrait. Do not add anyone not in the original photo.",
    PRESERVE,
    "Style: Soft, flowing watercolor washes with visible brush strokes and natural paint bleeding at edges. Use a luminous, translucent color palette with gentle gradients. Allow some areas of white paper to show through for a natural watercolor feel. The painting should look like a professional watercolor portrait by a skilled artist.",
    "Lighting: Soft, diffused natural lighting with gentle shadows built through layered washes.",
    COMPOSITION,
  ],
  anime: [
    "Create a josei, moe anime style image of the primary subject(s) in the photo. Don't add any person who is not a primary subject in the original photo. Fill the frame with the people and don't leave lots of blank space at the bottom or sides, but always keep the top 10% of the image free as described in the top margin instruction below, even if that means the people sit slightly lower. Preserve objects that the primary subjects are wearing, holding, or interacting with in the original photo, for example a chair they are sitting on, unless the branding instructions below explicitly replace them. Follow the selected background instructions below, preserving the original environment when requested or using the selected replacement background. Do not add other foreground objects unless explicitly requested by the branding instructions. Include all primary subjects specified by the scene count below, but exclude background bystanders, passersby, people partially visible at frame edges, and people on screens or posters.",
    PRESERVE,
    `Style: Clean anime illustration with bold outlines, smooth cel-shaded coloring, and large expressive eyes. ${SUNGLASSES} Use vibrant colors with clean flat shading and subtle highlights. The style should resemble a high-quality modern anime or manga illustration.`,
    "Lighting: Bright, clean anime-style lighting with defined shadows and crisp highlights.",
    `${COMPOSITION} Give them an expressive, confident pose.`,
  ],
  sketch: [
    "Transform this photo into a detailed pencil sketch portrait. Do not add anyone not in the original photo.",
    `${PRESERVE} Capture their likeness through precise linework and shading.`,
    "Style: Realistic graphite pencil drawing on white paper with fine cross-hatching and careful tonal shading. Use a full range of values from light to dark for depth and dimension. Show visible pencil strokes and paper texture. The drawing should look like a professional hand-drawn portrait by a skilled artist.",
    "Lighting: Strong directional lighting that creates clear highlights and shadows to define the face and features.",
    COMPOSITION,
  ],
  "pixel-art": [
    "Transform this photo into a pixel art portrait in a retro 16-bit video game style. Do not add anyone not in the original photo.",
    PRESERVE,
    "Style: Crisp pixel art with a visible pixel grid, limited but vibrant color palette, and clean dithering for shading. The style should evoke classic 16-bit era video game character portraits -- detailed enough to capture the person's likeness while maintaining the charming pixelated aesthetic.",
    "Lighting: Simple, clean lighting appropriate for pixel art with defined highlight and shadow areas using distinct color steps.",
    COMPOSITION,
  ],
};

export function stylePrompt(style: StyleId): string {
  return PARAGRAPHS[style].join("\n\n");
}
