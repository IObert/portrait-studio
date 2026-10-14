import { describe, expect, it } from "vitest";
import { jobNumber, lpArgs, parseJobState, parseLpstat, parseRequestId } from "../src/cups.js";
import { claim, claimable, failed, LEASE_MS, MAX_ATTEMPTS, printed, type PrintItem, renew, resumable, resume, startPrinting } from "../src/queue.js";

describe("CUPS command (SPEC §11.2, §16)", () => {
  it("builds a borderless DS620 4x6 print", () => {
    expect(lpArgs("DNP_DS620", "/tmp/p.png")).toEqual([
      "-d", "DNP_DS620",
      "-o", "PageSize=dnp6x4", "-o", "Cutter=Normal", "-o", "Finish=Glossy", "-o", "Resolution=300x300dpi",
      "-o", "fit-to-page", "-o", "print-scaling=fill", "-o", "orientation-requested=3",
      "--", "/tmp/p.png",
    ]);
  });
  it("rejects unsafe queue names (no shell injection)", () => {
    for (const q of ["a b", "x;rm -rf /", "$(id)", "", "-d"]) expect(() => lpArgs(q, "/tmp/p.png"), q).toThrow();
  });
  it("reads the request id from lp output", () => {
    expect(parseRequestId("request id is DNP_DS620-42 (1 file(s))\n")).toBe("DNP_DS620-42");
    expect(parseRequestId("lp: error")).toBeNull();
  });
  it("reads the exact job state from ipptool (completed vs canceled)", () => {
    // Real ipptool output from the DS620 (jobs 26 and 9).
    expect(parseJobState('    /tmp/jobstate  [PASS]\n        job-state (enum) = completed\n        job-state-reasons (keyword) = processing-to-stop-point\n')).toEqual({ state: "completed", reasons: "processing-to-stop-point" });
    expect(parseJobState("        job-state (enum) = canceled\n        job-state-reasons (keyword) = job-canceled-by-user\n").state).toBe("canceled");
    expect(parseJobState("        job-state (enum) = pending-held\n").state).toBe("held");
    expect(parseJobState("garbage").state).toBe("unknown");
    expect(jobNumber("Dai_Nippon_Printing_DP_DS620-24")).toBe(24);
    expect(jobNumber("nonsense")).toBeNull();
  });
});

describe("lpstat status (SPEC §11.2)", () => {
  it.each([
    ["printer DNP_DS620 is idle.  enabled since Mon", 0, "idle"],
    ["printer DNP_DS620 now printing DNP_DS620-42.  enabled since Mon", 0, "printing"],
    ["printer DNP_DS620 disabled since Mon -\n\tPaused", 0, "paused"],
    ["printer DNP_DS620 is idle.\n\tMedia empty or ribbon end", 0, "out_of_paper"],
    ["printer DNP_DS620 is idle.\n\tWaiting for printer to become available.", 0, "offline"],
    ["lpstat: Invalid destination name in list \"NOPE\".", 1, "offline"],
    ["printer DNP_DS620 is idle.\n\tFilter failed", 0, "error"],
  ])("%s → %s", (out, code, status) => {
    expect(parseLpstat(out, code).status).toBe(status);
  });
});

describe("queue decisions (PROTOCOL.md §3)", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  const item = (over: Partial<PrintItem> = {}): PrintItem => ({ jobId: "job_1", blobPath: "p.png", url: "https://x.test/m/t", who: "x", state: "queued", attempts: 0, leaseUntil: null, error: null, timestamps: {}, ...over });

  it("claims a queued item and takes a lease", () => {
    const c = claim(item(), now)!;
    expect(c).toMatchObject({ state: "claimed", attempts: 1 });
    expect(Date.parse(c.leaseUntil!) - now.getTime()).toBe(LEASE_MS);
  });
  it("does not claim: lost race, back-off pending, or no download link", () => {
    expect(claim(item({ state: "claimed" }), now)).toBeNull();
    expect(claim(null, now)).toBeNull();
    expect(claimable(item({ leaseUntil: new Date(now.getTime() + 5000).toISOString() }), now)).toBe(false);
    expect(claimable(item({ url: undefined }), now)).toBe(false);
  });
  it("walks claimed → printing → printed and renews the lease", () => {
    const p = startPrinting(claim(item(), now), now, "DS620-7")!;
    expect(p).toMatchObject({ state: "printing", printerJobId: "DS620-7" });
    expect(renew(p, new Date(now.getTime() + 30_000))!.leaseUntil).not.toBe(p.leaseUntil);
    expect(printed(p, now)).toMatchObject({ state: "printed", leaseUntil: null });
  });
  it("retries with back-off, then fails after 3 attempts", () => {
    const r = failed(item({ state: "printing", attempts: 1 }), now, "paper jam")!;
    expect(r).toMatchObject({ state: "queued", error: "paper jam" });
    expect(Date.parse(r.leaseUntil!)).toBeGreaterThan(now.getTime());
    expect(failed(item({ state: "printing", attempts: MAX_ATTEMPTS }), now, "jam")).toMatchObject({ state: "failed" });
  });
  it("a retry clears the printer job id; a printing item with one is resumed, not resubmitted", () => {
    expect(failed(item({ state: "printing", attempts: 1, printerJobId: "DS620-7" }), now, "x")).toMatchObject({ state: "queued", printerJobId: null });
    const stale = item({ state: "printing", attempts: 1, printerJobId: "DS620-7", leaseUntil: new Date(now.getTime() - 1).toISOString() });
    expect(resumable(stale, now)).toBe(true);
    expect(resume(stale, now)).toMatchObject({ state: "printing", printerJobId: "DS620-7", attempts: 1 });
    expect(resumable({ ...stale, leaseUntil: new Date(now.getTime() + 60_000).toISOString() }, now)).toBe(false);
    expect(renew(item({ state: "claimed" }), now)).not.toBeNull();
  });
  it("does not touch items it no longer holds", () => {
    expect(printed(item({ state: "queued" }), now)).toBeNull();
    expect(renew(item({ state: "printed" }), now)).toBeNull();
  });
});
