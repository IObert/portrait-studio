import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CANCEL_SCRIPT, CHECK_SCRIPT, diagnoseWindows, encodeCommand, isSafePrinterName, JOB, jobOutcome, KEEP_PRINTED_SCRIPT, parseDoctorFacts,
  parsePrinterStatus, parseSubmitted, type PowerShell, runWindowsDoctor, STATUS_SCRIPT, SUBMIT_SCRIPT, windowsJobId, windowsJobNumber, windowsPrinter,
  type WindowsPrinterFacts,
} from "../src/windows.js";

// Fixtures are hand-written from the PowerShell docs, not captured on a real booth PC (see CRITICAL(windows) in windows.ts).
const OUT = mkdtempSync(path.join(tmpdir(), "ps-win-"));
const NAME = "DP-DS620";
const PNG = Buffer.from("\x89PNG fake");

describe("Windows printing: parsing", () => {
  it("encodes scripts as UTF-16LE base64 for -EncodedCommand", () => {
    expect(Buffer.from(encodeCommand("Get-Printer"), "base64").toString("utf16le")).toBe("Get-Printer");
  });
  it("accepts real printer names, rejects control characters", () => {
    for (const n of ["DP-DS620", "DNP DS620 (Copy 1)", "\\\\booth\\DS620"]) expect(isSafePrinterName(n), n).toBe(true);
    for (const n of ["", "  ", "a\nb", "x".repeat(300)]) expect(isSafePrinterName(n), n).toBe(false);
  });
  it("round-trips printer job ids and keeps other printers' ids out", () => {
    expect(windowsJobNumber(NAME, windowsJobId(NAME, 12))).toBe(12);
    expect(windowsJobNumber(NAME, windowsJobId(NAME, "untracked", 5))).toBe("untracked");
    expect(windowsJobNumber(NAME, "win:Other:12")).toBeNull();
    expect(windowsJobNumber(NAME, "DP-DS620-12")).toBeNull();
    expect(windowsJobNumber(NAME, "win:DP-DS620:0")).toBeNull();
  });
  it("reads the submitted job", () => {
    expect(parseSubmitted("JOB 7\r\n")).toBe(7);
    expect(parseSubmitted("UNTRACKED\r\n")).toBe("untracked");
    expect(parseSubmitted("")).toBeNull();
  });
  it.each([
    ['{"status":0,"jobs":0}', 0, "idle"],
    ['{"status":1,"jobs":0}', 0, "paused"],
    ['{"status":5,"jobs":1}', 0, "out_of_paper"],
    ['{"status":8,"jobs":0}', 0, "offline"],
    ['{"status":10,"jobs":1}', 0, "printing"],
    ['{"status":23,"jobs":0}', 0, "error"],
    ['{"status":99}', 0, "error"],
    ["Get-Printer : No MSFT_Printer objects found", 1, "offline"],
  ] as const)("printer status %s → %s", (out, code, status) => {
    expect(parsePrinterStatus(out, code).status).toBe(status);
  });
  it("reads job outcomes: only printed/complete is done; errors wait", () => {
    const j = (found: boolean, status: number, keepPrinted = true) => jobOutcome(JSON.stringify({ keepPrinted, found, status }), 0);
    expect(j(true, JOB.Printed | JOB.Retained)).toEqual({ kind: "done" });
    expect(j(true, JOB.Complete)).toEqual({ kind: "done" });
    expect(j(true, JOB.Deleting).kind).toBe("failed");
    expect(j(true, JOB.Printing)).toEqual({ kind: "waiting", detail: "printing" });
    expect(j(true, JOB.Error | JOB.PaperOut)).toEqual({ kind: "waiting", detail: "paper out" });
    expect(j(true, JOB.Offline)).toEqual({ kind: "waiting", detail: "offline" });
    expect(j(false, 0, true).kind).toBe("failed");
    expect(j(false, 0, false)).toEqual({ kind: "done" });
    expect(jobOutcome("", 1).kind).toBe("waiting");
  });
  it("reads doctor facts, also a single bare object", () => {
    const one = { name: NAME, driver: "DP-DS620", port: "USB001", status: 0, keepPrinted: false, papers: ["(6x4)", "(6x4) x2"] };
    expect(parseDoctorFacts(JSON.stringify([one]))).toEqual([one]);
    expect(parseDoctorFacts(JSON.stringify(one))).toEqual([one]);
    expect(parseDoctorFacts(JSON.stringify({ ...one, papers: "(6x4)" }))[0]!.papers).toEqual(["(6x4)"]);
    expect(parseDoctorFacts("garbage")).toEqual([]);
  });
});

