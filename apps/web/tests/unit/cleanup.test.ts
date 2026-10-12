import { describe, expect, it, vi } from "vitest";
import { removeBindings, unlinkProfiles } from "@/lib/events/cleanup";
import { eventObjects, Global } from "@/lib/sync/names";
import { SyncStore } from "@/lib/sync/store";
import { FakeSync } from "../support/fake-sync";

async function setup() {
  const fake = new FakeSync();
  const sync = new SyncStore(fake, { warn: vi.fn() }, { baseDelayMs: 1, maxDelayMs: 2 });
  for (const m of [Global.bindings, Global.profileLinks, eventObjects("ev").leads, eventObjects("other").leads]) await sync.ensureMap(m);
  return { fake, sync };
}

describe("removeBindings", () => {
  it("removes only bindings to the event", async () => {
    const { fake, sync } = await setup();
    await fake.createItem(Global.bindings, "whatsapp:+1", { eventSlug: "ev", boundAt: "2026-10-10T00:00:00Z" });
    await fake.createItem(Global.bindings, "sms:+2", { eventSlug: "other", boundAt: "2026-10-10T00:00:00Z" });
    expect(await removeBindings(sync, "ev")).toBe(1);
    expect(await fake.getItem(Global.bindings, "whatsapp:+1")).toBeNull();
    expect(await fake.getItem(Global.bindings, "sms:+2")).not.toBeNull();
  });
});

describe("unlinkProfiles (shared Memory store, D-12)", () => {
  it("deletes profiles linked to no other event and keeps shared ones", async () => {
    const { fake, sync } = await setup();
    const memory = { lookup: vi.fn(), upsert: vi.fn(), deleteProfile: vi.fn(async () => {}) };
    await fake.createItem(eventObjects("ev").leads, "whatsapp:+1", { memoryProfileId: "mem_only_ev", optedInAt: "x", method: "verified_email" });
    await fake.createItem(eventObjects("ev").leads, "whatsapp:+2", { memoryProfileId: "mem_both", optedInAt: "x", method: "returning" });
    await fake.createItem(eventObjects("ev").leads, "whatsapp:+3", { memoryProfileId: null, optedInAt: "x", method: "agree_only" });
    await fake.createItem(Global.profileLinks, "mem_only_ev", { events: ["ev"] });
    await fake.createItem(Global.profileLinks, "mem_both", { events: ["ev", "other"] });

    expect(await unlinkProfiles(sync, memory, "ev")).toEqual({ unlinked: 2, deleted: 1 });
    expect(memory.deleteProfile).toHaveBeenCalledTimes(1);
    expect(memory.deleteProfile).toHaveBeenCalledWith("mem_only_ev");
    expect(await fake.getItem(Global.profileLinks, "mem_only_ev")).toBeNull();
    expect((await fake.getItem(Global.profileLinks, "mem_both"))!.data).toEqual({ events: ["other"] });
  });

  it("is a no-op for an event that never had traffic", async () => {
    const fake = new FakeSync();
    const sync = new SyncStore(fake, { warn: vi.fn() });
    await sync.ensureMap(Global.profileLinks);
    expect(await unlinkProfiles(sync, { lookup: vi.fn(), upsert: vi.fn(), deleteProfile: vi.fn() }, "ev")).toEqual({ unlinked: 0, deleted: 0 });
  });
});

describe("fresh deployment (no global maps yet)", () => {
  it("delete and End clean-up succeed before any attendee has messaged", async () => {
    const sync = new SyncStore(new FakeSync(), { warn: vi.fn() });
    await expect(removeBindings(sync, "ev")).resolves.toBe(0);
    await expect(unlinkProfiles(sync, { lookup: vi.fn(), upsert: vi.fn(), deleteProfile: vi.fn() }, "ev")).resolves.toEqual({ unlinked: 0, deleted: 0 });
  });
});

describe("Memory client: a profile another app already deleted", () => {
  it("treats 404 on delete as done, and lookup of a gone profile as unknown", async () => {
    const { createMemoryClient } = await import("@/lib/twilio/memory");
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return new Response("{}", { status: 404 });
      if (url.endsWith("/Lookup")) return Response.json({ profiles: ["mem_profile_gone"] });
      return new Response("{}", { status: 404 }); // GET of the deleted profile
    });
    const m = createMemoryClient({ storeId: "mem_store_x", username: "u", password: "p", fetch: fetch as unknown as typeof globalThis.fetch });
    await expect(m.deleteProfile("mem_profile_gone")).resolves.toBeUndefined();
    await expect(m.lookup("phone", "+15005550006")).resolves.toBeNull();
  });
});
