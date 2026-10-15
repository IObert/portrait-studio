import { describe, expect, it } from "vitest";
import { diagnose, findDs620Device, findDs620Model, findDs620Queues, parseMakeAndModel, parsePpdOptions, runDoctor, type Run } from "../src/doctor.js";

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
  it("finds the queue, the USB device and the driver", () => {
    expect(parseMakeAndModel(`device-uri=x printer-make-and-model='Dai Nippon Printing DP-DS620, 5.2.7' printer-is-shared=false`)).toBe("Dai Nippon Printing DP-DS620, 5.2.7");
    expect(findDs620Queues(`device for ${Q}: ${URI}\ndevice for HP: usb://HP/OfficeJet\n`)).toEqual([Q]);
    expect(findDs620Device(`network ipp\ndirect ${URI}\n`)).toBe(URI);
    expect(findDs620Model(`${MODEL} Dai Nippon Printing DP-DS620, 5.2.7 (CUPS)\n`)).toBe(MODEL);
  });
});

describe("diagnose", () => {
  const base = { queue: Q, lpstat: { output: `printer ${Q} is idle.  enabled since today`, exitCode: 0 }, accepting: true, model: MODEL };
  it("passes a correctly set-up queue", () => {
    const f = diagnose({ ...base, makeAndModel: "Dai Nippon Printing DP-DS620, 5.2.7", options: parsePpdOptions(DS620_L) });
    expect(f.filter((x) => !x.ok)).toEqual([]);
  });
  it("switches a generic PostScript queue to the DS620 driver (the issue at the booth)", () => {
    const f = diagnose({ ...base, makeAndModel: "Generic PostScript Printer", options: parsePpdOptions(GENERIC_L) });
    expect(f).toEqual([{ ok: false, message: expect.stringContaining("Generic PostScript"), fix: ["lpadmin", "-p", Q, "-m", MODEL, "-E"] }]);
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
    expect(cups.calls).toEqual(["lpstat -r", "lpinfo -m"]);
  });
});
