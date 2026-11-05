import { describe, expect, it, vi } from "vitest";
import { CHART_JOB_ID, ChartError, queueClippingChart } from "@/lib/delivery/clipping-chart";
import { defaultConfig, type PortraitEvent } from "@/lib/events/schema";
import { verifyMedia, signMedia } from "@/lib/media-token";
import { eventObjects } from "@/lib/sync/names";
import { SyncStore } from "@/lib/sync/store";
import { FakeBlob } from "../support/fake-blob";
import { FakeSync } from "../support/fake-sync";

const NOW = new Date("2026-10-14T12:00:00Z");

function setup(printingEnabled = true) {
  const fake = new FakeSync();
  const sync = new SyncStore(fake, { warn: vi.fn() }, { baseDelayMs: 1, maxDelayMs: 2 });
  const blob = new FakeBlob();
  const event: PortraitEvent = {
    slug: "ev", state: "live", config: { ...defaultConfig("Ev", "+13203780782"), printingEnabled },
    uploads: { frame: null, background: null }, printerTokenHash: null, printerToken: null, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
  };
  const deps = { sync, blob, chart: async () => Buffer.from("chart"), mediaUrl: (p: string) => `https://booth.test/m/${signMedia("s", p, 60)}` };
  const go = () => queueClippingChart(deps, event, NOW);
  return { fake, blob, ev: eventObjects("ev"), go };
}

describe("queueClippingChart (D-45)", () => {
  it("queues the chart as an admin reprint with a link the download route accepts", async () => {
    const w = setup();
    await w.go();
    const item = (await w.fake.getItem(w.ev.print, CHART_JOB_ID))!.data as { state: string; reprint: boolean; blobPath: string; url: string };
    expect(item).toMatchObject({ state: "queued", reprint: true, blobPath: "events/ev/generated/clipping-chart.chart.png" });
    expect(await w.blob.get(item.blobPath)).toEqual(Buffer.from("chart"));
    expect(verifyMedia("s", item.url.split("/m/")[1]!)).toMatchObject({ p: item.blobPath });
  });

  it("refuses while printing is off, and while a chart is still waiting", async () => {
    await expect(setup(false).go()).rejects.toThrow(ChartError);
    const w = setup();
    await w.go();
    await expect(w.go()).rejects.toThrow("already waiting");
  });

  it("queues a new chart once the last one has printed", async () => {
    const w = setup();
    await w.go();
    const cur = (await w.fake.getItem(w.ev.print, CHART_JOB_ID))!;
    await w.fake.updateItem(w.ev.print, CHART_JOB_ID, { ...(cur.data as object), state: "printed", settledAt: NOW.toISOString() });
    await w.go();
    expect((await w.fake.getItem(w.ev.print, CHART_JOB_ID))!.data).toMatchObject({ state: "queued", attempts: 0 });
  });
});
