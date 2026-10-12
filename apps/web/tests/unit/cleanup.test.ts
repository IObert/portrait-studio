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

describe("unlinkProfiles (shared Memory store, D-10)", () => {
  it("erases our data only for profiles linked to no other event, never deletes profiles", async () => {
    const { fake, sync } = await setup();
    const memory = { lookup: vi.fn(), upsert: vi.fn(), erase: vi.fn(async () => {}) };
    await fake.createItem(eventObjects("ev").leads, "whatsapp:+1", { memoryProfileId: "mem_only_ev", optedInAt: "x", method: "verified_email" });
    await fake.createItem(eventObjects("ev").leads, "whatsapp:+2", { memoryProfileId: "mem_both", optedInAt: "x", method: "returning" });
    await fake.createItem(eventObjects("ev").leads, "whatsapp:+3", { memoryProfileId: null, optedInAt: "x", method: "agree_only" });
    await fake.createItem(Global.profileLinks, "mem_only_ev", { events: ["ev"] });
    await fake.createItem(Global.profileLinks, "mem_both", { events: ["ev", "other"] });

    expect(await unlinkProfiles(sync, memory, "ev")).toEqual({ unlinked: 2, erased: 1 });
    expect(memory.erase).toHaveBeenCalledTimes(1);
    expect(memory.erase).toHaveBeenCalledWith("mem_only_ev", { traits: ["firstName", "lastName", "email", "phone", "whatsapp"], identifiers: ["email", "phone", "whatsapp"] });
    expect(await fake.getItem(Global.profileLinks, "mem_only_ev")).toBeNull();
    expect((await fake.getItem(Global.profileLinks, "mem_both"))!.data).toEqual({ events: ["other"] });
  });

  it("is a no-op for an event that never had traffic", async () => {
    const fake = new FakeSync();
    const sync = new SyncStore(fake, { warn: vi.fn() });
    await sync.ensureMap(Global.profileLinks);
    expect(await unlinkProfiles(sync, { lookup: vi.fn(), upsert: vi.fn(), erase: vi.fn() }, "ev")).toEqual({ unlinked: 0, erased: 0 });
  });
});

describe("fresh deployment (no global maps yet)", () => {
  it("delete and End clean-up succeed before any attendee has messaged", async () => {
    const sync = new SyncStore(new FakeSync(), { warn: vi.fn() });
    await expect(removeBindings(sync, "ev")).resolves.toBe(0);
    await expect(unlinkProfiles(sync, { lookup: vi.fn(), upsert: vi.fn(), erase: vi.fn() }, "ev")).resolves.toEqual({ unlinked: 0, erased: 0 });
  });
});
