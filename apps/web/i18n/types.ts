import type { BackgroundId } from "../lib/events/schema";
import type { StyleId } from "../lib/prompts/styles";

/**
 * Customer-facing catalog shape (SPEC §12). Both locales must satisfy this
 * type, so a missing key in either is a compile error. Milestone e adds the
 * attendee messages.
 */
export interface Catalog {
  styles: Record<StyleId, { name: string; aliases: readonly string[] }>;
  backgrounds: Record<Exclude<BackgroundId, "uploaded">, { name: string; aliases: readonly string[] }>;
}
