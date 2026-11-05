import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CP70_OPTIONS, DS620_OPTIONS, isSafeQueueName, parseLpstat, type Driver } from "./cups.js";

/**
 * `node agent.mjs doctor`: checks the booth computer's CUPS queue for a supported
 * printer (see PROFILES) and, with `--fix`, repairs it. Pure parsing and planning
 * here; the commands run through an injectable `run` (execFile, never a shell).
 */

/** What the doctor needs to know about one supported printer; add one here to teach it a new model. */
export interface PrinterProfile {
  driver: Driver;
  /** Name in messages. */
  label: string;
  /** Finds the printer in a device URI, queue name or `printer-make-and-model`. */
  match: RegExp;
  /** Name for a queue the doctor creates. */
  defaultQueue: string;
  /** Queue defaults the doctor enforces: the print options (cups.ts) plus any neutral image handling. */
  defaults: Record<string, string>;
  /** Options the print command needs; the PPD must offer them. The others in `defaults` are skipped if absent. */
  required: string[];
  /** Where to get the driver, for the "not installed" message. */
  driverHint: string;
  /** Whether a line of `lpinfo -m` (model id, description) is this printer's own driver. */
  isDriver(model: string, description: string): boolean;
}

export const PROFILES: readonly PrinterProfile[] = [
  {
    driver: "ds620",
    label: "DNP DS620",
    match: /DS-?620/i,
    // Matches the one macOS creates.
    defaultQueue: "Dai_Nippon_Printing_DP_DS620",
    defaults: {
      ...DS620_OPTIONS,
      // No driver colour, brightness or sharpness changes: prints match the screen.
      AdjustmentsEnabled: "False",
      // One print per job; bonus prints would add copies nobody asked for.
      BonusPrint: "False",
    },
    required: Object.keys(DS620_OPTIONS),
    driverHint: "Install it from DNP (dnpphoto.com)",
    // TODO(linux): only matches DNP's PPD (`…/DNP-DS620.ppd.gz`). Gutenprint lists it as
    // `gutenprint.5.3://dnp-ds620/expert`, which has no `.ppd` suffix, so on Linux the
    // doctor reports the driver as missing. Accept that too, together with the Linux
    // option names (see DS620_OPTIONS).
    isDriver: (model, description) => /DS-?620/i.test(model) && /\.ppd(\.gz)?$/i.test(model) && !/DS-?620A/i.test(description),
  },
  {
    driver: "cp70",
    label: "Mitsubishi CP-D70DW",
    match: /CP-?D?70|MITSUBISHI/i,
    defaultQueue: "Mitsubishi_CP_D70DW",
    defaults: { ...CP70_OPTIONS },
    required: Object.keys(CP70_OPTIONS),
    driverHint: "Install Mitsubishi's CP-D70 series driver (mitsubishielectric.com/printer)",
    // The PPD is "MITSUBISHI CP70D Series". The file name was not checked on a real Mac, so this goes by the description.
    // Gutenprint's driver (`gutenprint.…`) names its options differently (see CP70_OPTIONS), so it does not count.
    isDriver: (model, description) => /CP-?D?70/i.test(`${model} ${description}`) && /mitsubishi/i.test(`${model} ${description}`) && !/^gutenprint/i.test(model),
  },
];

/** Names for messages: `ds620 or cp70`. */
export const PROFILE_KEYS = PROFILES.map((p) => p.driver).join(" or ");

export function profileByDriver(driver: string): PrinterProfile | undefined {
  return PROFILES.find((p) => p.driver === driver);
}

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

const matchesProfile = (profile: PrinterProfile, ...texts: string[]) => texts.some((t) => profile.match.test(t));

/** Queues of a supported printer, from `lpstat -v`: `device for Q: usb://Dai%20Nippon%20Printing/DP-DS620?serial=…`. */
export function findQueues(lpstatV: string): { queue: string; profile: PrinterProfile }[] {
  const found: { queue: string; profile: PrinterProfile }[] = [];
  for (const line of lpstatV.split("\n")) {
    const [, queue, uri] = /^device for ([^:]+):\s*(\S+)/.exec(line.trim()) ?? [];
    const profile = queue && uri ? PROFILES.find((p) => matchesProfile(p, safeDecode(uri), queue)) : undefined;
    if (queue && profile) found.push({ queue, profile });
  }
  return found;
}

