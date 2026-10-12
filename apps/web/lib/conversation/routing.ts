import type { PortraitEvent } from "../events/schema";
import { normalize } from "./text";

export interface Binding {
  eventSlug: string;
  boundAt: string;
}

/** Result of mapping a message to an event (SPEC §5.2). */
export type Route =
  | { kind: "event"; event: PortraitEvent; bind: boolean }
  /** Bound or coded event is on break or ended: reply with that state's message. */
  | { kind: "not-live"; event: PortraitEvent }
  | { kind: "pick"; live: PortraitEvent[] }
  | { kind: "none" };

/** Finds `#CODE` or a bare event code in the text. Codes are compared case-insensitively. */
export function findCode(text: string, events: readonly PortraitEvent[]): PortraitEvent | undefined {
  const words = normalize(text).split(" ").map((w) => w.replace(/^#/, ""));
  // Slugs may contain dashes, which normalize() turns into spaces; compare those too.
  const joined = normalize(text).replace(/#/g, "");
  return events.find((e) => {
    const code = normalize(e.slug);
    return words.includes(code) || (code.includes(" ") && ` ${joined} `.includes(` ${code} `));
  });
}

/**
 * Event routing (SPEC §5.2). Draft events are invisible. A code for a live
 * event binds (or re-binds) the address; a code for a non-live event gets that
 * state's reply.
 */
export function route(text: string, events: readonly PortraitEvent[], binding: Binding | null): Route {
  const visible = events.filter((e) => e.state !== "draft");
  const live = visible.filter((e) => e.state === "live");

  const coded = findCode(text, visible);
  if (coded) return coded.state === "live" ? { kind: "event", event: coded, bind: binding?.eventSlug !== coded.slug } : { kind: "not-live", event: coded };

  const bound = binding && visible.find((e) => e.slug === binding.eventSlug);
  if (bound) return bound.state === "live" ? { kind: "event", event: bound, bind: false } : { kind: "not-live", event: bound };

  if (live.length === 1) return { kind: "event", event: live[0]!, bind: true };
  if (live.length > 1) return { kind: "pick", live: [...live].sort((a, b) => a.config.name.localeCompare(b.config.name)) };
  return { kind: "none" };
}

/** Resolves an answer to the event picker: list-item id, number or event name. */
export function resolvePick(answer: { selection?: string; text: string }, live: readonly PortraitEvent[]): PortraitEvent | undefined {
  if (answer.selection) {
    const id = answer.selection.replace(/^event:/, "");
    const hit = live.find((e) => e.slug === id);
    if (hit) return hit;
  }
  const t = normalize(answer.text);
  const n = Number.parseInt(t, 10);
  if (String(n) === t && n >= 1 && n <= live.length) return live[n - 1];
  return live.find((e) => normalize(e.config.name) === t) ?? findCode(answer.text, live);
}
