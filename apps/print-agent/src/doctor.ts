import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DS620_OPTIONS, isSafeQueueName, parseLpstat } from "./cups.js";

/**
 * `node agent.mjs doctor`: checks the booth computer's DS620 CUPS queue and,
 * with `--fix`, repairs it. Pure parsing and planning here; the commands run
 * through an injectable `run` (execFile, never a shell).
 */

/** Queue defaults the doctor enforces: the print options plus neutral image handling. */
export const DOCTOR_DEFAULTS: Record<string, string> = {
  ...DS620_OPTIONS,
  // No driver colour, brightness or sharpness changes: prints match the screen.
  AdjustmentsEnabled: "False",
  // One print per job; bonus prints would add copies nobody asked for.
  BonusPrint: "False",
};

/** Options the print command needs; the PPD must offer them. The others are skipped if absent. */
const REQUIRED = Object.keys(DS620_OPTIONS);

/** `lpoptions -p <queue> -l` lines: `PageSize/Media Size: dnp5x3.5 *dnp6x4 dnp5x7`. */
export function parsePpdOptions(output: string): Map<string, { current: string | null; choices: string[] }> {
  const out = new Map<string, { current: string | null; choices: string[] }>();
  for (const line of output.split("\n")) {
    const [, key, rest] = /^([^/:\s]+)\/[^:]*:\s*(.*)$/.exec(line.trim()) ?? [];
    if (!key || rest === undefined) continue;
    const words = rest.split(/\s+/).filter(Boolean);
    const current = words.find((w) => w.startsWith("*"))?.slice(1) ?? null;
    out.set(key, { current, choices: words.map((w) => w.replace(/^\*/, "")) });
  }
  return out;
}

/** `printer-make-and-model='Dai Nippon Printing DP-DS620, 5.2.7'` from `lpoptions -p <queue>`. */
export function parseMakeAndModel(output: string): string | null {
  return /printer-make-and-model=(?:'([^']*)'|"([^"]*)"|(\S+))/.exec(output)?.slice(1).find((v) => v !== undefined) ?? null;
}

const DS620 = /DS-?620/i;

/** Queues whose device is a DS620, from `lpstat -v`: `device for Q: usb://Dai%20Nippon%20Printing/DP-DS620?serial=…`. */
export function findDs620Queues(lpstatV: string): string[] {
  const queues: string[] = [];
  for (const line of lpstatV.split("\n")) {
    const [, queue, uri] = /^device for ([^:]+):\s*(\S+)/.exec(line.trim()) ?? [];
    if (queue && uri && (DS620.test(decodeURIComponent(uri)) || DS620.test(queue))) queues.push(queue);
  }
  return queues;
}

/** A connected DS620 without a queue, from `lpinfo -v`: `direct usb://Dai%20Nippon%20Printing/DP-DS620?serial=…`. */
export function findDs620Device(lpinfoV: string): string | null {
  for (const line of lpinfoV.split("\n")) {
    const uri = line.trim().split(/\s+/)[1];
    if (uri && /^usb:/.test(uri) && DS620.test(decodeURIComponent(uri))) return uri;
  }
  return null;
}

/**
 * The installed DS620 driver, from `lpinfo -m`: `Library/…/DNP-DS620.ppd.gz Dai Nippon Printing DP-DS620, 5.2.7 (CUPS)`.
 *
 * TODO(linux): only matches DNP's PPD (`…/DNP-DS620.ppd.gz`). Gutenprint lists it as
 * `gutenprint.5.3://dnp-ds620/expert`, which has no `.ppd` suffix, so on Linux the
 * doctor reports the driver as missing. Accept that too, together with the Linux
 * option names (see DS620_OPTIONS).
 */
export function findDs620Model(lpinfoM: string): string | null {
  for (const line of lpinfoM.split("\n")) {
    const [model, ...desc] = line.trim().split(/\s+/);
    if (model && DS620.test(model) && /\.ppd(\.gz)?$/i.test(model) && !/DS-?620A/i.test(desc.join(" "))) return model;
  }
  return null;
}

