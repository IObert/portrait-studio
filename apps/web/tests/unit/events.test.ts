import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { checkBasicAuth } from "@/lib/auth/basic";
import { generatePrinterToken, hashToken, normalizeToken, slugFromToken, verifyPrinterToken } from "@/lib/auth/printer-token";
import { deleteEvent } from "@/lib/events/delete";
import { canTransition, EventRepo, InvalidTransition, SlugTaken } from "@/lib/events/repo";
import { crossCheckUploads, defaultConfig, EventConfigInputSchema } from "@/lib/events/schema";
import { validateBackground, validateFrame } from "@/lib/images/validate-upload";
import { eventObjects, Global } from "@/lib/sync/names";
import { SyncStore } from "@/lib/sync/store";
import { FakeBlob } from "../support/fake-blob";
import { FakeSync } from "../support/fake-sync";

async function repo() {
  const fake = new FakeSync();
  const sync = new SyncStore(fake, { warn: vi.fn() }, { baseDelayMs: 1, maxDelayMs: 2 });
  const events = new EventRepo(sync);
  await events.init();
  return { fake, sync, events };
}
const cfg = () => defaultConfig("SIGNAL London", "+13203780782");

describe("event config validation", () => {
  it("accepts the defaults", () => {
    expect(EventConfigInputSchema.safeParse(cfg()).success).toBe(true);
  });
  it("requires at least one style and background", () => {
    const r = EventConfigInputSchema.safeParse({ ...cfg(), styles: [], backgrounds: [] });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.path[0])).toEqual(expect.arrayContaining(["styles", "backgrounds"]));
  });
  it("only allows a promo when printing is on", () => {
    const r = EventConfigInputSchema.safeParse({ ...cfg(), promo: { enabled: true, text: "20% off" } });
    expect(r.success).toBe(false);
    expect(EventConfigInputSchema.safeParse({ ...cfg(), printingEnabled: true, promo: { enabled: true, text: "x" } }).success).toBe(true);
  });
  it("rejects unknown styles and non-E.164 senders", () => {
    expect(EventConfigInputSchema.safeParse({ ...cfg(), styles: ["sticker"] }).success).toBe(false);
    expect(EventConfigInputSchema.safeParse({ ...cfg(), qrSender: "3203780782" }).success).toBe(false);
  });
  it("cannot select an uploaded frame or background before uploading one", () => {
    const c = { ...cfg(), frame: "uploaded" as const, backgrounds: ["uploaded" as const], uploadedBackgroundName: "Stage" };
    expect(crossCheckUploads(c, { frame: null, background: null })).toEqual({
      frame: expect.any(String),
      backgrounds: expect.any(String),
    });
  });
});

describe("EventRepo", () => {
  it("creates drafts with immutable, unique slugs", async () => {
    const { events } = await repo();
    const e = await events.create("sp-london", cfg());
    expect(e.state).toBe("draft");
    await expect(events.create("sp-london", cfg())).rejects.toBeInstanceOf(SlugTaken);
  });

  it("enforces manual state transitions", async () => {
    const { events } = await repo();
    await events.create("ev", cfg());
    await expect(events.setState("ev", "break")).rejects.toBeInstanceOf(InvalidTransition);
    expect((await events.setState("ev", "live")).state).toBe("live");
    expect((await events.setState("ev", "break")).state).toBe("break");
    expect((await events.setState("ev", "ended")).state).toBe("ended");
    expect(canTransition("draft", "ended")).toBe(false);
  });

  it("keeps slug and createdAt when config changes", async () => {
    const { events } = await repo();
    const created = await events.create("ev", cfg());
    const updated = await events.updateConfig("ev", { ...cfg(), name: "Renamed" });
    expect(updated).toMatchObject({ slug: "ev", createdAt: created.createdAt, config: { name: "Renamed" } });
  });

  it("does not lose concurrent edits to different fields", async () => {
    const { events } = await repo();
    await events.create("ev", cfg());
    await Promise.all([
      events.setState("ev", "live"),
      events.updateConfig("ev", { ...cfg(), name: "New name" }),
      events.setPrinterToken("ev", "ev.AAAA-AAAA-AAAA-AAAA", "a".repeat(64)),
    ]);
    const e = await events.require("ev");
    expect(e.state).toBe("live");
    expect(e.printerTokenHash).toBe("a".repeat(64));
  });
});

