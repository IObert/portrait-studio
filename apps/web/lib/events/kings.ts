import { type EventConfigInput, KINGS_BACKGROUNDS } from "./schema";

/**
 * The Kings scenes follow the LA Kings toggle (D-36): off, they are never
 * kept, even if submitted; on with neither ticked (just switched on), both
 * are added.
 */
export function kingsBackgrounds(chosen: EventConfigInput["backgrounds"], laKings: boolean): EventConfigInput["backgrounds"] {
  const isKings = (b: string) => (KINGS_BACKGROUNDS as readonly string[]).includes(b);
  if (!laKings) return chosen.filter((b) => !isKings(b));
  return chosen.some(isKings) ? chosen : [...KINGS_BACKGROUNDS, ...chosen];
}
