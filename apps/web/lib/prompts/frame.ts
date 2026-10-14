import { CLEARANCE_MIN, type FrameClearance } from "../image/frame-clearance";

export type { FrameClearance };

/** Rounded up to the next 5%, plus a little room, so the subject clears the frame with a margin. */
const pct = (f: number) => Math.min(30, Math.ceil((f * 100 + 3) / 5) * 5);

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
