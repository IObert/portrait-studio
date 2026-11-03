import { describe, expect, it } from "vitest";
import { diagnose, findDevices, findModel, findQueues, parseMakeAndModel, parsePpdOptions, PROFILES, profileOfQueue, runDoctor, type PrinterProfile, type Run } from "../src/doctor.js";

const DS = PROFILES[0] as PrinterProfile;
const CP = PROFILES[1] as PrinterProfile;

const Q = "Dai_Nippon_Printing_DP_DS620";
const MODEL = "Library/Printers/PPDs/Contents/Resources/DNP-DS620.ppd.gz";
const URI = "usb://Dai%20Nippon%20Printing/DP-DS620?serial=DB6C5C104681";

// Captured from the booth Mac with the DNP-DS620 PPD (trimmed).
const DS620_L = `PageSize/Media Size: dnp5x3.5 dnp5x5 dnp6x6 *dnp6x4 dnp5x7 dnp6x8 dnp6x9 dnp6x4.5
Cutter/Cutter: *Normal NoWaste 2Inch
Finish/Finish: *Glossy Matte FineMatte Luster
Resolution/Resolution: *300x300dpi 300x600dpi
ColorModel/ColorModel: *RGB
BonusPrint/Bonus Prints: *False True
AdjustmentsEnabled/Enable Image adjustment?: True *False
`;
// The CP-D70DW queue the agent was checked against (cups-queue.test.ts): its driver lists the ME_10x15 page.
const CP70_Q = "MITSUBISHI_CP60D70D707D";
const CP70_MODEL = "Library/Printers/Mitsubishi/CP70D.ppd.gz";
const CP70_URI = "usb://MITSUBISHI/CP-D70DW?serial=123456";
const CP70_L = `PageSize/Media Size: ME_9x13 *ME_10x15 ME_13x18
Resolution/Output Resolution: *300dpi
`;
const GENERIC_L = `PageSize/Media Size: *Letter A4 4x6
Resolution/Resolution: *default
`;

/** A fake CUPS: commands read and change `state`. */
function fakeCups(state: { model: string; options: string; enabled: boolean; accepting: boolean; queue: boolean }) {
  const calls: string[] = [];
  const ok = (stdout = "") => ({ stdout, stderr: "", code: 0 });
  const run: Run = async (cmd, args) => {
    calls.push([cmd, ...args].join(" "));
    const key = [cmd, ...args].join(" ");
    if (key === "lpstat -r") return ok("scheduler is running\n");
    if (key === "lpinfo -m") return ok(`${MODEL} Dai Nippon Printing DP-DS620, 5.2.7 (build 669_EU) (CUPS)\ndrv:///sample.drv/generic.ppd Generic PostScript Printer\n`);
    if (key === "lpinfo -v") return ok(`network ipp\ndirect ${URI}\n`);
    if (key === "lpstat -v") return ok(state.queue ? `device for ${Q}: ${URI}\ndevice for HP_OfficeJet: usb://HP/OfficeJet\n` : `device for HP_OfficeJet: usb://HP/OfficeJet\n`);
    if (!state.queue && args.includes(Q) && cmd !== "lpadmin") return { stdout: "", stderr: `lpstat: Invalid destination name in list "${Q}".`, code: 1 };
    if (key === `lpoptions -p ${Q}`) return ok(`device-uri=${URI} printer-make-and-model='${state.model}' printer-is-shared=false`);
    if (key === `lpoptions -p ${Q} -l`) return ok(state.options);
    if (key === `lpstat -p ${Q}`) return ok(state.enabled ? `printer ${Q} is idle.  enabled since Wed Oct 14 15:56:01 2026\n` : `printer ${Q} disabled since Wed Oct 14 2026 -\n\tPaused\n`);
    if (key === `lpstat -a ${Q}`) return ok(state.accepting ? `${Q} accepting requests since Wed Oct 14 2026\n` : `${Q} not accepting requests since Wed Oct 14 2026 -\n`);
    if (cmd === "cupsenable") return (state.enabled = true), ok();
    if (cmd === "cupsaccept") return (state.accepting = true), ok();
    if (cmd === "lpadmin") {
      state.queue = true;
      if (args.includes("-m")) [state.model, state.options] = ["Dai Nippon Printing DP-DS620, 5.2.7", DS620_L.replace("*Glossy Matte", "Glossy *Matte")];
      for (let i = 0; i < args.length; i++) {
        if (args[i] !== "-o") continue;
        const [k, v] = args[i + 1]!.split("=");
        state.options = state.options.replace(new RegExp(`^(${k}/[^:]*:.*)$`, "m"), (line) => line.replace(/\*/g, "").replace(new RegExp(`(\\s)${v}(\\s|$)`), `$1*${v}$2`));
      }
      if (args.includes("-E")) [state.enabled, state.accepting] = [true, true];
      return ok();
    }
    return { stdout: "", stderr: `unexpected ${key}`, code: 99 };
  };
  return { run, calls, state };
}

