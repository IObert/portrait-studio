import { CLEARANCE_MIN, type FrameClearance } from "../image/frame-clearance";

export type { FrameClearance };

/** Rounded up to the next 5%, plus a little room, so the subject clears the frame with a margin. */
const pct = (f: number) => Math.min(30, Math.ceil((f * 100 + 3) / 5) * 5);

/** The top of every portrait stays free whatever the frame (D-40): a frame, a logo tab or a crop may cover it. */
export const TOP_MARGIN = 0.1;

/**
 * Always in the prompt (D-40). The model cannot see the frame, and the strip at the top is where a frame's tab
 * goes. People, and anything the picture is about (a building name, a sign with text), must start below it.
 */
export const TOP_FREE_LINE =
  "Top margin: Keep the top 10% of the image free. Every head, all hair, hats, goggles and raised hands, and any readable sign, building name or logo, must start below that strip, with only plain background in it. Scale and position the subjects and the scene so nothing important touches the top edge.";

/**
 * Composition line for frames that cover part of the image (D-27; an
 * addition to PROMPTS.md §E, approved by the user). The model cannot see the
 * frame, so it is told which edge to keep free. Null when nothing covers the
 * image enough to matter.
 */
export function frameLine({ top, bottom }: FrameClearance): string | null {
  const parts: string[] = [];
  if (top >= CLEARANCE_MIN) parts.push(`the top ${pct(top)}%`);
  if (bottom >= CLEARANCE_MIN) parts.push(`the bottom ${pct(bottom)}%`);
  if (parts.length === 0) return null;
  const where = parts.join(" and ");
  return `Frame clearance: A decorative frame will cover ${where} of the image after generation. Keep that area free of the subjects: every head, all hair and every face must sit fully outside ${where}, with only background there. Scale and position the subjects so nothing important is hidden.`;
}
