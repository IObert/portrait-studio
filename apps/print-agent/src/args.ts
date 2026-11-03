import { parseArgs } from "node:util";
import { z } from "zod";
import { PROFILE_KEYS, profileByDriver, type PrinterProfile } from "./doctor.js";

const ArgsSchema = z
  .object({
    url: z.url({ protocol: /^https?$/ }),
    token: z.string().min(16, "token looks too short"),
    printer: z.string().min(1).optional(),
    simulate: z.boolean().default(false),
    out: z.string().min(1).default("./prints"),
  })
  .refine((a) => !(a.simulate && a.printer), {
    message: "use either --printer or --simulate, not both",
    path: ["printer"],
  });

export type AgentArgs = z.infer<typeof ArgsSchema>;

export const USAGE = `Usage:
  node agent.mjs --url https://<app> --token <event printer token> [--printer <queue> | --simulate] [--out ./prints]

  node agent.mjs doctor [--printer <queue>] [--model ds620|cp70] [--fix]

  Without --printer or --simulate the agent lists the simulator and the printers it finds, and asks which to use.

  --printer   CUPS queue (macOS, Linux) or Windows printer name, e.g. "DP-DS620" (Windows: beta)
  --simulate  Do not print; only save the copies in --out
  --out       Folder that keeps a copy of every print, for manual reprints (default ./prints)
  doctor      Checks the queue of a DNP DS620 or Mitsubishi CP-D70DW: driver, enabled, and print defaults.
              --fix repairs it. --model says which printer a queue is for when doctor cannot tell.`;

export type ParseResult = { ok: true; args: AgentArgs } | { ok: false; error: string };

export function parseAgentArgs(argv: string[]): ParseResult {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      options: {
        url: { type: "string" },
        token: { type: "string" },
        printer: { type: "string" },
        simulate: { type: "boolean" },
        out: { type: "string" },
      },
    }));
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  const parsed = ArgsSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => `--${i.path.join(".")}: ${i.message}`).join("\n"),
    };
  }
  return { ok: true, args: parsed.data };
}

export type DoctorParseResult = { ok: true; args: { queue?: string; profile?: PrinterProfile; fix: boolean } } | { ok: false; error: string };

/** `doctor [--printer <queue>] [--model ds620|cp70] [--fix]`; without --printer it finds the queue of a supported printer. */
export function parseDoctorArgs(argv: string[]): DoctorParseResult {
  try {
    const { values } = parseArgs({ args: argv, strict: true, options: { printer: { type: "string" }, model: { type: "string" }, fix: { type: "boolean" } } });
    const profile = values.model === undefined ? undefined : profileByDriver(values.model);
    if (values.model !== undefined && !profile) return { ok: false, error: `--model must be ${PROFILE_KEYS}, not "${values.model}"` };
    return { ok: true, args: { ...(values.printer ? { queue: values.printer } : {}), ...(profile ? { profile } : {}), fix: values.fix ?? false } };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