describe("doctor parsing (real DS620 output)", () => {
  it("reads PPD options with their defaults", () => {
    const o = parsePpdOptions(DS620_L);
    expect(o.get("PageSize")).toEqual({ current: "dnp6x4", choices: ["dnp5x3.5", "dnp5x5", "dnp6x6", "dnp6x4", "dnp5x7", "dnp6x8", "dnp6x9", "dnp6x4.5"] });
    expect(o.get("AdjustmentsEnabled")?.current).toBe("False");
  });
  it("finds the queue, the USB device and the driver of either printer", () => {
    expect(parseMakeAndModel(`device-uri=x printer-make-and-model='Dai Nippon Printing DP-DS620, 5.2.7' printer-is-shared=false`)).toBe("Dai Nippon Printing DP-DS620, 5.2.7");
    expect(findQueues(`device for ${Q}: ${URI}\ndevice for HP: usb://HP/OfficeJet\n`)).toEqual([{ queue: Q, profile: DS }]);
    expect(findQueues(`device for ${CP70_Q}: ${CP70_URI}\ndevice for HP: usb://HP/OfficeJet\n`)).toEqual([{ queue: CP70_Q, profile: CP }]);
    expect(findDevices(`network ipp\ndirect ${URI}\ndirect ${CP70_URI}\n`)).toEqual([{ uri: URI, profile: DS }, { uri: CP70_URI, profile: CP }]);
    expect(findModel(`${MODEL} Dai Nippon Printing DP-DS620, 5.2.7 (CUPS)\n`, DS)).toBe(MODEL);
    expect(findModel(`${CP70_MODEL} MITSUBISHI CP70D Series (CUPS)\n${MODEL} Dai Nippon Printing DP-DS620, 5.2.7 (CUPS)\n`, CP)).toBe(CP70_MODEL);
    expect(findModel(`${MODEL} Dai Nippon Printing DP-DS620, 5.2.7 (CUPS)\n`, CP)).toBeNull();
  });
  it("tells which printer a queue is for, even with a generic device or name", () => {
    expect(profileOfQueue("Office", "device for Office: ipp://x/y\n", "Generic PostScript Printer", parsePpdOptions(CP70_L))).toBe(CP);
    expect(profileOfQueue("Office", "device for Office: ipp://x/y\n", "MITSUBISHI CP70D Series", parsePpdOptions(""))).toBe(CP);
    expect(profileOfQueue("Office", "device for Office: ipp://x/y\n", "Generic PostScript Printer", parsePpdOptions(DS620_L))).toBe(DS);
    expect(profileOfQueue("Office", "device for Office: ipp://x/y\n", "Generic PostScript Printer", parsePpdOptions(GENERIC_L))).toBeNull();
  });
});