describe("deleteEvent", () => {
  it("removes every per-event object, blobs, assets and the event, then audits without PII", async () => {
    const { fake, sync, events } = await repo();
    await events.create("ev", cfg());
    await events.create("other", cfg());
    const ev = eventObjects("ev");
    for (const m of ev.allMaps()) await sync.ensureMap(m);
    await fake.putDocument(ev.printer, { status: "idle" });
    await sync.ensureMap(eventObjects("other").jobs);
    const blob = new FakeBlob();
    await blob.put("events/ev/selfies/a.jpg", Buffer.from("x"), "image/jpeg");
    await blob.put("assets/events/ev/frame.png", Buffer.from("x"), "image/png");
    await blob.put("events/other/selfies/a.jpg", Buffer.from("x"), "image/jpeg");
    const hooks = { removeBindings: vi.fn(async () => {}), unlinkProfiles: vi.fn(async () => {}) };
    const audit = { info: vi.fn() };

    await deleteEvent({ sync, blob, events, hooks, audit }, "ev");

    expect([...fake.maps.keys()].filter((m) => m.startsWith(ev.prefix))).toEqual([]);
    expect(fake.docs.has(ev.printer)).toBe(false);
    expect(fake.maps.has(eventObjects("other").jobs)).toBe(true);
    expect([...blob.blobs.keys()]).toEqual(["events/other/selfies/a.jpg"]);
    expect(await events.get("ev")).toBeNull();
    expect(await events.get("other")).not.toBeNull();
    expect(fake.maps.get(Global.events)!.has("other")).toBe(true);
    expect(hooks.removeBindings).toHaveBeenCalledWith("ev");
    expect(hooks.unlinkProfiles).toHaveBeenCalledWith("ev");
    expect(audit.info).toHaveBeenCalledWith(
      { event: "event_deleted", slug: "ev", blobsDeleted: 2, at: expect.any(String) },
      expect.any(String),
    );
  });

  it("keeps the event visible if a step fails, so it can be retried", async () => {
    const { sync, events } = await repo();
    await events.create("ev", cfg());
    const hooks = { removeBindings: vi.fn(async () => { throw new Error("boom"); }), unlinkProfiles: vi.fn(async () => {}) };
    await expect(deleteEvent({ sync, blob: new FakeBlob(), events, hooks, audit: { info: vi.fn() } }, "ev")).rejects.toThrow();
    expect(await events.get("ev")).not.toBeNull();
  });
});

