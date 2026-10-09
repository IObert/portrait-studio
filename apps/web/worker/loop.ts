export type Tick = (signal: AbortSignal) => Promise<void>;

export interface LoopOptions {
  intervalMs: number;
  signal: AbortSignal;
  onError: (err: unknown) => void;
}

/**
 * Runs `tick` repeatedly until `signal` aborts. A failing tick is reported and
 * the loop carries on; there is no state kept between ticks (§1.2).
 */
export async function runLoop(tick: Tick, opts: LoopOptions): Promise<void> {
  while (!opts.signal.aborted) {
    try {
      await tick(opts.signal);
    } catch (err) {
      opts.onError(err);
    }
    await sleep(opts.intervalMs, opts.signal);
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}
