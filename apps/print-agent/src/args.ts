import { parseArgs } from "node:util";
import { z } from "zod";

const ArgsSchema = z
  .object({
    url: z.url({ protocol: /^https?$/ }),
    token: z.string().min(16, "token looks too short"),
    printer: z.string().min(1).optional(),
    simulate: z.boolean().default(false),
    out: z.string().min(1).default("./prints"),
  })
  .refine((a) => a.simulate || a.printer, {
    message: "--printer <CUPS queue> is required unless --simulate is set",
    path: ["printer"],
  });

export type AgentArgs = z.infer<typeof ArgsSchema>;

export const USAGE = `Usage:
  node agent.mjs --url https://<app> --token <event printer token> [--printer <CUPS queue> | --simulate] [--out ./prints]

  node agent.mjs doctor [--printer <CUPS queue>] [--fix]

  --out   Folder that keeps a copy of every print, for manual reprints (default ./prints)
  doctor  Checks the DS620 queue: driver, enabled, and print defaults. --fix repairs it.`;

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

export type DoctorParseResult = { ok: true; args: { queue?: string; fix: boolean } } | { ok: false; error: string };

/** `doctor [--printer <queue>] [--fix]`; without --printer it finds the DS620 queue. */
export function parseDoctorArgs(argv: string[]): DoctorParseResult {
  try {
    const { values } = parseArgs({ args: argv, strict: true, options: { printer: { type: "string" }, fix: { type: "boolean" } } });
    return { ok: true, args: { ...(values.printer ? { queue: values.printer } : {}), fix: values.fix ?? false } };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
