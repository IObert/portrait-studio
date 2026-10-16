import { describe, expect, it } from "vitest";
import { findEvent, resolvePick, route } from "@/lib/conversation/routing";
import { matchesKeyword, normalize } from "@/lib/conversation/text";
import { defaultConfig, type EventState, type PortraitEvent } from "@/lib/events/schema";

const ev = (slug: string, state: EventState, name = slug): PortraitEvent => ({
  slug,
  state,
  config: { ...defaultConfig(name, "+13203780782") },
  uploads: { frame: null, background: null },
  printerTokenHash: null, printerToken: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
});
const bind = (slug: string) => ({ eventSlug: slug, boundAt: "2026-10-01T00:00:00.000Z" });

describe("route (SPEC §5.2)", () => {
  const london = ev("splondon", "live", "SIGNAL London");
  const paris = ev("paris", "live", "Paris Summit");

  it("binds on a live event's name, even with other live events", () => {
    expect(route("Hi! I want my portrait SIGNAL LONDON", [london, paris], null)).toEqual({ kind: "event", event: london, bind: true });
  });
  it("re-binds when another live event is named", () => {
    expect(route("#Paris Summit", [london, paris], bind("splondon"))).toEqual({ kind: "event", event: paris, bind: true });
  });
  it("does not re-bind to the same event", () => {
    expect(route("signal london hello", [london, paris], bind("splondon"))).toMatchObject({ bind: false });
  });
  it("uses the bound live event when no event is named", () => {
    expect(route("hello", [london, paris], bind("paris"))).toEqual({ kind: "event", event: paris, bind: false });
  });
  it("uses and binds the only live event", () => {
    expect(route("hello", [london, ev("x", "draft")], null)).toEqual({ kind: "event", event: london, bind: true });
  });
  it("asks to pick when several events are live, sorted by name", () => {
    const r = route("hello", [paris, london], null);
    expect(r.kind).toBe("pick");
    if (r.kind === "pick") expect(r.live.map((e) => e.slug)).toEqual(["paris", "splondon"]);
  });
  it("replies no-active-event when nothing is live", () => {
    expect(route("hello", [ev("a", "draft"), ev("b", "ended")], null)).toEqual({ kind: "none" });
  });
  it("gives the state reply for a bound event on break or ended", () => {
    const onBreak = ev("splondon", "break");
    expect(route("hello", [onBreak, paris], bind("splondon"))).toEqual({ kind: "not-live", event: onBreak });
  });
  it("gives the state reply for a named event on break", () => {
    const onBreak = ev("splondon", "break", "SIGNAL London");
    expect(route("SIGNAL London", [onBreak], null)).toEqual({ kind: "not-live", event: onBreak });
  });
  it("treats draft events as non-existent, even by name or binding", () => {
    const draft = ev("secret", "draft", "Secret Launch");
    expect(route("Secret Launch", [draft], null)).toEqual({ kind: "none" });
    expect(route("hi", [draft, london], bind("secret"))).toEqual({ kind: "event", event: london, bind: true });
  });
  it("never matches the internal ID, only the name (D-35)", () => {
    const named = ev("sp-london-2", "live", "SIGNAL London");
    expect(findEvent("hey sp-london-2", [named])).toBeUndefined();
    expect(findEvent("hey #SP-LONDON-2", [named])).toBeUndefined();
    expect(findEvent("hey signal london", [named])).toBe(named);
  });
  it("matches the event by its full name, no hashtag (QR prefill)", () => {
    const london = ev("splondon", "live", "SIGNAL London");
    const paris = ev("paris", "live", "Paris Summit");
    expect(findEvent("Hi! I'm at SIGNAL London and want to try Portrait Studio 🎨", [london, paris])).toBe(london);
    expect(findEvent("hey signal london!", [london, paris])).toBe(london);
    expect(route("Hi! I'm at Paris Summit and want to try Portrait Studio 🎨", [london, paris], null)).toEqual({ kind: "event", event: paris, bind: true });
  });

  it("prefers the longest matching name", () => {
    const short = ev("lon", "live", "London");
    const long = ev("splondon", "live", "SIGNAL London");
    expect(findEvent("SIGNAL London", [short, long])).toBe(long);
  });

  it("does not match a name inside another word", () => {
    expect(findEvent("comparison", [ev("paris", "live", "Paris")])).toBeUndefined();
  });
});

describe("resolvePick", () => {
  const live = [ev("paris", "live", "Paris Summit"), ev("splondon", "live", "SIGNAL London")];
  it("accepts a list item id, a number or the event name", () => {
    expect(resolvePick({ selection: "event:splondon", text: "" }, live)?.slug).toBe("splondon");
    expect(resolvePick({ text: "2" }, live)?.slug).toBe("splondon");
    expect(resolvePick({ text: "paris summit" }, live)?.slug).toBe("paris");
    expect(resolvePick({ text: "3" }, live)).toBeUndefined();
    expect(resolvePick({ text: "rome" }, live)).toBeUndefined();
  });
});

describe("normalize / matchesKeyword", () => {
  it("ignores case, accents and punctuation", () => {
    expect(normalize("  Esboço! ")).toBe("esboco");
    expect(matchesKeyword("NOVO CÓDIGO", ["novo código"])).toBe(true);
    expect(matchesKeyword("I agree.", ["i agree"])).toBe(true);
    expect(matchesKeyword("I agree with nothing", ["i agree"])).toBe(false);
    expect(matchesKeyword("", ["ok"])).toBe(false);
  });
});
