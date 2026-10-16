import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { PrinterStatus } from "./cups.js";
import type { JobOutcome, Printer } from "./printer.js";

/**
 * Windows print spooler backend for the DNP DS620, through Windows PowerShell 5.1
 * (ships with every Windows 10/11): `System.Drawing.Printing` to print, the
 * PrintManagement cmdlets (`Get-Printer`, `Get-PrintJob`, `Remove-PrintJob`) to
 * track and cancel. Pure building and parsing here; the process calls go
 * through an injectable `PowerShell` runner.
 *
 * BETA: NOT YET TESTED ON A REAL WINDOWS MACHINE. Everything marked `CRITICAL(windows)`
 * is an assumption that must be checked on a booth PC with the DNP driver before
 * this is used at an event.
 */

/** Shown at start-up and by the doctor, so nobody mistakes this for the tested macOS path. */
export const WINDOWS_BETA_NOTICE = "Windows printing is in beta and not yet tested on a real DS620. Do a test print before the event.";

export type PowerShell = (script: string, env: Record<string, string>, opts?: { timeoutMs?: number; signal?: AbortSignal }) => Promise<{ stdout: string; stderr: string; code: number }>;

/** `-EncodedCommand` takes the script as base64 of UTF-16LE, so no quoting or escaping is involved. */
export function encodeCommand(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

const execFileP = promisify(execFile);

/**
 * Runs a script with `powershell.exe`. Inputs go in as environment variables
 * (`$env:PSA_…`), never spliced into the script, so printer names and paths
 * cannot inject code.
 *
 * CRITICAL(windows): some antivirus / EDR products flag `-EncodedCommand`. If the
 * booth PC blocks it, switch to writing the script to `<out>/.tmp/*.ps1` and
 * running it with `-ExecutionPolicy Bypass -File`.
 */
export const execPowerShell: PowerShell = async (script, env, opts = {}) => {
  try {
    const { stdout, stderr } = await execFileP("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encodeCommand(script)], {
      env: { ...process.env, ...env },
      timeout: opts.timeoutMs ?? 30_000,
      signal: opts.signal,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number | string; message: string };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? e.message, code: typeof e.code === "number" ? e.code : 127 };
  }
};

/** Stops on the first error, and writes UTF-8 so non-ASCII printer names survive (the console default is the OEM code page). */
const PRELUDE = `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
`;

/**
 * Windows printer names: any printable text, including spaces and `\\server\share`.
 * They reach PowerShell only as environment variables, so this only keeps out
 * control characters and absurd lengths.
 */
export function isSafePrinterName(name: string): boolean {
  // eslint-disable-next-line no-control-regex
  return name.trim().length > 0 && name.length <= 220 && !/[\u0000-\u001f\u007f]/.test(name);
}

/**
 * Paper names to look for in the driver's list (`PrinterSettings.PaperSizes`).
 *
 * CRITICAL(windows): the DNP Windows driver's paper names are not verified. It
 * likely offers 4x6 as something like "(6x4)" and also split sizes such as
 * "(6x4) x2" / "6x2". The pick below prefers the shortest matching name to
 * avoid the split sizes. Check the real list with `node agent.mjs doctor` and
 * pin the exact name here.
 */
export const WIN_PAPER_PATTERN = "(^|[^0-9])(6\\s*x\\s*4|4\\s*x\\s*6)([^0-9]|$)";

/**
 * Prints the PNG borderless on 4x6 and prints `JOB <id>` (or `UNTRACKED`).
 *
 * The page is filled edge to edge: drawn from the physical page corner (minus
 * the hard margins), at the full page size, so the driver's own borderless
 * handling decides any overspray.
 *
 * CRITICAL(windows): settings that CUPS gets as options (Cutter, Finish/Glossy,
 * Resolution, no colour adjustment) live in the DNP driver's private DEVMODE and
 * cannot be set from here. They must be set once as the printer's defaults in
 * Printing Preferences, and the doctor cannot check them yet.
 *
 * CRITICAL(windows): if the driver reports the 4x6 page as landscape (6 wide, 4
 * high), the portrait 1200x1800 image would be squashed. Check `PageBounds` on a
 * real print; if needed, rotate the image (`RotateFlip`) when the page is wider than high.
 *
 * CRITICAL(windows): `PrintDocument` returns no job id. The job is found again by
 * its unique DocumentName. A fast printer without "Keep printed documents" may
 * remove the job before we see it. That case prints `UNTRACKED`, never an error:
 * an error would trigger a retry and a second copy.
 */
