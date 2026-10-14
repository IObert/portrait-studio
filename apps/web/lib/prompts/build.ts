import type { BackgroundId } from "../events/schema";
import { backgroundPrompt } from "./backgrounds";
import { finalReminder, type Scene, sceneLine } from "./scene";
import { type FrameClearance, frameLine } from "./frame";
import { type StyleId, stylePrompt } from "./styles";

/**
 * Generation prompt (SPEC §9.3), joined with "\n" as in PROMPTS.md §E:
 * 1. style (§D, with {preserve}/{composition} from §C)  2. scene line (§E3)
 * 3. background (§E6 exact mode, or the §C choice)        4. frame clearance (D-27, only for frames that cover the image)
 * 5. final reminder (§E11)
 * Brand, container, palette, caricature, reviewer feedback, style lock and
 * landscape blocks are out of scope and never added.
 */
export function buildPrompt(style: StyleId, background: BackgroundId, scene: Scene, clearance?: FrameClearance): string {
  const frame = clearance ? frameLine(clearance) : null;
  return [stylePrompt(style), sceneLine(scene), backgroundPrompt(background), ...(frame ? [frame] : []), finalReminder(scene)].join("\n");
}