describe("Windows printing: printer", () => {
  function fakePs(answers: Partial<Record<string, { stdout: string; code?: number }>>) {
    const calls: { script: string; env: Record<string, string> }[] = [];
    const ps: PowerShell = async (script, env) => {
      calls.push({ script, env });
      const a = answers[script] ?? { stdout: "" };
      return { stdout: a.stdout, stderr: a.code ? a.stdout : "", code: a.code ?? 0 };
    };
    return { ps, calls };
  }

  it("passes inputs only as environment variables", async () => {
    const { ps, calls } = fakePs({ [SUBMIT_SCRIPT]: { stdout: "JOB 3\r\n" } });
    const p = windowsPrinter("Evil'; Remove-Item C:\\", OUT, ps);
    const id = await p.submit(PNG, "job_1", new AbortController().signal);
    expect(id).toBe("win:Evil'; Remove-Item C:\\:3");
    expect(calls[0]!.script).toBe(SUBMIT_SCRIPT);
    expect(calls[0]!.env.PSA_PRINTER).toBe("Evil'; Remove-Item C:\\");
    expect(path.isAbsolute(calls[0]!.env.PSA_FILE!)).toBe(true);
  });
  it("throws when the print could not be submitted", async () => {
    const { ps } = fakePs({ [SUBMIT_SCRIPT]: { stdout: "Printer not found: DP-DS620", code: 1 } });
    await expect(windowsPrinter(NAME, OUT, ps).submit(PNG, "job_1", new AbortController().signal)).rejects.toThrow(/Printer not found/);
  });
  it("checks, cancels and never cancels an untracked job", async () => {
    const { ps, calls } = fakePs({ [CHECK_SCRIPT]: { stdout: JSON.stringify({ keepPrinted: true, found: true, status: JOB.Printed }) } });
    const p = windowsPrinter(NAME, OUT, ps);
    expect(await p.check("win:DP-DS620:3")).toEqual({ kind: "done" });
    expect(await p.check("win:DP-DS620:untracked-1")).toEqual({ kind: "done" });
    expect((await p.check("DP-DS620-3")).kind).toBe("failed");
    await p.cancel("win:DP-DS620:3");
    await p.cancel("win:DP-DS620:untracked-1");
    expect(calls.filter((c) => c.script === CANCEL_SCRIPT).map((c) => c.env.PSA_JOB)).toEqual(["3"]);
  });
  it("reports status", async () => {
    const { ps } = fakePs({ [STATUS_SCRIPT]: { stdout: '{"status":1,"jobs":0}' } });
    expect(await windowsPrinter(NAME, OUT, ps).status()).toEqual({ status: "paused", detail: "paused" });
  });
});

describe("Windows doctor", () => {
  const good: WindowsPrinterFacts = { name: NAME, driver: "DP-DS620", port: "USB001", status: 0, keepPrinted: true, papers: ["(6x4)", "(6x4) x2", "(5x7)"] };

  it("is happy with the DNP driver, kept jobs and 4x6 paper", () => {
    expect(diagnoseWindows(good).every((f) => f.ok)).toBe(true);
  });
  it("flags a generic driver, missing 4x6 and dropped jobs", () => {
    const f = diagnoseWindows({ ...good, driver: "Microsoft IPP Class Driver", keepPrinted: false, papers: ["Letter", "A4"] });
    expect(f.filter((x) => !x.ok).map((x) => x.fix ?? null)).toEqual([null, "keep-printed", null]);
  });
  it("turns on Keep printed documents with --fix", async () => {
    let keep = false;
    const lines: string[] = [];
    const ps: PowerShell = async (script) => {
      if (script === KEEP_PRINTED_SCRIPT) return { stdout: "", stderr: "", code: ((keep = true), 0) };
      return { stdout: JSON.stringify([{ ...good, keepPrinted: keep }]), stderr: "", code: 0 };
    };
    expect(await runWindowsDoctor({ fix: false, ps, print: (l) => lines.push(l) })).toBe(1);
    expect(await runWindowsDoctor({ fix: true, ps, print: (l) => lines.push(l) })).toBe(0);
    expect(keep).toBe(true);
  });
  it("asks to pick one of several printers", async () => {
    const ps: PowerShell = async () => ({ stdout: JSON.stringify([good, { ...good, name: "DP-DS620 (Copy 1)" }]), stderr: "", code: 0 });
    const lines: string[] = [];
    expect(await runWindowsDoctor({ fix: false, ps, print: (l) => lines.push(l) })).toBe(1);
    expect(lines.join("\n")).toMatch(/Several DS620 printers/);
  });
});