export const SUBMIT_SCRIPT = `${PRELUDE}Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($env:PSA_FILE)
try {
  $doc = New-Object System.Drawing.Printing.PrintDocument
  $doc.PrinterSettings.PrinterName = $env:PSA_PRINTER
  if (-not $doc.PrinterSettings.IsValid) { throw "Printer not found: $($env:PSA_PRINTER)" }
  $doc.DocumentName = $env:PSA_DOC
  # No "Printing page 1" dialog.
  $doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController
  $size = $doc.PrinterSettings.PaperSizes | Where-Object { $_.PaperName -match $env:PSA_PAPER } | Sort-Object { $_.PaperName.Length } | Select-Object -First 1
  if (-not $size) { throw "The driver offers no 4x6 paper size" }
  $doc.DefaultPageSettings.PaperSize = $size
  $doc.DefaultPageSettings.Landscape = $false
  $doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
  $doc.OriginAtMargins = $false
  $doc.add_PrintPage({
    param($sender, $e)
    $g = $e.Graphics
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $b = $e.PageBounds
    $g.DrawImage($img, [single](-$e.PageSettings.HardMarginX), [single](-$e.PageSettings.HardMarginY), [single]$b.Width, [single]$b.Height)
    $e.HasMorePages = $false
  })
  $doc.Print()
} finally {
  $img.Dispose()
}
for ($i = 0; $i -lt 20; $i++) {
  $job = Get-PrintJob -PrinterName $env:PSA_PRINTER | Where-Object { $_.DocumentName -eq $env:PSA_DOC } | Select-Object -First 1
  if ($job) { Write-Output "JOB $($job.Id)"; exit 0 }
  Start-Sleep -Milliseconds 250
}
Write-Output "UNTRACKED"
`;

/** One job's state, plus whether the printer keeps finished jobs (see `jobOutcome`). */
export const CHECK_SCRIPT = `${PRELUDE}$p = Get-Printer -Name $env:PSA_PRINTER
$job = Get-PrintJob -PrinterName $env:PSA_PRINTER -ID ([uint32]$env:PSA_JOB) -ErrorAction SilentlyContinue
[pscustomobject]@{
  keepPrinted = [bool]$p.KeepPrintedJobs
  found = [bool]$job
  status = $(if ($job) { [uint32]$job.JobStatus } else { 0 })
} | ConvertTo-Json -Compress
`;

export const STATUS_SCRIPT = `${PRELUDE}$p = Get-Printer -Name $env:PSA_PRINTER
[pscustomobject]@{ status = [int]$p.PrinterStatus; jobs = [int]$p.JobCount } | ConvertTo-Json -Compress
`;

/** Removing a job that is already gone is fine. */
export const CANCEL_SCRIPT = `${PRELUDE}Remove-PrintJob -PrinterName $env:PSA_PRINTER -ID ([uint32]$env:PSA_JOB) -ErrorAction SilentlyContinue
`;

export const DESCRIBE_SCRIPT = `${PRELUDE}$p = Get-Printer -Name $env:PSA_PRINTER
Write-Output "driver $($p.DriverName); port $($p.PortName); keep printed documents $($p.KeepPrintedJobs)"
`;

/**
 * MSFT_Printer.PrinterStatus (`Get-Printer`), mapped to the agent's statuses.
 *
 * CRITICAL(windows): many USB drivers report `Normal` (0) even when the printer
 * is switched off or unplugged, and the DNP driver may not report paper or
 * ribbon state through the spooler at all. If so, `offline` and `out_of_paper`
 * never show and jobs just wait. Then read `Win32_Printer` instead
 * (`WorkOffline`, `DetectedErrorState`, `ExtendedPrinterStatus`), or DNP's own
 * status tool/SDK.
 */