describe("diagnose", () => {
  const base = { queue: Q, profile: DS, lpstat: { output: `printer ${Q} is idle.  enabled since today`, exitCode: 0 }, accepting: true, model: MODEL };
  it("passes a correctly set-up queue", () => {
    const f = diagnose({ ...base, makeAndModel: "Dai Nippon Printing DP-DS620, 5.2.7", options: parsePpdOptions(DS620_L) });
    expect(f.filter((x) => !x.ok)).toEqual([]);
  });
  it("switches a generic PostScript queue to the DS620 driver (the issue at the booth)", () => {
    const f = diagnose({ ...base, makeAndModel: "Generic PostScript Printer", options: parsePpdOptions(GENERIC_L) });
    expect(f).toEqual([{ ok: false, message: expect.stringContaining("Generic PostScript"), fix: ["lpadmin", "-p", Q, "-m", MODEL, "-E"] }]);
  });
  it("passes a correctly set-up CP-D70DW queue, with no DS620 options asked of it", () => {
    const f = diagnose({ queue: CP70_Q, profile: CP, lpstat: { output: `printer ${CP70_Q} is idle.  enabled since today`, exitCode: 0 }, accepting: true, model: CP70_MODEL, makeAndModel: "MITSUBISHI CP70D Series", options: parsePpdOptions(CP70_L) });
    expect(f.filter((x) => !x.ok)).toEqual([]);
  });
  it("switches a generic CP-D70DW queue to the Mitsubishi driver, and says if it is not installed", () => {
    const cp = { queue: CP70_Q, profile: CP, lpstat: { output: `printer ${CP70_Q} is idle.  enabled since today`, exitCode: 0 }, accepting: true, makeAndModel: "Generic PostScript Printer", options: parsePpdOptions(GENERIC_L) };
    expect(diagnose({ ...cp, model: CP70_MODEL })).toEqual([{ ok: false, message: expect.stringContaining("not the Mitsubishi CP-D70DW driver"), fix: ["lpadmin", "-p", CP70_Q, "-m", CP70_MODEL, "-E"] }]);
    expect(diagnose({ ...cp, model: null })).toEqual([{ ok: false, message: expect.stringContaining("Mitsubishi CP-D70DW driver is not installed") }]);
  });
  it("sets wrong defaults in one lpadmin call", () => {
    const f = diagnose({ ...base, makeAndModel: "DP-DS620", options: parsePpdOptions(DS620_L.replace("*Glossy Matte", "Glossy *Matte").replace("True *False\n", "*True False\n")) });
    expect(f.find((x) => x.fix)?.fix).toEqual(["lpadmin", "-p", Q, "-o", "Finish=Glossy", "-o", "AdjustmentsEnabled=False"]);
  });
});

describe("runDoctor", () => {
  const quiet = () => {};
  it("reports without changing anything unless --fix", async () => {
    const cups = fakeCups({ model: "Generic PostScript Printer", options: GENERIC_L, enabled: false, accepting: true, queue: true });
    expect(await runDoctor({ fix: false, run: cups.run, print: quiet })).toBe(1);
    expect(cups.calls.some((c) => /^(lpadmin|cupsenable|cupsaccept)/.test(c))).toBe(false);
  });
  it("fixes a generic, paused queue end to end: driver, then enable and defaults", async () => {
    const cups = fakeCups({ model: "Generic PostScript Printer", options: GENERIC_L, enabled: false, accepting: false, queue: true });
    expect(await runDoctor({ fix: true, run: cups.run, print: quiet })).toBe(0);
    expect(cups.calls.filter((c) => c.startsWith("lpadmin"))).toEqual([`lpadmin -p ${Q} -m ${MODEL} -E`, `lpadmin -p ${Q} -o Finish=Glossy`]);
  });
  it("creates the queue for a connected DS620 that has none", async () => {
    const cups = fakeCups({ model: "", options: "", enabled: false, accepting: false, queue: false });
    expect(await runDoctor({ fix: true, run: cups.run, print: quiet })).toBe(0);
    expect(cups.calls).toContain(`lpadmin -p ${Q} -v ${URI} -m ${MODEL} -E`);
  });
  it("rejects unsafe queue names", async () => {
    const cups = fakeCups({ model: "", options: "", enabled: true, accepting: true, queue: true });
    expect(await runDoctor({ queue: "-x", fix: true, run: cups.run, print: quiet })).toBe(1);
    expect(cups.calls).toEqual(["lpstat -r"]);
  });
});

