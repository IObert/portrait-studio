import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ConflictRetriesExhausted, SyncError } from "@/lib/sync/errors";
import { eventObjects, Global, SHARDS, shardOf } from "@/lib/sync/names";
import { InvalidSyncData, MAX_ITEM_BYTES, PayloadTooLarge, SKIP, SyncStore } from "@/lib/sync/store";
import { FakeSync } from "../support/fake-sync";

const Counter = z.object({ n: z.number().int() });

async function setup(opts = {}) {
  const fake = new FakeSync();
  const log = { warn: vi.fn() };
  const store = new SyncStore(fake, log, { baseDelayMs: 1, maxDelayMs: 2, ...opts });
  await store.ensureMap("m");
  return { fake, log, store, map: store.map("m", Counter) };
}

describe("SyncStore conditional update", () => {
  it("creates when missing and increments with If-Match", async () => {
    const { map } = await setup();
    await map.update("k", (c) => ({ n: (c?.n ?? 0) + 1 }));
    await map.update("k", (c) => ({ n: (c?.n ?? 0) + 1 }));
    expect(await map.get("k")).toEqual({ n: 2 });
  });

  it("re-reads and retries when another writer changes the item in between", async () => {
    const { fake, map } = await setup();
    await map.put("k", { n: 0 });
    let raced = false;
    fake.beforeWrite = async (m, k) => {
      if (raced) return;
      raced = true;
      fake.beforeWrite = undefined;
      await fake.updateItem(m, k, { n: 100 }); // concurrent writer bumps the revision
    };
    const fn = vi.fn((c: { n: number } | null) => ({ n: (c?.n ?? 0) + 1 }));
    await map.update("k", fn);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(await map.get("k")).toEqual({ n: 101 }); // no lost update
  });

  it("never loses increments under concurrent writers", async () => {
    const { map } = await setup();
    await Promise.all(Array.from({ length: 25 }, () => map.update("k", (c) => ({ n: (c?.n ?? 0) + 1 }))));
    expect(await map.get("k")).toEqual({ n: 25 });
  });

  it("handles a concurrent first create", async () => {
    const { fake, map } = await setup();
    let raced = false;
    fake.beforeWrite = async (m, k) => {
      if (raced) return;
      raced = true;
      fake.beforeWrite = undefined;
      await fake.createItem(m, k, { n: 10 });
    };
    await map.update("k", (c) => ({ n: (c?.n ?? 0) + 1 }));
    expect(await map.get("k")).toEqual({ n: 11 });
  });

  it("gives up after the configured number of conflicts", async () => {
    const { fake, map } = await setup({ conflictAttempts: 3 });
    await map.put("k", { n: 0 });
    fake.beforeWrite = (m, k) => {
      const e = fake.maps.get(m)!.get(k)!;
      e.rev++; // someone always wins the race
    };
    await expect(map.update("k", () => ({ n: 1 }))).rejects.toBeInstanceOf(ConflictRetriesExhausted);
  });

  it("SKIP leaves the item unchanged and writes nothing", async () => {
    const { fake, map } = await setup();
    await map.put("k", { n: 5 });
    const before = fake.writes;
    expect(await map.update("k", () => SKIP)).toEqual({ n: 5 });
    expect(fake.writes).toBe(before);
  });
});

describe("SyncStore create", () => {
  it("is create-if-absent", async () => {
    const { map } = await setup();
    expect(await map.create("k", { n: 1 })).toBe(true);
    expect(await map.create("k", { n: 2 })).toBe(false);
    expect(await map.get("k")).toEqual({ n: 1 });
  });
});

describe("SyncStore transient errors and rate limits", () => {
  it("logs a structured WARN with the object name on 429 and retries", async () => {
    const { fake, log, map } = await setup();
    fake.failNext(FakeSync.rateLimit(), FakeSync.rateLimit());
    await map.put("k", { n: 1 });
    expect(await map.get("k")).toEqual({ n: 1 });
    expect(log.warn).toHaveBeenCalledTimes(2);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "sync_rate_limited", object: "m", code: 54009 }),
      expect.any(String),
    );
  });

  it("retries 5xx without logging a rate-limit warning", async () => {
    const { fake, log, map } = await setup();
    fake.failNext(FakeSync.serverError());
    await map.put("k", { n: 1 });
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("fails after the retry budget", async () => {
    const { fake, map } = await setup({ transientAttempts: 2 });
    fake.failNext(FakeSync.rateLimit(), FakeSync.rateLimit(), FakeSync.rateLimit());
    await expect(map.put("k", { n: 1 })).rejects.toBeInstanceOf(SyncError);
  });

  it("does not retry permanent errors", async () => {
    const { fake, map } = await setup();
    const spy = vi.spyOn(fake, "updateItem");
    fake.failNext(new SyncError(20003, 401, "Authenticate"));
    await expect(map.put("k", { n: 1 })).rejects.toMatchObject({ status: 401 });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("SyncStore validation", () => {
  it("rejects payloads over the size limit before sending", async () => {
    const { fake, store } = await setup();
    const big = store.map("m", z.object({ s: z.string() }));
    await expect(big.put("k", { s: "x".repeat(MAX_ITEM_BYTES) })).rejects.toBeInstanceOf(PayloadTooLarge);
    expect(fake.writes).toBe(0);
  });

  it("rejects invalid data on write and on read, naming fields only", async () => {
    const { fake, map } = await setup();
    // @ts-expect-error deliberately wrong type
    await expect(map.put("k", { n: "secret@example.com" })).rejects.toBeInstanceOf(InvalidSyncData);
    await fake.createItem("m", "bad", { n: "secret@example.com" });
    const err = await map.get("bad").catch((e: Error) => e);
    expect(err).toBeInstanceOf(InvalidSyncData);
    expect((err as Error).message).toContain("n");
    expect((err as Error).message).not.toContain("secret");
  });

  it("skips invalid items when listing if asked", async () => {
    const { fake, map } = await setup();
    await map.put("a", { n: 1 });
    await fake.createItem("m", "b", { n: "x" });
    const bad: string[] = [];
    const out = [];
    for await (const e of map.entries((k) => bad.push(k))) out.push(e);
    expect(out).toEqual([["a", { n: 1 }]]);
    expect(bad).toEqual(["b"]);
  });
});

describe("Sync object names", () => {
  it("shards deterministically within range", () => {
    for (const k of ["SM1", "SM2", "imagesDelivered"]) {
      expect(shardOf(k, 8)).toBe(shardOf(k, 8));
      expect(shardOf(k, 8)).toBeGreaterThanOrEqual(0);
      expect(shardOf(k, 8)).toBeLessThan(8);
    }
    expect(Global.allDedup()).toHaveLength(SHARDS.dedup);
    expect(Global.allDedup()).toContain(Global.dedup("SMabc"));
  });

  it("prefixes per-event objects and rejects unsafe slugs", () => {
    const ev = eventObjects("sp-london");
    expect(ev.jobs).toBe("ev_sp_london_jobs");
    expect(ev.allMaps().every((n) => n.startsWith("ev_sp_london_"))).toBe(true);
    expect(ev.allStats()).toContain(ev.stats("imagesDelivered"));
    expect(() => eventObjects("../x")).toThrow();
    expect(() => eventObjects("UPPER")).toThrow();
  });
});