export interface Finding {
  ok: boolean;
  message: string;
  /** Command that fixes it (program and arguments), if the doctor can. */
  fix?: string[];
}

export interface QueueFacts {
  queue: string;
  makeAndModel: string | null;
  options: ReturnType<typeof parsePpdOptions>;
  lpstat: { output: string; exitCode: number };
  accepting: boolean;
  /** Installed DS620 driver, for switching away from a generic one. */
  model: string | null;
}

/** What is wrong with a queue and how to fix it, in order. Driver first: the other options depend on it. */
export function diagnose(f: QueueFacts): Finding[] {
  const findings: Finding[] = [];
  const isDs620Driver = !!f.makeAndModel && DS620.test(f.makeAndModel) && !!f.options.get("PageSize")?.choices.includes(DS620_OPTIONS.PageSize);
  if (!isDs620Driver) {
    findings.push({
      ok: false,
      message: `Driver is "${f.makeAndModel ?? "unknown"}", not the DNP DS620 driver`,
      ...(f.model
        ? { fix: ["lpadmin", "-p", f.queue, "-m", f.model, "-E"] }
        : { message: `Driver is "${f.makeAndModel ?? "unknown"}" and the DNP DS620 driver is not installed. Install it from DNP (dnpphoto.com), then run doctor again.` }),
    });
    // Option checks against the wrong driver would only add noise.
    return findings;
  }
  findings.push({ ok: true, message: `Driver: ${f.makeAndModel}` });

  const { status, detail } = parseLpstat(f.lpstat.output, f.lpstat.exitCode);
  if (status === "paused") findings.push({ ok: false, message: `Queue is paused (${detail})`, fix: ["cupsenable", f.queue] });
  else findings.push({ ok: status === "idle" || status === "printing", message: `Printer status: ${status}${detail ? ` (${detail})` : ""}` });
  findings.push(f.accepting ? { ok: true, message: "Queue accepts jobs" } : { ok: false, message: "Queue rejects jobs", fix: ["cupsaccept", f.queue] });

  const wrong: string[] = [];
  for (const [key, want] of Object.entries(DOCTOR_DEFAULTS)) {
    const opt = f.options.get(key);
    if (!opt) {
      if (REQUIRED.includes(key)) findings.push({ ok: false, message: `The driver has no ${key} option; the print command needs ${key}=${want}` });
      continue;
    }
    if (!opt.choices.includes(want)) findings.push({ ok: false, message: `${key} does not offer ${want} (choices: ${opt.choices.slice(0, 10).join(" ")})` });
    else if (opt.current !== want) wrong.push(`${key}=${want}`);
    else findings.push({ ok: true, message: `${key}=${want}` });
  }
  if (wrong.length) findings.push({ ok: false, message: `Defaults to set: ${wrong.join(", ")}`, fix: ["lpadmin", "-p", f.queue, ...wrong.flatMap((o) => ["-o", o])] });
  return findings;
}

export type Run = (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string; code: number }>;

const execFileP = promisify(execFile);

export const execRun: Run = async (cmd, args) => {
  try {
    const { stdout, stderr } = await execFileP(cmd, args, { timeout: 30_000 });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number | string; message: string };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? e.message, code: typeof e.code === "number" ? e.code : 127 };
  }
};

/** Queue name for a new DS620 queue, matching the one macOS creates. */
export const DEFAULT_QUEUE = "Dai_Nippon_Printing_DP_DS620";

async function facts(run: Run, queue: string, model: string | null): Promise<QueueFacts> {
  const [opts, list, stat, accept] = await Promise.all([
    run("lpoptions", ["-p", queue]),
    run("lpoptions", ["-p", queue, "-l"]),
    run("lpstat", ["-p", queue]),
    run("lpstat", ["-a", queue]),
  ]);
  return {
    queue,
    makeAndModel: parseMakeAndModel(opts.stdout),
    options: parsePpdOptions(list.stdout),
    lpstat: { output: `${stat.stdout}${stat.stderr}`, exitCode: stat.code },
    accepting: accept.code === 0 && /accepting requests/.test(accept.stdout) && !/not accepting/.test(accept.stdout),
    model,
  };
}

