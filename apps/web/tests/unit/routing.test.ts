import { describe, expect, it } from "vitest";
import { findCode, resolvePick, route } from "@/lib/conversation/routing";
import { matchesKeyword, normalize } from "@/lib/conversation/text";
import { defaultConfig, type EventState, type PortraitEvent } from "@/lib/events/schema";

const ev = (slug: string, state: EventState, name = slug): PortraitEvent => ({
  slug,
  state,
  config: { ...defaultConfig(name, "+13203780782") },
  uploads: { frame: null, background: null },
  printerTokenHash: null,
  printerTokenCreatedAt: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
});
const bind = (slug: string) => ({ eventSlug: slug, boundAt: "2026-10-01T00:00:00.000Z" });

describe("route (SPEC §5.2)", () => {
  const london = ev("splondon", "live", "SIGNAL London");
  const paris = ev("paris", "live", "Paris Summit");

  it("binds on a live event code, even with other live events", () => {
    expect(route("Hi! I want my AI portrait 🎨 #SPLONDON", [london, paris], null)).toEqual({ kind: "event", event: london, bind: true });
  });
  it("re-binds when a code for another live event arrives", () => {
    expect(route("#paris", [london, paris], bind("splondon"))).toEqual({ kind: "event", event: paris, bind: true });
  });
  it("does not re-bind to the same event", () => {
    expect(route("#splondon hello", [london, paris], bind("splondon"))).toMatchObject({ bind: false });
  });
  it("uses the bound live event when there is no code", () => {
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
  it("gives the state reply for a coded event on break", () => {
    const onBreak = ev("splondon", "break");
    expect(route("#splondon", [onBreak], null)).toEqual({ kind: "not-live", event: onBreak });
  });
  it("treats draft events as non-existent, even by code or binding", () => {
    const draft = ev("secret", "draft");
    expect(route("#secret", [draft], null)).toEqual({ kind: "none" });
    expect(route("hi", [draft, london], bind("secret"))).toEqual({ kind: "event", event: london, bind: true });
  });
  it("matches dashed slugs", () => {
    const dashed = ev("sp-london", "live");
    expect(findCode("hey #SP-LONDON", [dashed, paris])).toBe(dashed);
    expect(findCode("SP LONDON is cool", [dashed])).toBe(dashed);
  });
  it("does not match a code inside another word", () => {
    expect(findCode("comparison", [ev("paris", "live")])).toBeUndefined();
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
