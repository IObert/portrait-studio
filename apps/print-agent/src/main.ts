import { parseAgentArgs, USAGE } from "./args.js";
import { log } from "./log.js";

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(USAGE);
  process.exit(0);
}

const result = parseAgentArgs(argv);
if (!result.ok) {
  console.error(`${result.error}\n\n${USAGE}`);
  process.exit(2);
}

const { args } = result;
log("info", `Portrait Studio print agent starting (server ${new URL(args.url).origin})`);
log("info", args.simulate ? `Simulator mode: prints go to ${args.out}` : `Printer queue: ${args.printer}`);
// Token exchange, job claiming and printing are implemented in milestone i (§11).
log("warn", "Printing is not implemented yet; exiting.");
