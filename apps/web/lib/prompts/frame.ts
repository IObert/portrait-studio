import type { BackgroundId } from "../events/schema";
import { CLEARANCE_MIN, type FrameClearance } from "../image/frame-clearance";

export type { FrameClearance };

/** Rounded up to the next 5%, plus a little room, so the subject clears the frame with a margin. */
const pct = (f: number) => Math.min(30, Math.ceil((f * 100 + 3) / 5) * 5);

/** The top of every portrait stays free whatever the frame (D-40): a frame, a logo tab or a crop may cover it. */
export const TOP_MARGIN = 0.1;

/**
 * What the prompt asks for. More than TOP_MARGIN (what the eval checks): a model told "10%" puts the hair right at the
 * 10% line, so asking for 13% lands it clear of the 10% strip (checked live, D-51).
 */
const ASKED = 0.13;
const asked = `${Math.round(ASKED * 100)}%`;
/** The size the model draws at (generate.ts), so the percentage also comes as pixels. */
const askedPx = Math.round(ASKED * 1536);

/**
 * What fills the strip (D-51). "Plain background" made the model leave a blank band at the top of portraits whose
 * background is the original scene, so a scene is told to run on to the top edge.
 */
function stripRule(background: BackgroundId): string {
  if (background === "uploaded") return "The strip stays transparent.";
  if (background === "gradient" || background === "solid-white" || background === "solid-black") return "The strip is simply more of the plain background.";
  return "Fill the strip with the background: continue the scene up to the top edge (more wall, ceiling, sky or whatever is there), with no blank band, flat color block, solid stripe or border across the top.";
}

/**
 * Always in the prompt (D-40). The model cannot see the frame, and the strip at the top is where a frame's tab
 * goes. People, and anything the picture is about (a building name, a sign with text), must start below it.
 */
export function topFreeLine(background: BackgroundId): string {
  return `Top margin: Keep the top ${asked} of the image height free of people and important content (about ${askedPx} px of a 1536 px tall image). Every head, all hair, hats, goggles and raised hands, and any readable sign, building name or logo, must start below that strip. ${stripRule(background)} Scale and position the subjects and the scene so nothing important touches the top edge.`;
}

/** Said again as the last words of the prompt, because the final reminder is the part a model weighs most. */
export function topFreeReminder(background: BackgroundId): string {
  const fill = background === "uploaded" || background === "gradient" || background === "solid-white" || background === "solid-black" ? "" : " The background still fills it, with no blank band.";
  return ` The top ${asked} of the image has no head, hair or hand in it.${fill}`;
}

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
