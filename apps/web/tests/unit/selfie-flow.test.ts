import { describe, expect, it } from "vitest";
import { catalogs } from "@/i18n";
import { ACTION_OPTION } from "@/lib/conversation/actions";
import { afterOptIn, backgroundMenu, handleSelfieFlow, pickOption, styleMenu, styleOptions } from "@/lib/conversation/selfie";
import { newSession, type Session } from "@/lib/conversation/session";
import { defaultConfig, type EventConfigInput, type PortraitEvent } from "@/lib/events/schema";

const now = new Date("2026-10-13T12:00:00Z");
const c = catalogs.en;
const event = (over: Partial<EventConfigInput> = {}): PortraitEvent => ({
  slug: "ev", state: "live", config: { ...defaultConfig("SIGNAL London", "+13203780782"), ...over },
  uploads: { frame: null, background: null }, printerTokenHash: null, printerToken: null,
  createdAt: now.toISOString(), updatedAt: now.toISOString(),
});
const ready = (over: Partial<Session> = {}): Session => ({ ...newSession("en", now), step: "ready", optedIn: true, ...over });
const photo = (blob = "events/ev/selfies/a.jpg", newJobId = "job_new_0001") => ({ text: "", images: 1, selfieBlob: blob, newJobId });
const text = (t: string, selection?: string) => ({ text: t, selection, images: 0, newJobId: "unused_0001" });

describe("photo arrives (SPEC §5.5, checks first: D-18)", () => {
  it("creates a screening job and sends NO menu yet", () => {
    const r = handleSelfieFlow(ready(), event(), c, photo());
    expect(r.effects).toEqual([{ type: "create-job", jobId: "job_new_0001", selfieBlob: "events/ev/selfies/a.jpg" }]);
    expect(r.session).toMatchObject({ step: "screening", pendingJobId: "job_new_0001", counters: { inFlight: 1 } });
    expect(r.messages).toEqual([{ kind: "text", body: c.selfie.checking }]);
    expect(r.messages.some((m) => m.kind !== "text")).toBe(false); // no style list/buttons
  });

  it("asks for one photo at a time", () => {
    expect(handleSelfieFlow(ready(), event(), c, { ...photo(), images: 2 }).messages[0]).toMatchObject({ body: c.selfie.oneAtATime });
  });

  it("refuses when the quota is used up, counting in-flight jobs", () => {
    const s = ready({ counters: { delivered: 2, printed: 0, printsReserved: 0, inFlight: 1 } });
    const r = handleSelfieFlow(s, event({ maxImagesPerPerson: 3 }), c, photo());
    expect(r.messages[0]!.body).toContain("already used your 3 free portraits");
    expect(r.effects).toEqual([{ type: "discard-blob", blobPath: "events/ev/selfies/a.jpg" }]);
  });

  it("a new photo supersedes the pending one without using another slot", () => {
    const s = ready({ step: "awaiting_style", pendingJobId: "job_old_0001", counters: { delivered: 0, printed: 0, printsReserved: 0, inFlight: 1 } });
    const r = handleSelfieFlow(s, event({ maxImagesPerPerson: 1 }), c, photo("events/ev/selfies/new.jpg", "job_new_0002"));
    expect(r.effects).toEqual([{ type: "supersede-job", jobId: "job_old_0001" }, { type: "create-job", jobId: "job_new_0002", selfieBlob: "events/ev/selfies/new.jpg" }]);
    expect(r.session.counters.inFlight).toBe(1);
  });

  it("text while the photo is checked gets a 'still checking' reply", () => {
    expect(handleSelfieFlow(ready({ step: "screening", pendingJobId: "job_x_0001" }), event(), c, text("hello?")).messages[0]).toMatchObject({ body: c.selfie.stillChecking });
  });
});

