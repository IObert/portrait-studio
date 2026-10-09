import { describe, expect, it, vi } from "vitest";
import { runLoop } from "@/worker/loop";

describe("runLoop", () => {
  it("keeps ticking after a failing tick and stops on abort", async () => {
    const controller = new AbortController();
    const onError = vi.fn();
    let calls = 0;
    await runLoop(
      async () => {
        calls += 1;
        if (calls === 1) throw new Error("boom");
        if (calls === 3) controller.abort();
      },
      { intervalMs: 1, signal: controller.signal, onError },
    );
    expect(calls).toBe(3);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
