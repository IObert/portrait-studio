import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { isCompleted, lpArgs, parseLpstat, parseRequestId, type PrinterStatus } from "./cups.js";

const run = promisify(execFile);

/** One way to put a PNG on paper: real CUPS or the simulator (SPEC §11.2). */
export interface Printer {
  readonly mode: "cups" | "simulate";
  readonly queue: string;
  /** Prints and resolves once the job has finished; throws on failure. */
  print(png: Buffer, jobId: string, signal: AbortSignal): Promise<void>;
  status(): Promise<{ status: PrinterStatus; detail: string }>;
  /** Start-up diagnostics: the queue's options, to check against the DS620 (PROTOCOL.md §5). */
  describe(): Promise<string>;
}

/** CUPS via `lp` / `lpstat`, called with execFile (never a shell). */
export function cupsPrinter(queue: string, tmpDir: string): Printer {
  // Validate once at start-up (throws on an unsafe name).
  lpArgs(queue, "/dev/null");
  return {
    mode: "cups",
    queue,
    async print(png, jobId, signal) {
      await mkdir(tmpDir, { recursive: true });
      const file = path.join(tmpDir, `${jobId.replace(/[^A-Za-z0-9_-]/g, "")}.png`);
      await writeFile(file, png);
      const { stdout } = await run("lp", lpArgs(queue, file), { signal, timeout: 30_000 });
      const id = parseRequestId(stdout);
      if (!id) throw new Error(`lp did not return a request id: ${stdout.trim().slice(0, 120)}`);
      // Wait for CUPS to finish the job (SPEC §11.2), up to 5 minutes.
      for (let i = 0; i < 150; i++) {
        if (signal.aborted) throw new Error("aborted");
        const done = await run("lpstat", ["-W", "completed", "-o", queue], { signal, timeout: 15_000 }).catch(() => ({ stdout: "" }));
        if (isCompleted(done.stdout, id)) return;
        const st = await this.status();
        if (st.status === "error" || st.status === "out_of_paper" || st.status === "offline" || st.status === "paused") throw new Error(`printer ${st.status}: ${st.detail}`);
        await new Promise((r) => setTimeout(r, 2_000));
      }
      throw new Error("timed out waiting for the print to finish");
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
        return stdout.trim();
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
  let busy = false;
  return {
    mode: "simulate",
    queue: "simulator",
    async print(png, jobId, signal) {
      busy = true;
      try {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, delayMs);
          signal.addEventListener("abort", () => (clearTimeout(t), reject(new Error("aborted"))), { once: true });
        });
        await mkdir(outDir, { recursive: true });
        await writeFile(path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, "-")}_${jobId.replace(/[^A-Za-z0-9_-]/g, "")}.png`), png);
      } finally {
        busy = false;
      }
    },
    async status() {
      return { status: busy ? "printing" : "idle", detail: "" };
    },
    async describe() {
      return `simulator writing to ${path.resolve(outDir)}`;
    },
  };
}