const PRINTER_STATUS: Record<number, [PrinterStatus, string]> = {
  0: ["idle", ""],
  1: ["paused", "paused"],
  2: ["error", "error"],
  3: ["offline", "pending deletion"],
  4: ["error", "paper jam"],
  5: ["out_of_paper", "paper out"],
  6: ["error", "manual feed"],
  7: ["out_of_paper", "paper problem"],
  8: ["offline", "offline"],
  9: ["printing", ""],
  10: ["printing", ""],
  11: ["printing", ""],
  12: ["error", "output bin full"],
  13: ["offline", "not available"],
  14: ["idle", ""],
  15: ["printing", ""],
  16: ["printing", ""],
  17: ["printing", ""],
  18: ["idle", "ribbon low"],
  19: ["out_of_paper", "no ribbon"],
  20: ["error", "page punt"],
  21: ["error", "user intervention required"],
  22: ["error", "out of memory"],
  23: ["error", "door open"],
  24: ["offline", "server unknown"],
  25: ["idle", ""],
};

export function parsePrinterStatus(output: string, exitCode: number): { status: PrinterStatus; detail: string } {
  if (exitCode !== 0) return { status: "offline", detail: firstLine(output) || "printer not found" };
  const parsed = parseJson<{ status?: number }>(output);
  const known = typeof parsed?.status === "number" ? PRINTER_STATUS[parsed.status] : undefined;
  if (!known) return { status: "error", detail: `unknown printer status ${firstLine(output)}`.trim() };
  return { status: known[0], detail: known[1] };
}

/** MSFT_PrintJob.JobStatus bit flags. */
export const JOB = {
  Paused: 1, Error: 2, Deleting: 4, Spooling: 8, Printing: 16, Offline: 32, PaperOut: 64,
  Printed: 128, Deleted: 256, Blocked: 512, UserIntervention: 1024, Restarted: 2048, Complete: 4096, Retained: 8192,
} as const;

/**
 * Where a job stands, from `CHECK_SCRIPT` output.
 *
 * CRITICAL(windows): the spooler deletes a job once it has printed, unless the
 * printer has "Keep printed documents" on (`KeepPrintedJobs`). Without it, a
 * printed job and a cancelled job look the same: gone. With it on (the doctor
 * sets it), gone means cancelled, as with CUPS. With it off we assume a vanished
 * job printed, because a reprint is worse at a booth than a rare missed print.
 * Verify on the DS620 that a finished job really shows `Printed` (128) or
 * `Complete` (4096), and that this happens when the paper is out, not when the
 * data merely reached the printer.
 */
export function jobOutcome(output: string, exitCode: number): JobOutcome {
  if (exitCode !== 0) return { kind: "waiting", detail: "printer status unavailable" };
  const r = parseJson<{ keepPrinted?: boolean; found?: boolean; status?: number }>(output);
  if (!r) return { kind: "waiting", detail: "printer status unavailable" };
  if (!r.found) return r.keepPrinted ? { kind: "failed", reason: "printer job disappeared" } : { kind: "done" };
  const s = r.status ?? 0;
  if (s & (JOB.Deleting | JOB.Deleted)) return { kind: "failed", reason: "printer job canceled" };
  if (s & (JOB.Printed | JOB.Complete)) return { kind: "done" };
  // An erroring job is not failed: the spooler keeps it, as CUPS does while the printer is off.
  // The agent fails it only after it stalls while the printer says it is ready (STALLED_MS).
  if (s & JOB.PaperOut) return { kind: "waiting", detail: "paper out" };
  if (s & JOB.Offline) return { kind: "waiting", detail: "offline" };
  if (s & (JOB.Error | JOB.UserIntervention | JOB.Blocked)) return { kind: "waiting", detail: "job error" };
  if (s & JOB.Paused) return { kind: "waiting", detail: "job paused" };
  return { kind: "waiting", detail: s & JOB.Printing ? "printing" : "spooling" };
}

