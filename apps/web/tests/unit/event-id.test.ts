import { describe, expect, it } from "vitest";
import { eventIdCandidate, eventIdFromName } from "@/lib/events/event-id";
import { SlugSchema } from "@/lib/sync/names";

describe("event ID from the name (D-35)", () => {
  it.each([
    ["Twilio SIGNAL London", "twilio-signal-london"],
    ["São Paulo Summit 2026", "sao-paulo-summit-2026"],
    ["  Hack_Night @ Berlin!! ", "hack-night-berlin"],
    ["Café — Crème Brûlée", "cafe-creme-brulee"],
    ["🎉🎉", "event"],
    ["", "event"],
  ])("%j → %s", (name, id) => {
    expect(eventIdFromName(name)).toBe(id);
  });

  it("is always a valid ID, also for long names and with a suffix", () => {
    const long = "A very long event name that goes on and on beyond forty characters";
    const id = eventIdFromName(long);
    expect(id.length).toBeLessThanOrEqual(36);
    expect(id.endsWith("-")).toBe(false);
    for (const n of [1, 2, 99]) expect(SlugSchema.safeParse(eventIdCandidate(id, n)).success, `${n}`).toBe(true);
    expect(eventIdCandidate("x", 1)).toBe("x");
    expect(eventIdCandidate("x", 3)).toBe("x-3");
  });
});
