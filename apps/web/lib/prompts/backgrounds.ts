import type { BackgroundId } from "../events/schema";
import { BACKGROUND_EXACT } from "./defaults";

// Background choices, verbatim from PROMPTS.md §C. `uploaded` uses the exact-mode
// prompt (§E6): the model draws only the person; the real image is composited later.
const CHOICES: Record<Exclude<BackgroundId, "uploaded" | "ice-rink" | "crypto-arena">, string> = {
  gradient: "Background: Clean soft gradient, light and uncluttered, suitable for printing.",
  "solid-white": "Background: Pure solid white background, clean and minimal.",
  "solid-black": "Background: Pure solid black background, dramatic and clean.",
  original: "Background: Recreate the background environment from the original photo in the same art style.",
};

/** Kings scenes come from the brand (lib/prompts/brand.ts); without it they are rejected by the config schema. */
export function backgroundPrompt(bg: BackgroundId): string {
  if (bg === "uploaded") return BACKGROUND_EXACT;
  if (bg === "ice-rink" || bg === "crypto-arena") throw new Error(`Background ${bg} needs the LA Kings promotion`);
  return CHOICES[bg];
}
