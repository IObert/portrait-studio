import { describe, expect, it, vi } from "vitest";
import { ShareSchema } from "@/lib/delivery/deliver";
import { recordShareEvent, SHARE_EVENT_KINDS } from "@/lib/share/track";
import { readStats, resetStats } from "@/lib/stats";
import { Global } from "@/lib/sync/names";
import { SyncStore } from "@/lib/sync/store";
import { FakeSync } from "../support/fake-sync";

const NOW = new Date("2026-11-05T12:00:00Z");
const SHARE_ID = "S".repeat(24);

async function world() {
  const fake = new FakeSync();
  const sync = new SyncStore(fake, { warn: vi.fn() }, { baseDelayMs: 1, maxDelayMs: 2 });
  await sync.ensureMap(Global.shares);
  await fake.createItem(Global.shares, SHARE_ID, { eventSlug: "ev", jobId: "job_00000001", createdAt: NOW.toISOString() });
  const record = (kind: (typeof SHARE_EVENT_KINDS)[number], id = SHARE_ID) => recordShareEvent(sync, "ev", id, kind, NOW);
  return { fake, sync, record };
}

describe("share page counters (D-50)", () => {
  it("each kind of event bumps its own counter", async () => {
    const { sync, record } = await world();
    for (const kind of SHARE_EVENT_KINDS) await record(kind);
    await record("download");
    expect(await readStats(sync, "ev")).toEqual({ shareViews: 1, shareLinksOpened: 1, shareShares: 1, shareTextCopied: 1, shareDownloads: 2 });
  });

  it("views count every time, but a link is opened once per portrait", async () => {
    const { fake, sync, record } = await world();
    await record("view");
    await record("view");
    await record("view");
    expect(await readStats(sync, "ev")).toEqual({ shareViews: 3, shareLinksOpened: 1 });
    expect(ShareSchema.parse((await fake.getItem(Global.shares, SHARE_ID))!.data).openedAt).toBe(NOW.toISOString());
  });

  it("shares, copies and downloads do not mark the link as opened", async () => {
    const { sync, record } = await world();
    await record("share");
    await record("copy");
    expect(await readStats(sync, "ev")).toEqual({ shareShares: 1, shareTextCopied: 1 });
  });

  it("a second portrait has its own first open", async () => {
    const { fake, sync, record } = await world();
    const other = "T".repeat(24);
    await fake.createItem(Global.shares, other, { eventSlug: "ev", jobId: "job_00000002", createdAt: NOW.toISOString() });
    await record("view");
    await record("view", other);
    expect((await readStats(sync, "ev")).shareLinksOpened).toBe(2);
  });

  it("an unknown share id does not create a share record", async () => {
    const { fake, record } = await world();
    await record("view", "U".repeat(24));
    expect(await fake.getItem(Global.shares, "U".repeat(24)).catch(() => null)).toBeNull();
  });

  it("the stats reset clears them like every other counter", async () => {
    const { sync, record } = await world();
    await record("view");
    await record("download");
    await resetStats(sync, "ev", NOW);
    expect(await readStats(sync, "ev")).toEqual({});
  });
});
