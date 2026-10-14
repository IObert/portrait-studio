import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { printOne, STALLED_MS } from "../src/agent.js";
import type { JobOutcome, Printer } from "../src/printer.js";
import type { PrinterStatus } from "../src/cups.js";
import type { PrintItem } from "../src/queue.js";
import { FakeQueue } from "./support/fake-queue.js";

const PNG = Buffer.concat([Buffer.from([0x89]), Buffer.from("PNG\r\n\x1a\n"), Buffer.alloc(16)]);
const item = (over: Partial<PrintItem> = {}): PrintItem => ({ jobId: "job_1", blobPath: "p.png", url: "https://x.test/m/t", who: "x", state: "queued", attempts: 0, leaseUntil: null, error: null, timestamps: { queued: "2026-10-14T12:00:00Z" }, ...over });

/** A CUPS stand-in: jobs wait while the printer is off and complete once it is on. */
function fakePrinter() {
  const p = {
    power: "off" as "off" | "on",
    submitted: [] as string[],
    cancelled: [] as string[],
    completeAfterOn: 1,
    checksWhileOn: 0,
    jobState: "waiting" as "waiting" | "canceled",
    printer: null as unknown as Printer,
  };
  p.printer = {
    mode: "cups",
    queue: "DS620",
    async submit() {
      const id = `DS620-${24 + p.submitted.length}`;
      p.submitted.push(id);
      return id;
    },
    async check(): Promise<JobOutcome> {
      if (p.jobState === "canceled") return { kind: "failed", reason: "printer job canceled" };
      if (p.power === "off") return { kind: "waiting", detail: "offline" };
      return ++p.checksWhileOn >= p.completeAfterOn ? { kind: "done" } : { kind: "waiting", detail: "printing" };
    },
    async cancel(id) {
      p.cancelled.push(id);
    },
    async status(): Promise<{ status: PrinterStatus; detail: string }> {
      return p.power === "off" ? { status: "offline", detail: "printer is off" } : { status: "idle", detail: "" };
    },
    async describe() {
      return "fake";
    },
  };
  return p;
}

describe("one print, one copy (D-25)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "Date"] });
    vi.setSystemTime(new Date("2026-10-14T12:00:00Z"));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(PNG)));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("printer off, then on: submitted once, printed once, nothing cancelled", async () => {
    const q = new FakeQueue([item()]);
    const fp = fakePrinter();
    const run = printOne(q as never, { jobId: "job_1", resume: false }, fp.printer, new AbortController().signal);
    // Off for 5 minutes (today's case was ~40 s): the agent just waits.
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(q.items.get("job_1")).toMatchObject({ state: "printing", attempts: 1, printerJobId: "DS620-24" });
    fp.power = "on";
    await vi.advanceTimersByTimeAsync(5_000);
    await run;
    expect(fp.submitted).toEqual(["DS620-24"]);
    expect(fp.cancelled).toEqual([]);
    expect(q.items.get("job_1")).toMatchObject({ state: "printed", attempts: 1 });
  });

  it("a job cancelled at the printer is not reported as printed, and its retry starts clean", async () => {
    const q = new FakeQueue([item()]);
    const fp = fakePrinter();
    fp.power = "on";
    fp.jobState = "canceled";
    await printOne(q as never, { jobId: "job_1", resume: false }, fp.printer, new AbortController().signal);
    expect(q.items.get("job_1")).toMatchObject({ state: "queued", printerJobId: null, error: "printer job canceled" });
    expect(fp.cancelled).toEqual(["DS620-24"]);
  });

  it("a job that stalls while the printer says ready is cancelled before the retry", async () => {
    const q = new FakeQueue([item()]);
    const fp = fakePrinter();
    fp.power = "on";
    fp.completeAfterOn = Number.POSITIVE_INFINITY;
    const run = printOne(q as never, { jobId: "job_1", resume: false }, fp.printer, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(STALLED_MS + 5_000);
    await run;
    expect(fp.cancelled).toEqual(["DS620-24"]);
    expect(q.items.get("job_1")).toMatchObject({ state: "queued", printerJobId: null });
  });

  it("after an agent restart it waits for the same printer job instead of printing again", async () => {
    const q = new FakeQueue([item({ state: "printing", attempts: 1, printerJobId: "DS620-24", leaseUntil: "2026-10-14T11:59:00Z" })]);
    const fp = fakePrinter();
    fp.power = "on";
    await printOne(q as never, { jobId: "job_1", resume: true }, fp.printer, new AbortController().signal);
    expect(fp.submitted).toEqual([]);
    expect(q.items.get("job_1")).toMatchObject({ state: "printed", attempts: 1 });
  });

  it("stopping the agent mid-wait keeps the printer job for the next start", async () => {
    const q = new FakeQueue([item()]);
    const fp = fakePrinter();
    const stop = new AbortController();
    const run = printOne(q as never, { jobId: "job_1", resume: false }, fp.printer, stop.signal);
    await vi.advanceTimersByTimeAsync(10_000);
    stop.abort();
    await vi.advanceTimersByTimeAsync(5_000);
    await run;
    expect(fp.cancelled).toEqual([]);
    expect(q.items.get("job_1")).toMatchObject({ state: "printing", printerJobId: "DS620-24" });
  });
});