describe("menus after screening (SPEC §5.5)", () => {
  const screened = (step: "awaiting_style" | "awaiting_background", over: Partial<Session> = {}) => ready({ step, pendingJobId: "job_p_0001", ...over });

  it("style by number/name/alias, then the background menu", () => {
    const ev = event({ backgrounds: ["gradient", "solid-white"] });
    const r = handleSelfieFlow(screened("awaiting_style"), ev, c, text("retro"));
    expect(r.effects).toEqual([{ type: "choose", jobId: "job_p_0001", style: "pixel-art", start: false }]);
    expect(r.session).toMatchObject({ step: "awaiting_background", style: "pixel-art" });
    expect(r.messages[0]).toMatchObject({ body: c.menus.backgroundBody });
  });

  it("background completes the choice and starts generation", () => {
    const r = handleSelfieFlow(screened("awaiting_background", { style: "anime" }), event({ backgrounds: ["gradient", "solid-white"] }), c, text("", "opt:solid-white"));
    expect(r.effects).toEqual([{ type: "choose", jobId: "job_p_0001", style: "anime", background: "solid-white", start: true }]);
    expect(r.messages).toEqual([{ kind: "text", body: c.job.started }]);
    expect(r.session).toMatchObject({ step: "ready", pendingJobId: null });
  });

  it("skips the background menu when the event has only one", () => {
    const r = handleSelfieFlow(screened("awaiting_style"), event({ backgrounds: ["original"] }), c, text("2"));
    expect(r.effects).toEqual([{ type: "choose", jobId: "job_p_0001", style: "pop-art", background: "original", start: true }]);
  });

  it("re-sends the menu on an invalid answer", () => {
    const r = handleSelfieFlow(screened("awaiting_style"), event(), c, text("banana"));
    expect(r.messages.map((m) => m.kind)).toEqual(["text", "list"]);
    expect(r.effects).toEqual([]);
  });

  it("free text when nothing is pending is left to the chat reply", () => {
    expect(handleSelfieFlow(ready(), event(), c, text("what is this?")).handled).toBe(false);
  });

  it("menu builders: list for 4+ options with numbered SMS text, buttons for ≤3", () => {
    const list = styleMenu(event(), c, "job_menu_01");
    expect(list.kind).toBe("list");
    if (list.kind === "list") expect(list.smsBody).toMatch(/1\. Cartoon[\s\S]*6\. Pixel Art/);
    // The ids name the photo, so the menu still works after newer messages (D-48).
    if (list.kind === "list") expect(list.items[0]!.id).toBe(ACTION_OPTION.style("cartoon", "job_menu_01"));
    expect(backgroundMenu(event({ backgrounds: ["gradient", "original"] }), c, "job_menu_01").kind).toBe("buttons");
  });
});

describe("the hidden ALL keyword (D-49)", () => {
  it("is not mentioned in the style menu, its SMS text or the background menu, in any language", () => {
    for (const cat of [catalogs.en, catalogs.pt_BR]) {
      const text = JSON.stringify([styleMenu(event(), cat, "job_menu_01"), backgroundMenu(event(), cat, "job_menu_01"), cat.menus.styleBody, cat.menus.replyWithNumber, cat.menus.invalidChoice, cat.selfie]);
      expect(text).not.toMatch(/\b(all|todos|tudo)\b/i);
    }
  });

  it("is not a style name, so the normal flow treats it as an invalid choice", () => {
    expect(pickOption(styleOptions(event(), c), { text: "all" })).toBeUndefined();
    expect(pickOption(styleOptions(event(), catalogs.pt_BR), { text: "todos" })).toBeUndefined();
  });
});

describe("afterOptIn", () => {
  it("asks for a selfie when none is pending", () => {
    expect(afterOptIn(ready(), event(), c, "job_a_0001").messages[0]).toMatchObject({ body: c.selfie.ask });
  });
  it("screens the selfie sent before consent", () => {
    const r = afterOptIn(ready({ pendingSelfie: "events/ev/selfies/early.jpg" }), event(), c, "job_a_0002");
    expect(r.messages.map((m) => m.body)).toEqual([c.selfie.usingPending, c.selfie.checking]);
    expect(r.effects).toEqual([{ type: "create-job", jobId: "job_a_0002", selfieBlob: "events/ev/selfies/early.jpg" }]);
  });
});

describe("pickOption", () => {
  const opts = styleOptions(event(), catalogs.pt_BR);
  it("matches Portuguese names and aliases, ignoring accents", () => {
    expect(pickOption(opts, { text: "esboco" })).toBe("sketch");
    expect(pickOption(opts, { text: "LÁPIS" })).toBe("sketch");
    expect(pickOption(opts, { text: "0" })).toBeUndefined();
  });
});