/** Connected supported printers without a queue, from `lpinfo -v`: `direct usb://Dai%20Nippon%20Printing/DP-DS620?serial=…`. */
export function findDevices(lpinfoV: string): { uri: string; profile: PrinterProfile }[] {
  const found: { uri: string; profile: PrinterProfile }[] = [];
  for (const line of lpinfoV.split("\n")) {
    const uri = line.trim().split(/\s+/)[1];
    const profile = uri && /^usb:/.test(uri) ? PROFILES.find((p) => matchesProfile(p, safeDecode(uri))) : undefined;
    if (uri && profile) found.push({ uri, profile });
  }
  return found;
}

/** The installed driver for a printer, from `lpinfo -m`: `Library/…/DNP-DS620.ppd.gz Dai Nippon Printing DP-DS620, 5.2.7 (CUPS)`. */
export function findModel(lpinfoM: string, profile: PrinterProfile): string | null {
  for (const line of lpinfoM.split("\n")) {
    const [model, ...desc] = line.trim().split(/\s+/);
    if (model && profile.isDriver(model, desc.join(" "))) return model;
  }
  return null;
}

/** Which supported printer a queue is for: its device, then its driver's name, then the page sizes its driver lists. */
export function profileOfQueue(queue: string, lpstatV: string, makeAndModel: string | null, options: ReturnType<typeof parsePpdOptions>): PrinterProfile | null {
  const device = findQueues(lpstatV).find((q) => q.queue === queue)?.profile;
  if (device) return device;
  const byDriver = makeAndModel ? PROFILES.find((p) => p.match.test(makeAndModel)) : undefined;
  if (byDriver) return byDriver;
  const sizes = options.get("PageSize")?.choices ?? [];
  return PROFILES.find((p) => p.defaults.PageSize && sizes.includes(p.defaults.PageSize)) ?? null;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export interface Finding {
  ok: boolean;
  message: string;
  /** Command that fixes it (program and arguments), if the doctor can. */
  fix?: string[];
}

export interface QueueFacts {
  queue: string;
  profile: PrinterProfile;
  makeAndModel: string | null;
  options: ReturnType<typeof parsePpdOptions>;
  lpstat: { output: string; exitCode: number };
  accepting: boolean;
  /** The printer's own installed driver, for switching away from a generic one. */
  model: string | null;
}

/** What is wrong with a queue and how to fix it, in order. Driver first: the other options depend on it. */
export function diagnose(f: QueueFacts): Finding[] {
  const findings: Finding[] = [];
  const { profile } = f;
  const isOwnDriver = !!f.makeAndModel && profile.match.test(f.makeAndModel) && !!f.options.get("PageSize")?.choices.includes(profile.defaults.PageSize ?? "");
  if (!isOwnDriver) {
    findings.push({
      ok: false,
      message: `Driver is "${f.makeAndModel ?? "unknown"}", not the ${profile.label} driver`,
      ...(f.model
        ? { fix: ["lpadmin", "-p", f.queue, "-m", f.model, "-E"] }
        : { message: `Driver is "${f.makeAndModel ?? "unknown"}" and the ${profile.label} driver is not installed. ${profile.driverHint}, then run doctor again.` }),
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
  for (const [key, want] of Object.entries(profile.defaults)) {
    const opt = f.options.get(key);
    if (!opt) {
      if (profile.required.includes(key)) findings.push({ ok: false, message: `The driver has no ${key} option; the print command needs ${key}=${want}` });
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

async function facts(run: Run, queue: string, profile: PrinterProfile, model: string | null): Promise<QueueFacts> {
  const [opts, list, stat, accept] = await Promise.all([
    run("lpoptions", ["-p", queue]),
    run("lpoptions", ["-p", queue, "-l"]),
    run("lpstat", ["-p", queue]),
    run("lpstat", ["-a", queue]),
  ]);
  return {
    queue,
    profile,
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
 *
 * Which printer it is for comes from the queue (its device, then its driver); `profile` (--model) overrides that,
 * and narrows the search when no queue is given.
 */
export async function runDoctor(opts: { queue?: string; profile?: PrinterProfile; fix: boolean; run?: Run; print?: (line: string) => void }): Promise<number> {
  const run = opts.run ?? execRun;
  const print = opts.print ?? console.log;
  const mark = (f: Finding) => print(`  ${f.ok ? "ok  " : "FAIL"} ${f.message}${!f.ok && f.fix && !opts.fix ? `\n         fix: ${f.fix.join(" ")}` : ""}`);

  if ((await run("lpstat", ["-r"])).code !== 0) {
    print("FAIL CUPS is not running or not installed (lpstat -r failed).");
    return 1;
  }
  let queue = opts.queue;
  let profile = opts.profile;
  if (queue && !isSafeQueueName(queue)) {
    print(`FAIL Invalid CUPS queue name: ${queue}`);
    return 1;
  }
  const lpinfoM = (await run("lpinfo", ["-m"])).stdout;
  const supported = (opts.profile ? [opts.profile] : PROFILES).map((p) => p.label).join(" or ");

  if (!queue) {
    const found = findQueues((await run("lpstat", ["-v"])).stdout).filter((q) => !opts.profile || q.profile === opts.profile);
    if (found.length > 1) {
      print(`Several printer queues: ${found.map((q) => `${q.queue} (${q.profile.label})`).join(", ")}. Pick one with --printer <queue>.`);
      return 1;
    }
    if (found[0]) ({ queue, profile } = { queue: found[0].queue, profile: found[0].profile });
  }
  if (!queue) {
    const devices = findDevices((await run("lpinfo", ["-v"])).stdout).filter((d) => !opts.profile || d.profile === opts.profile);
    const device = devices[0];
    if (!device) {
      print(`FAIL No queue and no ${supported} on USB. Connect and switch on the printer, then run doctor again.`);
      return 1;
    }
    if (devices.length > 1) {
      print(`Several printers on USB: ${devices.map((d) => `${d.profile.label} (${d.uri})`).join(", ")}. Pick one with --model ${PROFILES.map((p) => p.driver).join("|")}.`);
      return 1;
    }
    const model = findModel(lpinfoM, device.profile);
    if (!model) {
      print(`FAIL Found a ${device.profile.label} on USB (${device.uri}) but its driver is not installed. ${device.profile.driverHint}, then run doctor again.`);
      return 1;
    }
    const create = ["lpadmin", "-p", device.profile.defaultQueue, "-v", device.uri, "-m", model, "-E"];
    if (!opts.fix) {
      print(`FAIL Found a ${device.profile.label} on USB but no CUPS queue for it.\n         fix: ${create.join(" ")}`);
      return 1;
    }
    print(`Creating queue ${device.profile.defaultQueue} for ${device.uri}`);
    if (!(await apply(run, print, create))) return 1;
    queue = device.profile.defaultQueue;
    profile = device.profile;
  }
  if (!profile) {
    // An explicit queue: find out which printer it is for.
    const first = await facts(run, queue, PROFILES[0] as PrinterProfile, null);
    profile = profileOfQueue(queue, (await run("lpstat", ["-v"])).stdout, first.makeAndModel, first.options) ?? undefined;
    if (!profile) {
      print(`FAIL Cannot tell which printer queue ${queue} is for (supported: ${PROFILES.map((p) => p.label).join(", ")}). Pass --model ${PROFILES.map((p) => p.driver).join("|")}.`);
      return 1;
    }
  }

  const model = findModel(lpinfoM, profile);
  print(`Queue: ${queue} (${profile.label})`);
  let findings = diagnose(await facts(run, queue, profile, model));
  findings.forEach(mark);
  const fixes = findings.filter((f) => !f.ok && f.fix);
  if (opts.fix && fixes.length) {
    print("\nFixing:");
    for (const f of fixes) if (f.fix && !(await apply(run, print, f.fix))) return 1;
    // The driver change unlocks the option checks, so look again from scratch.
    print("\nAfter fixing:");
    findings = diagnose(await facts(run, queue, profile, model));
    findings.forEach(mark);
    const again = findings.filter((f) => !f.ok && f.fix);
    for (const f of again) if (f.fix && !(await apply(run, print, f.fix))) return 1;
    if (again.length) findings = diagnose(await facts(run, queue, profile, model));
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
