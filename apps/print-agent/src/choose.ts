import { createInterface } from "node:readline/promises";
import { execRun, PROFILES, type Run } from "./doctor.js";
import { execPowerShell, LIST_PRINTERS_SCRIPT, parsePrinterList, type PowerShell } from "./windows.js";

/**
 * Asks which printer to use when the agent is started with neither `--printer` nor `--simulate`,
 * so the command shown in the admin UI does not have to name one.
 */

export interface PrinterChoice {
  /** CUPS queue or Windows printer name. */
  name: string;
  /** Short note for the list, e.g. the model it was recognised as. */
  note: string;
}

/** Queue names from `lpstat -p`: `printer Dai_Nippon_Printing_DP_DS620 is idle.  enabled since …`. */
export function parseCupsPrinters(lpstatP: string): string[] {
  return lpstatP.split("\n").flatMap((line) => {
    const name = /^printer (\S+) /.exec(line)?.[1];
    return name ? [name] : [];
  });
}

/** Supported printers are labelled by model, so the right one stands out among e.g. an office printer. */
export function describeChoices(names: string[]): PrinterChoice[] {
  return names.map((name) => ({ name, note: PROFILES.find((p) => p.match.test(name))?.label ?? "" }));
}

/** The printer names on this computer; empty when the platform tool is missing or fails. */
export async function listPrinters(isWindows: boolean, deps: { run?: Run; ps?: PowerShell } = {}): Promise<string[]> {
  if (isWindows) {
    const r = await (deps.ps ?? execPowerShell)(LIST_PRINTERS_SCRIPT, {}, { timeoutMs: 30_000 });
    return r.code === 0 ? parsePrinterList(r.stdout) : [];
  }
  const r = await (deps.run ?? execRun)("lpstat", ["-p"]);
  return r.code === 0 ? parseCupsPrinters(r.stdout) : [];
}

/** Menu text: 1 is the simulator, then the printers. */
export function formatMenu(choices: PrinterChoice[]): string {
  const lines = ["Which printer should this agent use?", "  1) Simulator (nothing is printed; copies are saved to the output folder)"];
  choices.forEach((c, i) => lines.push(`  ${i + 2}) ${c.name}${c.note ? ` (${c.note})` : ""}`));
  return lines.join("\n");
}

/** An empty answer means the simulator, the one choice that is always there and prints nothing. `null` for anything else invalid. */
export function parseSelection(answer: string, count: number): { kind: "simulate" } | { kind: "printer"; index: number } | null {
  const text = answer.trim();
  if (text === "") return { kind: "simulate" };
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  if (n === 1) return { kind: "simulate" };
  return n >= 2 && n <= count + 1 ? { kind: "printer", index: n - 2 } : null;
}

export type Selection = { kind: "simulate" } | { kind: "printer"; name: string };

/** Lists the options and asks until the answer is valid. Needs a terminal; the caller checks. */
export async function askForPrinter(choices: PrinterChoice[]): Promise<Selection> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(formatMenu(choices));
    if (choices.length === 0) console.log("  (No printers found. Set one up with `node agent.mjs doctor --fix`.)");
    for (;;) {
      const picked = parseSelection(await rl.question("Number [1]: "), choices.length);
      if (!picked) {
        console.log(`Enter a number from 1 to ${choices.length + 1}.`);
        continue;
      }
      const chosen = picked.kind === "printer" ? choices[picked.index] : undefined;
      return chosen ? { kind: "printer", name: chosen.name } : { kind: "simulate" };
    }
  } finally {
    rl.close();
  }
}