describe("printer token", () => {
  it("is short, typeable and verified in constant time against its hash (D-33)", () => {
    const { token, hash } = generatePrinterToken("sp-london");
    expect(token).toMatch(/^sp-london\.[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(slugFromToken(token)).toBe("sp-london");
    expect(verifyPrinterToken(token, hash)).toBe(true);
    // Always change the last character (it may already be "A").
    const tampered = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    expect(verifyPrinterToken(tampered, hash)).toBe(false);
    expect(verifyPrinterToken(token, null)).toBe(false);
    expect(slugFromToken("../etc.AAAA-AAAA-AAAA-AAAA")).toBeNull();
    expect(slugFromToken("pst_../etc_" + "a".repeat(43))).toBeNull();
  });
  it("forgives case, spacing, missing dashes and look-alike letters when typed", () => {
    const hash = hashToken("sp-london.K7QM-2XH0-9RTB-W41Z");
    for (const typed of ["sp-london.k7qm-2xh0-9rtb-w41z", " sp-london.K7QM2XH09RTBW41Z ", "SP-LONDON.K7QM 2XHO 9RTB W4lZ", "sp-london.K7QM-2XHO-9RTB-W4IZ"])
      expect(verifyPrinterToken(typed, hash), typed).toBe(true);
    expect(normalizeToken("sp-london.K7QM-2XH0-9RTB")).toBeNull();
    expect(normalizeToken("sp-london.K7QM-2XH0-9RTB-W4UZ")).toBeNull();
  });
  it("still accepts a token issued before D-33 until it is rotated", () => {
    const legacy = "pst_sp-london_" + "a".repeat(43);
    expect(slugFromToken(legacy)).toBe("sp-london");
    expect(verifyPrinterToken(legacy, hashToken(legacy))).toBe(true);
  });
  it("rotating produces a different token", () => {
    expect(generatePrinterToken("a").token).not.toBe(generatePrinterToken("a").token);
  });
});

describe("basic auth", () => {
  const h = (u: string, p: string) => `Basic ${btoa(`${u}:${p}`)}`;
  it("accepts the configured credentials only", async () => {
    expect(await checkBasicAuth(h("admin", "pw:with:colons"), "admin", "pw:with:colons")).toBe(true);
    expect(await checkBasicAuth(h("admin", "nope"), "admin", "pw")).toBe(false);
    expect(await checkBasicAuth(h("root", "pw"), "admin", "pw")).toBe(false);
    expect(await checkBasicAuth("Bearer x", "admin", "pw")).toBe(false);
    expect(await checkBasicAuth("Basic !!!", "admin", "pw")).toBe(false);
  });
  it("fails closed when not configured", async () => {
    expect(await checkBasicAuth(h("", ""), undefined, undefined)).toBe(false);
    expect(await checkBasicAuth(h("admin", ""), "admin", "")).toBe(false);
  });
});

describe("upload validation", () => {
  const png = (w: number, h: number, alpha: boolean, window = true) =>
    sharp({ create: { width: w, height: h, channels: alpha ? 4 : 3, background: alpha ? { r: 0, g: 0, b: 0, alpha: 1 } : "#000" } })
      .composite(alpha && window ? [{ input: Buffer.from(`<svg width="${w}" height="${h}"><rect x="100" y="100" width="200" height="200" fill="black"/></svg>`), blend: "dest-out" }] : [])
      .png()
      .toBuffer();

  it("accepts a 1200×1800 PNG frame with a transparent window", async () => {
    expect((await validateFrame(await png(1200, 1800, true))).ok).toBe(true);
  });
  it("rejects frames with the wrong size, no alpha, no window or wrong format", async () => {
    expect(await validateFrame(await png(1000, 1500, true))).toMatchObject({ ok: false, error: expect.stringMatching(/1200×1800/) });
    expect(await validateFrame(await png(1200, 1800, false))).toMatchObject({ ok: false, error: expect.stringMatching(/alpha/) });
    expect(await validateFrame(await png(1200, 1800, true, false))).toMatchObject({ ok: false, error: expect.stringMatching(/transparent window/) });
    const jpg = await sharp({ create: { width: 1200, height: 1800, channels: 3, background: "#000" } }).jpeg().toBuffer();
    expect(await validateFrame(jpg)).toMatchObject({ ok: false, error: expect.stringMatching(/PNG/) });
    expect(await validateFrame(Buffer.from("not an image"))).toMatchObject({ ok: false });
  });
  it("accepts portrait backgrounds of at least 1024×1536 and rejects others", async () => {
    const jpg = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: "#123" } }).jpeg().toBuffer();
    expect(await validateBackground(await jpg(1024, 1536))).toMatchObject({ ok: true, contentType: "image/jpeg" });
    expect(await validateBackground(await jpg(2000, 3000))).toMatchObject({ ok: true });
    expect(await validateBackground(await jpg(800, 1200))).toMatchObject({ ok: false, error: expect.stringMatching(/at least/) });
    expect(await validateBackground(await jpg(3000, 2000))).toMatchObject({ ok: false, error: expect.stringMatching(/portrait/) });
  });
  it("uses the upright size of rotated JPEGs", async () => {
    const rotated = await sharp({ create: { width: 1536, height: 1024, channels: 3, background: "#123" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    expect(await validateBackground(rotated)).toMatchObject({ ok: true, width: 1024, height: 1536 });
  });
});
