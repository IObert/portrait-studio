import type { PrintItem } from "../../src/queue.js";

interface FakePage {
  items: { key: string; data: PrintItem }[];
  hasNextPage: boolean;
  nextPage(): Promise<FakePage>;
}

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
  /** Pages the way Sync does: sorted by item id, `pageSize` items at a time. */
  pagesRead = 0;
  getItems(opts: { pageSize?: number } = {}) {
    const all = [...this.items.values()].sort((a, b) => (a.jobId < b.jobId ? -1 : 1));
    const size = opts.pageSize ?? 50;
    const pageAt = (from: number): Promise<FakePage> => {
      this.pagesRead++;
      const slice = all.slice(from, from + size);
      const more = from + size < all.length;
      return Promise.resolve({
        items: slice.map((data) => ({ key: data.jobId, data: structuredClone(data) })),
        hasNextPage: more,
        nextPage: () => pageAt(from + size),
      });
    };
    return pageAt(0);
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