/**
 * Runs the checks and, with `fix`, the repairs, then checks again. Returns the
 * exit code: 0 when everything is fine (after fixing), 1 otherwise.
 */
export async function runDoctor(opts: { queue?: string; fix: boolean; run?: Run; print?: (line: string) => void }): Promise<number> {
  const run = opts.run ?? execRun;
  const print = opts.print ?? console.log;
  const mark = (f: Finding) => print(`  ${f.ok ? "ok  " : "FAIL"} ${f.message}${!f.ok && f.fix && !opts.fix ? `\n         fix: ${f.fix.join(" ")}` : ""}`);

  if ((await run("lpstat", ["-r"])).code !== 0) {
    print("FAIL CUPS is not running or not installed (lpstat -r failed).");
    return 1;
  }
  const model = findDs620Model((await run("lpinfo", ["-m"])).stdout);

  let queue = opts.queue;
  if (queue && !isSafeQueueName(queue)) {
    print(`FAIL Invalid CUPS queue name: ${queue}`);
    return 1;
  }
  if (!queue) {
    const found = findDs620Queues((await run("lpstat", ["-v"])).stdout);
    if (found.length > 1) {
      print(`Several DS620 queues: ${found.join(", ")}. Pick one with --printer <queue>.`);
      return 1;
    }
    queue = found[0];
  }
  if (!queue) {
    const device = findDs620Device((await run("lpinfo", ["-v"])).stdout);
    if (!device) {
      print("FAIL No DS620 queue and no DS620 on USB. Connect and switch on the printer, then run doctor again.");
      return 1;
    }
    if (!model) {
      print(`FAIL Found a DS620 on USB (${device}) but the DNP DS620 driver is not installed. Install it from DNP, then run doctor again.`);
      return 1;
    }
    const create = ["lpadmin", "-p", DEFAULT_QUEUE, "-v", device, "-m", model, "-E"];
    if (!opts.fix) {
      print(`FAIL Found a DS620 on USB but no CUPS queue for it.\n         fix: ${create.join(" ")}`);
      return 1;
    }
    print(`Creating queue ${DEFAULT_QUEUE} for ${device}`);
    if (!(await apply(run, print, create))) return 1;
    queue = DEFAULT_QUEUE;
  }

  print(`Queue: ${queue}`);
  let findings = diagnose(await facts(run, queue, model));
  findings.forEach(mark);
  const fixes = findings.filter((f) => !f.ok && f.fix);
  if (opts.fix && fixes.length) {
    print("\nFixing:");
    for (const f of fixes) if (f.fix && !(await apply(run, print, f.fix))) return 1;
    // The driver change unlocks the option checks, so look again from scratch.
    print("\nAfter fixing:");
    findings = diagnose(await facts(run, queue, model));
    findings.forEach(mark);
    const again = findings.filter((f) => !f.ok && f.fix);
    for (const f of again) if (f.fix && !(await apply(run, print, f.fix))) return 1;
    if (again.length) findings = diagnose(await facts(run, queue, model));
  }
  const failing = findings.filter((f) => !f.ok);
  print(failing.length ? `\n${failing.length} problem(s).${!opts.fix && fixes.length ? " Run again with --fix to repair what can be fixed." : ""}` : `\nAll good. Start the agent with --printer ${queue}`);
  return failing.length ? 1 : 0;
}

async function apply(run: Run, print: (line: string) => void, [cmd, ...args]: string[]): Promise<boolean> {
  if (!cmd) return false;
  print(`  $ ${[cmd, ...args].join(" ")}`);
  const r = await run(cmd, args);
  if (r.code === 0) return true;
  const msg = (r.stderr || r.stdout).trim().split("\n")[0] ?? "";
  print(`  FAIL ${msg}${/forbidden|not authorized|permission|unauthorized/i.test(msg) ? "\n       Needs admin rights: run the same command with sudo." : ""}`);
  return false;
}
