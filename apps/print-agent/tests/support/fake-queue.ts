import type { PrintItem } from "../../src/queue.js";

/**
 * Minimal stand-in for the SDK's SyncMap: enough for the agent's claim and
 * transition logic. Returning null from the mutator cancels, as the SDK does.
 */
export class FakeQueue {
  items = new Map<string, PrintItem>();
  /** Runs before each mutate, to simulate another agent winning the race. */
  beforeMutate?: (jobId: string) => void;
  mutations = 0;

  constructor(items: PrintItem[] = []) {
    for (const i of items) this.items.set(i.jobId, structuredClone(i));
  }
  async getItems(): Promise<{ items: { key: string; data: PrintItem }[] }> {
    return { items: [...this.items.values()].map((data) => ({ key: data.jobId, data: structuredClone(data) })) };
  }
  async mutate(jobId: string, mutator: (cur: PrintItem | undefined) => PrintItem | null) {
    this.mutations++;
    this.beforeMutate?.(jobId);
    const next = mutator(structuredClone(this.items.get(jobId)));
    if (next === null) return { key: jobId, data: this.items.get(jobId) };
    this.items.set(jobId, next);
    return { key: jobId, data: next };
  }
  on() {}
}