describe("runDoctor with a CP-D70DW", () => {
  const quiet = () => {};
  /** A CUPS with only the Mitsubishi connected; `queue` says whether it has a queue already. */
  function cpCups(queue: boolean, driver = "MITSUBISHI CP70D Series", options = CP70_L) {
    const calls: string[] = [];
    let name = CP70_Q;
    const ok = (stdout = "") => ({ stdout, stderr: "", code: 0 });
    const run: Run = async (cmd, args) => {
      const key = [cmd, ...args].join(" ");
      calls.push(key);
      if (key === "lpstat -r") return ok("scheduler is running\n");
      if (key === "lpinfo -m") return ok(`${CP70_MODEL} MITSUBISHI CP70D Series (CUPS)\n${MODEL} Dai Nippon Printing DP-DS620, 5.2.7 (CUPS)\n`);
      if (key === "lpinfo -v") return ok(`direct ${CP70_URI}\n`);
      if (key === "lpstat -v") return ok(queue ? `device for ${CP70_Q}: ${CP70_URI}\n` : "");
      if (!queue && args.includes(name) && cmd !== "lpadmin") return { stdout: "", stderr: "Invalid destination name", code: 1 };
      if (key === `lpoptions -p ${name}`) return ok(`printer-make-and-model='${driver}'`);
      if (key === `lpoptions -p ${name} -l`) return ok(options);
      if (key === `lpstat -p ${name}`) return ok(`printer ${name} is idle.  enabled since today\n`);
      if (key === `lpstat -a ${name}`) return ok(`${name} accepting requests since today\n`);
      if (cmd === "lpadmin") return (queue = true), (name = args[1] ?? name), ok();
      return { stdout: "", stderr: `unexpected ${key}`, code: 99 };
    };
    return { run, calls };
  }
  it("checks its queue without DS620 options and prints which printer it is", async () => {
    const cups = cpCups(true);
    const out: string[] = [];
    expect(await runDoctor({ fix: false, run: cups.run, print: (l) => out.push(l) })).toBe(0);
    expect(out.join("\n")).toContain(`Queue: ${CP70_Q} (Mitsubishi CP-D70DW)`);
    expect(out.join("\n")).not.toMatch(/DS620|Cutter|Finish/);
  });
  it("creates the queue for a connected CP-D70DW that has none", async () => {
    const cups = cpCups(false);
    expect(await runDoctor({ fix: true, run: cups.run, print: quiet })).toBe(0);
    expect(cups.calls).toContain(`lpadmin -p Mitsubishi_CP_D70DW -v ${CP70_URI} -m ${CP70_MODEL} -E`);
  });
  it("works out the printer from an explicitly named queue", async () => {
    const out: string[] = [];
    expect(await runDoctor({ queue: CP70_Q, fix: false, run: cpCups(true).run, print: (l) => out.push(l) })).toBe(0);
    expect(out.join("\n")).toContain("Mitsubishi CP-D70DW");
  });
  it("asks for --model when it cannot tell what a queue is", async () => {
    const out: string[] = [];
    const cups = cpCups(true, "Generic PostScript Printer", GENERIC_L);
    // Name and device give nothing away.
    const run: Run = async (cmd, args) => (cmd === "lpstat" && args[0] === "-v" ? { stdout: "device for Office: ipp://x\n", stderr: "", code: 0 } : cups.run(cmd, args));
    expect(await runDoctor({ queue: CP70_Q, fix: false, run, print: (l) => out.push(l) })).toBe(1);
    expect(out.join("\n")).toContain("--model ds620|cp70");
  });
  it("lists several queues instead of guessing", async () => {
    const out: string[] = [];
    const run: Run = async (cmd, args) =>
      cmd === "lpstat" && args[0] === "-v" ? { stdout: `device for ${Q}: ${URI}\ndevice for ${CP70_Q}: ${CP70_URI}\n`, stderr: "", code: 0 } : { stdout: "ok", stderr: "", code: 0 };
    expect(await runDoctor({ fix: false, run, print: (l) => out.push(l) })).toBe(1);
    expect(out.join("\n")).toContain(`${Q} (DNP DS620), ${CP70_Q} (Mitsubishi CP-D70DW)`);
  });
});
