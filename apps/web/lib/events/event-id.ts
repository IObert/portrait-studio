import { SlugSchema } from "../sync/names";

/** Longest ID part taken from the name; room is left for a "-2" suffix within the 40-character limit. */
const BASE_MAX = 36;

/**
 * Internal event ID from the event name (user decision, D-35): lowercase,
 * accents removed, anything else becomes a dash. Never shown to attendees or
 * typed by admins; it only appears in URLs and object names. A name with no
 * usable characters (e.g. only emoji) falls back to "event".
 */
export function eventIdFromName(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, BASE_MAX)
    .replace(/-+$/, "");
  return SlugSchema.safeParse(base).success ? base : "event";
}

/** The n-th candidate: the base, then base-2, base-3, … */
export function eventIdCandidate(base: string, n: number): string {
  return n <= 1 ? base : `${base}-${n}`;
}
