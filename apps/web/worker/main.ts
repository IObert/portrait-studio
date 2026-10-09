export {};

process.env.PORTRAIT_PROCESS ??= "worker";

const { log } = await import("../lib/log");
const { runLoop } = await import("./loop");

const controller = new AbortController();
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, () => {
    log.info({ signal: sig }, "worker shutting down");
    controller.abort();
  });
}

log.info("worker started");

// Job claiming and timed follow-ups are added in milestone f (§3.2, §9.1).
await runLoop(async () => {}, {
  intervalMs: 2_000,
  signal: controller.signal,
  onError: (err) => log.error({ err }, "worker tick failed"),
});

log.info("worker stopped");
