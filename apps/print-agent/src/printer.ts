import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { JOB_STATE_TEST, jobNumber, lpArgs, parseJobState, parseLpstat, parseRequestId, type PrinterStatus } from "./cups.js";

const run = promisify(execFile);

/** Where a submitted job stands. `waiting` covers a printer that is off or busy: CUPS keeps the job. */
export type JobOutcome = { kind: "done" } | { kind: "failed"; reason: string } | { kind: "waiting"; detail: string };

/**
 * One way to put a PNG on paper: real CUPS or the simulator (SPEC §11.2).
 * A print is submitted exactly once; the agent then polls `check` until it is
 * done or failed, and `cancel`s it before any retry (no duplicate copies).
 */
export interface Printer {
  readonly mode: "cups" | "simulate";
  readonly queue: string;
  /** Hands the PNG to the printer; returns the printer's job id. */
  submit(png: Buffer, jobId: string, signal: AbortSignal): Promise<string>;
  check(printerJobId: string): Promise<JobOutcome>;
  /** Removes a submitted job so it can never print later. Safe to call on finished jobs. */
  cancel(printerJobId: string): Promise<void>;
  status(): Promise<{ status: PrinterStatus; detail: string }>;
  /** Start-up diagnostics: the queue's options, to check against the DS620 (PROTOCOL.md §5). */
  describe(): Promise<string>;
}

/** States in which the printer cannot take a job now. Prints stay queued. */
export const NOT_READY: readonly PrinterStatus[] = ["offline", "paused", "out_of_paper", "error"];

/** CUPS via `lp` / `ipptool` / `cancel`, called with execFile (never a shell). */
export function cupsPrinter(queue: string, tmpDir: string): Printer {
  // Validate once at start-up (throws on an unsafe name).
  lpArgs(queue, "/dev/null");
  const printerUri = `ipp://localhost/printers/${queue}`;
  const testFile = path.join(tmpDir, "job-state.test");
  return {
    mode: "cups",
    queue,
    async submit(png, jobId, signal) {
      await mkdir(tmpDir, { recursive: true });
      const file = path.join(tmpDir, `${jobId.replace(/[^A-Za-z0-9_-]/g, "")}.png`);
      await writeFile(file, png);
      const { stdout } = await run("lp", lpArgs(queue, file), { signal, timeout: 30_000 });
      const id = parseRequestId(stdout);
      if (!id) throw new Error(`lp did not return a request id: ${stdout.trim().slice(0, 120)}`);
      return id;
    },
    async check(printerJobId) {
      const n = jobNumber(printerJobId);
      if (!n) return { kind: "failed", reason: `unknown printer job ${printerJobId}` };
      await mkdir(tmpDir, { recursive: true });
      await writeFile(testFile, JOB_STATE_TEST);
      let out: string;
      try {
        out = (await run("ipptool", ["-t", "-T", "10", "-d", `job-id=${n}`, printerUri, testFile], { timeout: 15_000 })).stdout;
      } catch (err) {
        // ipptool exits non-zero when the job is gone (purged): nothing will print.
        const e = err as { stdout?: string };
        out = e.stdout ?? "";
        if (!/job-state \(enum\)/.test(out)) return /not.found|client-error/i.test(out) ? { kind: "failed", reason: "printer job disappeared" } : { kind: "waiting", detail: "printer status unavailable" };
      }
      const { state, reasons } = parseJobState(out);
      if (state === "completed") return { kind: "done" };
      if (state === "canceled" || state === "aborted") return { kind: "failed", reason: `printer job ${state}${reasons ? ` (${reasons})` : ""}` };
      const st = await this.status();
      return { kind: "waiting", detail: st.detail || st.status };
    },
    async cancel(printerJobId) {
      await run("cancel", [printerJobId], { timeout: 15_000 }).catch(() => {});
    },
    async status() {
      try {
        const { stdout } = await run("lpstat", ["-p", queue], { timeout: 10_000 });
        return parseLpstat(stdout, 0);
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string; code?: number };
        return parseLpstat(`${e.stdout ?? ""}${e.stderr ?? ""}`, typeof e.code === "number" ? e.code : 1);
      }
    },
    async describe() {
      try {
        const { stdout } = await run("lpoptions", ["-p", queue, "-l"], { timeout: 10_000 });
        // Only the print-relevant options; the colour sliders are long and noisy.
        return stdout
          .split("\n")
          .filter((l) => /^(PageSize|Cutter|Finish|Resolution)\//.test(l))
          .join("; ");
      } catch (err) {
        return `lpoptions failed: ${(err as Error).message}`;
      }
    },
  };
}

/**
 * Simulator (SPEC §11.2): no printer needed. "Printing" writes the PNG to
 * `outDir` after a short delay that imitates a real print.
 */
export function simulatedPrinter(outDir: string, delayMs = 4_000): Printer {
  type SimJob = { finished: boolean; cancelled: boolean; error?: string };
  const jobs = new Map<string, SimJob>();
  let next = 0;
  return {
    mode: "simulate",
    queue: "simulator",
    async submit(png, jobId, signal) {
      const id = `simulator-${++next}`;
      const entry: SimJob = { finished: false, cancelled: false };
      void (async () => {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, delayMs);
          signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
        });
        // Like a CUPS cancel: a cancelled job never reaches paper.
        if (signal.aborted || entry.cancelled) {
          entry.error = entry.cancelled ? "canceled" : "aborted";
          return;
        }
        await mkdir(outDir, { recursive: true });
        await writeFile(path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, "-")}_${jobId.replace(/[^A-Za-z0-9_-]/g, "")}.png`), png);
      })()
        .catch((err: Error) => void (entry.error = err.message))
        .finally(() => void (entry.finished = true));
      jobs.set(id, entry);
      return id;
    },
    async check(id) {
      const j = jobs.get(id);
      if (!j) return { kind: "failed", reason: "simulator restarted" };
      if (!j.finished) return { kind: "waiting", detail: "printing" };
      return j.error ? { kind: "failed", reason: j.error } : { kind: "done" };
    },
    async cancel(id) {
      const j = jobs.get(id);
      if (j) j.cancelled = true;
    },
    async status() {
      return { status: [...jobs.values()].some((j) => !j.finished) ? "printing" : "idle", detail: "" };
    },
    async describe() {
      return `simulator writing to ${path.resolve(outDir)}`;
    },
  };
}
