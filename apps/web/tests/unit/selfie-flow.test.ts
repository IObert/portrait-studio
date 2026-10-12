import { describe, expect, it } from "vitest";
import { catalogs } from "@/i18n";
import { afterOptIn, handleSelfieFlow, pickOption, styleOptions } from "@/lib/conversation/selfie";
import { newSession, type Session } from "@/lib/conversation/session";
import { defaultConfig, type EventConfigInput, type PortraitEvent } from "@/lib/events/schema";

const now = new Date("2026-10-10T12:00:00Z");
const c = catalogs.en;
const event = (over: Partial<EventConfigInput> = {}): PortraitEvent => ({
  slug: "ev",
  state: "live",
  config: { ...defaultConfig("SIGNAL London", "+13203780782"), ...over },
  uploads: { frame: null, background: null },
  printerTokenHash: null,
  printerTokenCreatedAt: null,
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
});
const ready = (over: Partial<Session> = {}): Session => ({ ...newSession("en", now), step: "ready", optedIn: true, ...over });
const selfie = (blob = "events/ev/selfies/a.jpg") => ({ text: "", images: 1, selfieBlob: blob });

describe("selfie flow (SPEC §5.5)", () => {
  it("asks for one selfie at a time", () => {
    const r = handleSelfieFlow(ready(), event(), c, { text: "", images: 2 });
    expect(r.messages[0]).toMatchObject({ body: c.selfie.oneAtATime });
    expect(r.effects).toEqual([]);
  });

  it("refuses when the quota is used up, counting in-flight jobs", () => {
    const s = ready({ counters: { delivered: 2, printed: 0, printsReserved: 0, inFlight: 1 } });
    const r = handleSelfieFlow(s, event({ maxImagesPerPerson: 3 }), c, selfie());
    expect(r.messages[0]!.body).toContain("already used your 3 free portraits");
    expect(r.effects).toEqual([{ type: "discard-blob", blobPath: "events/ev/selfies/a.jpg" }]);
  });

  it("shows a list picker for 4+ styles and a numbered SMS fallback", () => {
    const r = handleSelfieFlow(ready(), event(), c, selfie());
    expect(r.session.step).toBe("awaiting_style");
    const m = r.messages[0]!;
    expect(m.kind).toBe("list");
    if (m.kind === "list") {
      expect(m.items).toHaveLength(6);
      expect(m.smsBody).toContain("1. Cartoon");
      expect(m.smsBody).toContain("6. Pixel Art");
    }
  });

  it("uses quick-reply buttons for up to 3 options", () => {
    const r = handleSelfieFlow(ready(), event({ styles: ["anime", "sketch"] }), c, selfie());
    expect(r.messages[0]).toMatchObject({ kind: "buttons", buttons: [{ id: "opt:anime" }, { id: "opt:sketch" }] });
  });

  it("skips both menus when the event has one style and one background", () => {
    const r = handleSelfieFlow(ready(), event({ styles: ["anime"], backgrounds: ["gradient"] }), c, selfie());
    expect(r.effects).toEqual([{ type: "create-job", selfieBlob: "events/ev/selfies/a.jpg", style: "anime", background: "gradient" }]);
    expect(r.messages[0]).toMatchObject({ body: c.job.started });
    expect(r.session).toMatchObject({ step: "ready", pendingSelfie: null, counters: { inFlight: 1 } });
  });

  it("walks style then background, by number, name, alias or button", () => {
    const ev = event({ backgrounds: ["gradient", "solid-white"] });
    const s1 = handleSelfieFlow(ready(), ev, c, selfie()).session;
    const s2 = handleSelfieFlow(s1, ev, c, { text: "retro", images: 0 }).session; // alias of Pixel Art
    expect(s2).toMatchObject({ step: "awaiting_background", style: "pixel-art" });
    const done = handleSelfieFlow(s2, ev, c, { text: "", selection: "opt:solid-white", images: 0 });
    expect(done.effects).toEqual([{ type: "create-job", selfieBlob: "events/ev/selfies/a.jpg", style: "pixel-art", background: "solid-white" }]);
  });

  it("re-sends the menu on an invalid answer", () => {
    const s1 = handleSelfieFlow(ready(), event(), c, selfie()).session;
    const r = handleSelfieFlow(s1, event(), c, { text: "banana", images: 0 });
    expect(r.session.step).toBe("awaiting_style");
    expect(r.messages.map((m) => m.kind)).toEqual(["text", "list"]);
    expect(r.messages[0]!.body).toBe(c.menus.invalidChoice);
    expect(handleSelfieFlow(s1, event(), c, { text: "7", images: 0 }).session.step).toBe("awaiting_style");
  });

  it("replaces the pending selfie when a new one arrives during a menu", () => {
    const s1 = handleSelfieFlow(ready(), event(), c, selfie("events/ev/selfies/old.jpg")).session;
    const r = handleSelfieFlow(s1, event(), c, selfie("events/ev/selfies/new.jpg"));
    expect(r.session.pendingSelfie).toBe("events/ev/selfies/new.jpg");
    expect(r.effects).toContainEqual({ type: "discard-blob", blobPath: "events/ev/selfies/old.jpg" });
  });

  it("leaves free text to the chat reply (SPEC §5.10)", () => {
    expect(handleSelfieFlow(ready(), event(), c, { text: "what is this?", images: 0 }).handled).toBe(false);
  });
});

describe("afterOptIn", () => {
  it("asks for a selfie when none is pending", () => {
    expect(afterOptIn(ready(), event(), c).messages[0]).toMatchObject({ body: c.selfie.ask });
  });
  it("continues with the selfie sent before consent", () => {
    const r = afterOptIn(ready({ pendingSelfie: "events/ev/selfies/early.jpg" }), event({ styles: ["anime"], backgrounds: ["original"] }), c);
    expect(r.messages[0]).toMatchObject({ body: c.selfie.usingPending });
    expect(r.effects).toEqual([{ type: "create-job", selfieBlob: "events/ev/selfies/early.jpg", style: "anime", background: "original" }]);
  });
});

describe("pickOption", () => {
  const opts = styleOptions(event(), catalogs.pt_BR);
  it("matches Portuguese names and aliases, ignoring accents", () => {
    expect(pickOption(opts, { text: "esboco" })).toBe("sketch");
    expect(pickOption(opts, { text: "LÁPIS" })).toBe("sketch");
    expect(pickOption(opts, { text: "aquarela" })).toBe("watercolor");
    expect(pickOption(opts, { text: "0" })).toBeUndefined();
  });
});
