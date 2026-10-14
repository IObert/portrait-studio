/**
 * CUPS command building and status parsing for the DNP DS620, 4x6 (SPEC §11.2).
 * Pure functions; the process calls live in printer.ts.
 */

/**
 * `lp` arguments for one borderless 4x6 print. Option names come from SPEC
 * §11.2 and must be checked on a real DS620 with `lpoptions -p <queue> -l`;
 * the agent logs that output at start-up (PROTOCOL.md §5).
 */
export function lpArgs(queue: string, file: string): string[] {
  // No leading dash: lp would read it as an option (argument injection).
  if (!/^[A-Za-z0-9_.][A-Za-z0-9_.-]{0,126}$/.test(queue)) throw new Error("Invalid CUPS queue name");
  return [
    "-d", queue,
    "-o", "PageSize=dnp6x4",
    "-o", "Cutter=Normal",
    "-o", "Finish=Glossy",
    "-o", "Resolution=300x300dpi",
    // Borderless: fill the page, no margins, keep portrait orientation.
    "-o", "fit-to-page",
    "-o", "print-scaling=fill",
    "-o", "orientation-requested=3",
    "--", file,
  ];
}

/** `lp` prints `request id is DS620-12 (1 file(s))`. */
export function parseRequestId(lpOutput: string): string | null {
  return /request id is (\S+)/.exec(lpOutput)?.[1] ?? null;
}

export type PrinterStatus = "idle" | "printing" | "offline" | "paused" | "out_of_paper" | "error";

/**
 * Printer state from `lpstat -p <queue>` (SPEC §11.2: offline, paused,
 * out-of-paper and error). `detail` is a short, non-personal reason.
 */
export function parseLpstat(output: string, exitCode: number): { status: PrinterStatus; detail: string } {
  const text = output.trim();
  const lower = text.toLowerCase();
  if (exitCode !== 0 || !text || /invalid destination|does not exist|unknown destination|not found/.test(lower)) return { status: "offline", detail: firstLine(text) || "queue not found" };
  if (/out of paper|media.?empty|media.?needed|no media|ribbon/.test(lower)) return { status: "out_of_paper", detail: firstLine(text) };
  if (/disabled|paused|stopped/.test(lower)) return { status: "paused", detail: firstLine(text) };
  if (/offline|not connected|unable to connect|unplugged|waiting for printer/.test(lower)) return { status: "offline", detail: firstLine(text) };
  if (/error|fault|failed/.test(lower)) return { status: "error", detail: firstLine(text) };
  if (/now printing|is printing|processing/.test(lower)) return { status: "printing", detail: "" };
  if (/is idle|enabled/.test(lower)) return { status: "idle", detail: "" };
  return { status: "error", detail: firstLine(text) };
}

function firstLine(s: string): string {
  return (s.split("\n").find((l) => l.trim()) ?? "").trim().slice(0, 160);
}

/**
 * CUPS job ids look like `<queue>-<n>`; IPP wants the number. `lpstat -W
 * completed` also lists cancelled and aborted jobs, so the real state is read
 * with `ipptool` (shipped with CUPS) instead.
 */
export function jobNumber(requestId: string): number | null {
  const n = Number(/-(\d+)$/.exec(requestId)?.[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** IPP Get-Job-Attributes test file for `ipptool`; `$job-id` comes from `-d job-id=<n>`. */
export const JOB_STATE_TEST = `{
  OPERATION Get-Job-Attributes
  GROUP operation-attributes-tag
  ATTR charset attributes-charset utf-8
  ATTR naturalLanguage attributes-natural-language en
  ATTR uri printer-uri $uri
  ATTR integer job-id $job-id
  ATTR name requesting-user-name $user
  ATTR keyword requested-attributes job-state,job-state-reasons
  DISPLAY job-state
  DISPLAY job-state-reasons
}
`;

/** IPP job states (RFC 8011 §5.3.7). Only `completed` means it is on paper. */
export type JobState = "pending" | "held" | "processing" | "stopped" | "canceled" | "aborted" | "completed" | "unknown";

/** Reads `job-state (enum) = completed` from `ipptool -t` output. */
export function parseJobState(output: string): { state: JobState; reasons: string } {
  const state = /job-state \(enum\) = ([a-z-]+)/.exec(output)?.[1];
  const reasons = /job-state-reasons \([^)]*\) = (.+)/.exec(output)?.[1]?.trim() ?? "";
  const known: JobState[] = ["pending", "held", "processing", "stopped", "canceled", "aborted", "completed"];
  const normalised = state === "pending-held" ? "held" : state === "processing-stopped" ? "stopped" : state;
  return { state: known.includes(normalised as JobState) ? (normalised as JobState) : "unknown", reasons };
}
