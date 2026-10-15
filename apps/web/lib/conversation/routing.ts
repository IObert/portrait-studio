import type { PortraitEvent } from "../events/schema";
import { normalize } from "./text";

export interface Binding {
  eventSlug: string;
  boundAt: string;
}

/** Result of mapping a message to an event (SPEC §5.2). */
export type Route =
  | { kind: "event"; event: PortraitEvent; bind: boolean }
  /** Bound or named event is on break or ended: reply with that state's message. */
  | { kind: "not-live"; event: PortraitEvent }
  | { kind: "pick"; live: PortraitEvent[] }
  | { kind: "none" };

/**
 * Finds the event a message names (SPEC §5.2): its full name, as whole
 * words, case- and accent-insensitive. No hashtag needed. The internal ID is
 * never matched: attendees never see it (D-35). The longest name wins (so
 * "SIGNAL London" beats "London").
 */
export function findEvent(text: string, events: readonly PortraitEvent[]): PortraitEvent | undefined {
  const hay = ` ${normalize(text).replace(/#/g, " ").replace(/\s+/g, " ")} `;
  const has = (needle: string) => {
    const n = normalize(needle).replace(/#/g, " ").replace(/\s+/g, " ").trim();
    return n.length >= 2 && hay.includes(` ${n} `);
  };
  return events.filter((e) => has(e.config.name)).sort((a, b) => b.config.name.length - a.config.name.length)[0];
}

/**
 * Event routing (SPEC §5.2). Draft events are invisible. Naming a live event
 * binds (or re-binds) the address; naming a non-live event gets that state's
 * reply.
 */
export function route(text: string, events: readonly PortraitEvent[], binding: Binding | null): Route {
  const visible = events.filter((e) => e.state !== "draft");
  const live = visible.filter((e) => e.state === "live");

  const named = findEvent(text, visible);
  if (named) return named.state === "live" ? { kind: "event", event: named, bind: binding?.eventSlug !== named.slug } : { kind: "not-live", event: named };

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
  return live.find((e) => normalize(e.config.name) === t) ?? findEvent(answer.text, live);
}
