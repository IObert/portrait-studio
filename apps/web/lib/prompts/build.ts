import type { BackgroundId } from "../events/schema";
import type { Brand } from "../brands/la-kings";
import { backgroundPrompt } from "./backgrounds";
import { brandBlock, brandScene, PRESERVE_BRAND, styleLock } from "./brand";
import { PRESERVE } from "./defaults";
import { finalReminder, type Scene, sceneLine } from "./scene";
import { type FrameClearance, frameLine, TOP_FREE_LINE } from "./frame";
import { type StyleId, stylePrompt } from "./styles";

/**
 * Generation prompt (SPEC §9.3), joined with "\n" as in PROMPTS.md §E:
 * 1. style (§D, with {preserve}/{composition} from §C)  2. scene line (§E3)
 * 3. background (§E6 exact mode, or the §C choice)        4. top margin (D-40, always), then frame clearance
 *    (D-27, only for frames that cover the image)         5. final reminder (§E11)
 * With a brand (D-36) the brand block (§E4) follows the scene line, a brand scene
 * replaces the background (§E6 AI mode), the style's preserve line becomes
 * preserveBrand, and the style lock (§E10) goes before the final reminder.
 * Container, palette, caricature, reviewer feedback and landscape stay out of scope.
 */
export function buildPrompt(style: StyleId, background: BackgroundId, scene: Scene, clearance?: FrameClearance, brand?: Brand): string {
  const frame = clearance ? frameLine(clearance) : null;
  if (!brand) return [stylePrompt(style), sceneLine(scene), backgroundPrompt(background), TOP_FREE_LINE, ...(frame ? [frame] : []), finalReminder(scene)].join("\n");
  return [
    stylePrompt(style).replace(PRESERVE, PRESERVE_BRAND),
    sceneLine(scene),
    brandBlock(brand, scene),
    brandScene(brand, background) ?? backgroundPrompt(background),
    TOP_FREE_LINE,
    ...(frame ? [frame] : []),
    styleLock(style),
    finalReminder(scene),
  ].join("\n");
}