/** `JOB 12` → 12; `UNTRACKED` → null. */
export function parseSubmitted(output: string): number | "untracked" | null {
  if (/^UNTRACKED\s*$/m.test(output)) return "untracked";
  const n = Number(/^JOB (\d+)\s*$/m.exec(output)?.[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Printer job ids are `win:<printer>:<n>`, or `win:<printer>:untracked-<time>` when the job could not be found. */
export function windowsJobId(printer: string, n: number | "untracked", now = Date.now()): string {
  return `win:${printer}:${n === "untracked" ? `untracked-${now}` : n}`;
}

export function windowsJobNumber(printer: string, id: string): number | "untracked" | null {
  const prefix = `win:${printer}:`;
  if (!id.startsWith(prefix)) return null;
  const rest = id.slice(prefix.length);
  if (/^untracked-\d+$/.test(rest)) return "untracked";
  const n = Number(rest);
  return /^\d+$/.test(rest) && Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function windowsPrinter(printerName: string, outDir: string, ps: PowerShell = execPowerShell): Printer {
  if (!isSafePrinterName(printerName)) throw new Error("Invalid Windows printer name");
  const tmpDir = path.join(outDir, ".tmp");
  const env = { PSA_PRINTER: printerName };
  return {
    mode: "windows",
    queue: printerName,
    outDir,
    owns: (id) => windowsJobNumber(printerName, id) !== null,
    async submit(png, jobId, signal) {
      await mkdir(tmpDir, { recursive: true });
      const safeId = jobId.replace(/[^A-Za-z0-9_-]/g, "");
      // Absolute: PowerShell's working directory is not necessarily ours.
      const file = path.resolve(tmpDir, `${safeId}.png`);
      await writeFile(file, png);
      // Unique per attempt, so an old retained job with the same name is never mistaken for this one.
      const doc = `Portrait Studio ${safeId} ${Date.now()}`;
      const r = await ps(SUBMIT_SCRIPT, { ...env, PSA_FILE: file, PSA_DOC: doc, PSA_PAPER: WIN_PAPER_PATTERN }, { timeoutMs: 60_000, signal }).finally(() => rm(file, { force: true }));
      const n = parseSubmitted(r.stdout);
      // CRITICAL(windows): a non-zero exit after `Print()` succeeded (e.g. Get-PrintJob failing) would
      // retry and print twice. SUBMIT_SCRIPT only throws before `Print()`; keep it that way.
      if (r.code !== 0 || n === null) throw new Error(`Windows print failed: ${firstLine(r.stderr || r.stdout) || `exit ${r.code}`}`);
      return windowsJobId(printerName, n);
    },
    async check(printerJobId) {
      const n = windowsJobNumber(printerName, printerJobId);
      if (n === null) return { kind: "failed", reason: `unknown printer job ${printerJobId}` };
      // Could not be tracked after submitting: assume it printed rather than print it twice.
      if (n === "untracked") return { kind: "done" };
      const r = await ps(CHECK_SCRIPT, { ...env, PSA_JOB: String(n) }, { timeoutMs: 15_000 });
      const outcome = jobOutcome(r.stdout, r.code);
      if (outcome.kind !== "waiting") return outcome;
      const st = await this.status();
      return { kind: "waiting", detail: st.detail || outcome.detail || st.status };
    },
    async cancel(printerJobId) {
      const n = windowsJobNumber(printerName, printerJobId);
      if (typeof n !== "number") return;
      await ps(CANCEL_SCRIPT, { ...env, PSA_JOB: String(n) }, { timeoutMs: 15_000 }).catch(() => {});
    },
    async status() {
      const r = await ps(STATUS_SCRIPT, env, { timeoutMs: 10_000 });
      return parsePrinterStatus(r.code === 0 ? r.stdout : `${r.stderr}${r.stdout}`, r.code);
    },
    async describe() {
      const r = await ps(DESCRIBE_SCRIPT, env, { timeoutMs: 10_000 });
      return r.code === 0 ? r.stdout.trim() : `Get-Printer failed: ${firstLine(r.stderr || r.stdout)}`;
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Doctor (Windows)                                                          */
/* ------------------------------------------------------------------------ */

export interface WindowsPrinterFacts {
  name: string;
  driver: string;
  port: string;
  status: number;
  keepPrinted: boolean;
  papers: string[];
}

/** DS620 printers (or the one named in `$env:PSA_PRINTER`) with their driver and paper sizes. */
export const DOCTOR_FACTS_SCRIPT = `${PRELUDE}Add-Type -AssemblyName System.Drawing
if ($env:PSA_PRINTER) { $all = @(Get-Printer -Name $env:PSA_PRINTER -ErrorAction SilentlyContinue) }
else { $all = @(Get-Printer | Where-Object { $_.Name -match 'DS-?620' -or $_.DriverName -match 'DS-?620' }) }
$out = foreach ($p in $all) {
  $s = New-Object System.Drawing.Printing.PrinterSettings
  $s.PrinterName = $p.Name
  [pscustomobject]@{
    name = $p.Name; driver = [string]$p.DriverName; port = [string]$p.PortName
    status = [int]$p.PrinterStatus; keepPrinted = [bool]$p.KeepPrintedJobs
    papers = @($s.PaperSizes | ForEach-Object { $_.PaperName })
  }
}
ConvertTo-Json -InputObject @($out) -Compress -Depth 3
`;

/** Needs an Administrator PowerShell. */
export const KEEP_PRINTED_SCRIPT = `${PRELUDE}Set-Printer -Name $env:PSA_PRINTER -KeepPrintedJobs $true
`;

export function parseDoctorFacts(output: string): WindowsPrinterFacts[] {
  const parsed = parseJson<unknown>(output);
  // ConvertTo-Json -InputObject @(x) still gives a bare object for one element in some PowerShell versions.
  const list = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  return list.flatMap((p) => {
    const r = p as Partial<WindowsPrinterFacts> & { papers?: unknown };
    if (typeof r.name !== "string") return [];
    const papers = Array.isArray(r.papers) ? r.papers.filter((x): x is string => typeof x === "string") : typeof r.papers === "string" ? [r.papers] : [];
    return [{ name: r.name, driver: String(r.driver ?? ""), port: String(r.port ?? ""), status: Number(r.status ?? 0), keepPrinted: r.keepPrinted === true, papers }];
  });
}

export interface WindowsFinding {
  ok: boolean;
  message: string;
  /** Repair the doctor can run with `--fix`. */
  fix?: "keep-printed";
}

/**
 * Checks one DS620 printer.
 *
 * CRITICAL(windows): the DNP driver name is assumed to contain "DS620" (e.g.
 * "DP-DS620"). Windows may also add the printer with "Microsoft IPP Class
 * Driver" or a generic driver; those print wrong sizes, like Generic PostScript
 * on macOS. Check the real `DriverName` and tighten the match.
 */
export function diagnoseWindows(p: WindowsPrinterFacts): WindowsFinding[] {
  const findings: WindowsFinding[] = [];
  const dnp = /DS-?620/i.test(p.driver) && !/IPP Class|Generic|Microsoft/i.test(p.driver);
  findings.push(dnp ? { ok: true, message: `Driver: ${p.driver}` } : { ok: false, message: `Driver is "${p.driver}", not the DNP DS620 driver. Install the driver from DNP and set it in the printer's properties.` });
  findings.push(p.keepPrinted
    ? { ok: true, message: "Keeps printed documents (the agent can tell printed from cancelled)" }
    : { ok: false, message: "Printed documents are not kept: the agent cannot tell a printed job from a cancelled one", fix: "keep-printed" });
  const [status, detail] = PRINTER_STATUS[p.status] ?? ["error", `unknown status ${p.status}`];
  findings.push(status === "idle" || status === "printing" ? { ok: true, message: "Printer is ready" } : { ok: false, message: `Printer is ${status}${detail ? ` (${detail})` : ""}` });
  const paper = new RegExp(WIN_PAPER_PATTERN, "i");
  const fits = p.papers.filter((n) => paper.test(n));
  findings.push(fits.length
    ? { ok: true, message: `4x6 paper: ${fits.join(", ")}` }
    : { ok: false, message: `No 4x6 paper size in the driver (offers: ${p.papers.slice(0, 12).join(", ") || "none"})` });
  // CRITICAL(windows): Cutter, Finish (glossy), resolution and colour adjustment are not checked:
  // they live in the DNP driver's private settings. Set them once in Printing Preferences.
  findings.push({ ok: true, message: "Not checked: cutter, finish, resolution and colour adjustment. Set them in Printing Preferences." });
  return findings;
}

/** `doctor` on Windows. Returns 0 when everything is fine (after fixing), 1 otherwise. */
export async function runWindowsDoctor(opts: { queue?: string; fix: boolean; ps?: PowerShell; print?: (line: string) => void }): Promise<number> {
  const ps = opts.ps ?? execPowerShell;
  const print = opts.print ?? console.log;
  print(`BETA ${WINDOWS_BETA_NOTICE}`);
  if (opts.queue && !isSafePrinterName(opts.queue)) {
    print(`FAIL Invalid Windows printer name: ${opts.queue}`);
    return 1;
  }
  const gather = async () => {
    const r = await ps(DOCTOR_FACTS_SCRIPT, opts.queue ? { PSA_PRINTER: opts.queue } : {}, { timeoutMs: 30_000 });
    return r.code === 0 ? { ok: true as const, list: parseDoctorFacts(r.stdout) } : { ok: false as const, error: firstLine(r.stderr || r.stdout) };
  };
  let found = await gather();
  if (!found.ok) {
    print(`FAIL Could not read the printers through PowerShell: ${found.error}`);
    return 1;
  }
  if (found.list.length > 1) {
    print(`Several DS620 printers: ${found.list.map((p) => `"${p.name}"`).join(", ")}. Pick one with --printer "<name>".`);
    return 1;
  }
  let p = found.list[0];
  if (!p) {
    // TODO(windows): unlike the CUPS doctor, this cannot add the printer. Windows normally adds a USB printer by itself once the DNP driver is installed.
    print(opts.queue ? `FAIL No printer named "${opts.queue}".` : "FAIL No DS620 printer found. Install the DNP driver, connect and switch on the printer, then run doctor again.");
    return 1;
  }
  print(`Printer: ${p.name} (port ${p.port})`);
  let findings = diagnoseWindows(p);
  const mark = (f: WindowsFinding) => print(`  ${f.ok ? "ok  " : "FAIL"} ${f.message}${!f.ok && f.fix && !opts.fix ? "\n         fix: node agent.mjs doctor --fix (in an Administrator terminal)" : ""}`);
  findings.forEach(mark);
  if (opts.fix && findings.some((f) => f.fix === "keep-printed")) {
    print("\nFixing:");
    print(`  $ Set-Printer -Name "${p.name}" -KeepPrintedJobs $true`);
    const r = await ps(KEEP_PRINTED_SCRIPT, { PSA_PRINTER: p.name }, { timeoutMs: 30_000 });
    if (r.code !== 0) {
      const msg = firstLine(r.stderr || r.stdout);
      print(`  FAIL ${msg}${/denied|access|privilege|permission/i.test(msg) ? "\n       Needs admin rights: run the same command in an Administrator terminal." : ""}`);
      return 1;
    }
    print("\nAfter fixing:");
    found = await gather();
    const name = p.name;
    p = found.ok ? found.list.find((x) => x.name === name) : undefined;
    if (!p) return 1;
    findings = diagnoseWindows(p);
    findings.forEach(mark);
  }
  const failing = findings.filter((f) => !f.ok);
  print(failing.length ? `\n${failing.length} problem(s).` : `\nAll good. Start the agent with --printer "${p.name}"`);
  return failing.length ? 1 : 0;
}

function parseJson<T>(output: string): T | null {
  try {
    return JSON.parse(output.trim()) as T;
  } catch {
    return null;
  }
}

function firstLine(s: string): string {
  return (s.split("\n").find((l) => l.trim()) ?? "").trim().slice(0, 160);
}
