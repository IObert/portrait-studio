import path from "node:path";
import { AgentUnauthorized, AGENT_VERSION, runAgent } from "./agent.js";
import { parseAgentArgs, parseDoctorArgs, USAGE } from "./args.js";
import { runDoctor } from "./doctor.js";
import { log } from "./log.js";
import { cupsPrinter, simulatedPrinter } from "./printer.js";
import { runWindowsDoctor, WINDOWS_BETA_NOTICE, windowsPrinter } from "./windows.js";

// TODO(windows): beta, untested on real Windows. See the CRITICAL(windows) notes in windows.ts.
const isWindows = process.platform === "win32";

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(USAGE);
  process.exit(0);
}
if (argv.includes("--version")) {
  console.log(AGENT_VERSION);
  process.exit(0);
}

if (argv[0] === "doctor") {
  const doctor = parseDoctorArgs(argv.slice(1));
  if (!doctor.ok) {
    console.error(`${doctor.error}\n\n${USAGE}`);
    process.exit(2);
  }
  process.exit(await (isWindows ? runWindowsDoctor(doctor.args) : runDoctor(doctor.args)));
}

const result = parseAgentArgs(argv);
if (!result.ok) {
  console.error(`${result.error}\n\n${USAGE}`);
  process.exit(2);
}
const { args } = result;

const major = Number(process.versions.node.split(".")[0]);
if (major < 22) {
  console.error(`Node.js 22 or newer is required (this is ${process.version}).`);
  process.exit(2);
}

// parseAgentArgs guarantees --printer unless --simulate.
// TODO(linux): CUPS works on Linux, but the DNP driver is macOS/Windows only. With Gutenprint the
// DS620 option names differ (see DS620_OPTIONS in cups.ts), so pick the option set by driver.
const printer = args.simulate || !args.printer ? simulatedPrinter(args.out) : isWindows ? windowsPrinter(args.printer, args.out) : cupsPrinter(args.printer, args.out);
log("info", `Portrait Studio print agent ${AGENT_VERSION} (server ${new URL(args.url).origin})`);
log("info", args.simulate ? "Simulator mode: nothing goes to a printer" : `${isWindows ? "Windows printer" : "Printer queue"}: ${args.printer}`);
if (isWindows && !args.simulate) log("warn", WINDOWS_BETA_NOTICE);
log("info", `A copy of every print is saved in ${path.resolve(args.out)}`);

const controller = new AbortController();
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, () => {
    log("info", "Stopping…");
    controller.abort();
  });
}

try {
  await runAgent({ url: args.url, token: args.token, printer, signal: controller.signal });
  log("info", "Stopped.");
  // The Sync SDK keeps reconnect timers alive after shutdown; exit explicitly so a stopped agent never lingers.
  process.exit(0);
} catch (err) {
  if (err instanceof AgentUnauthorized) {
    log("error", err.message);
    process.exit(3);
  }
  log("error", `Unexpected error: ${(err as Error).message}`);
  process.exit(1);
}
