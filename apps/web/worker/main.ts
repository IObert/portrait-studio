export {};

process.env.PORTRAIT_PROCESS ??= "worker";

const { loadRootEnv } = await import("../lib/load-env");
loadRootEnv();

const { randomUUID } = await import("node:crypto");
const { log } = await import("../lib/log");
const { getEnv } = await import("../lib/env");
const { buildWorkerDeps } = await import("../lib/pipeline/context");
const { workOnce } = await import("../lib/pipeline/worker");
const { settlePrints } = await import("../lib/pipeline/prints");

const controller = new AbortController();
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, () => {
    log.info({ signal: sig }, "worker shutting down");
    controller.abort();
  });
}

// `--check`: load every module and exit. Used by CI to prove the image's worker starts.
if (process.argv.includes("--check")) {
  await import("../lib/pipeline/run");
  log.info("worker check ok");
  process.exit(0);
}

const workerId = randomUUID().slice(0, 8);
const deps = await buildWorkerDeps(workerId);
const concurrency = getEnv().WORKER_CONCURRENCY;
log.info({ workerId, concurrency }, "worker started");

/** One lane: claim and run jobs back to back; idle-poll when there is nothing to do. */
async function lane(n: number) {
  while (!controller.signal.aborted) {
    let done = 0;
    try {
      done = await workOnce(deps, 1);
    } catch (err) {
      log.error({ lane: n, err: (err as Error).message }, "worker pass failed");
    }
    // No state lives here between passes (SPEC §1.2): everything is re-read from Sync.
    if (done === 0) await new Promise((r) => setTimeout(r, 2_000));
  }
}

const { signMedia } = await import("../lib/media-token");
const printMediaUrl = (blobPath: string, ttl: number) => {
  const env = getEnv();
  return new URL(`/m/${signMedia(env.MEDIA_SIGNING_SECRET!, blobPath, ttl)}`, env.PUBLIC_BASE_URL).toString();
};

/** Print lifecycle on the server side: count prints, send promos, release stuck jobs (SPEC §11.2, §5.9). */
async function printLane() {
  while (!controller.signal.aborted) {
    try {
      await settlePrints({ sync: deps.sync, events: deps.events, messenger: deps.messenger, log, mediaUrl: printMediaUrl });
    } catch (err) {
      log.error({ lane: "prints", err: (err as Error).message }, "print settlement failed");
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
}

await Promise.all([...Array.from({ length: concurrency }, (_, i) => lane(i)), printLane()]);
log.info("worker stopped");
