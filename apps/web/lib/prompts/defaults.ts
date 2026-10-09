// Verbatim from PROMPTS.md §C (settings defaults). Composition is "chest up" for
// every style (decision 2026-10-09, SPEC §17 Q3); preserve uses the settings text.

export const PRESERVE =
  "Preserve accurately for every subject: skin tone, eye color, hair color, hairstyle, facial hair, glasses, jewelry, clothing, and any visible accessories or distinguishing features.";

export const COMPOSITION =
  "Composition: Portrait framing from the chest up, with all subjects positioned naturally as they appear in the original photo.";

/** PROMPTS.md §E6, "Exact mode": transparent output for the uploaded background. */
export const BACKGROUND_EXACT =
  "Background: The area around the subject must be fully transparent with no environment, no floor, no shadow cast onto a surface, and no color fill. Render only the subject as a cut-out. The transparent area will be replaced with the actual background image in post-processing.";
