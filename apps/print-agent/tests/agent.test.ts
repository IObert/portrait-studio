import { describe, expect, it, vi } from "vitest";
import { AgentUnauthorized, exchangeToken, runAgent } from "../src/agent.js";
import { claim, type PrintItem } from "../src/queue.js";
import { FakeQueue } from "./support/fake-queue.js";

const item = (over: Partial<PrintItem> = {}): PrintItem => ({ jobId: "job_1", blobPath: "p.png", url: "https://x.test/m/t", who: "x", state: "queued", attempts: 0, leaseUntil: null, error: null, timestamps: { queued: "2026-10-13T12:00:00Z" }, ...over });

describe("token exchange (PROTOCOL.md §2)", () => {
  const body = { token: "a".repeat(40), ttl: 3600, slug: "ev", objects: { print: "ev_ev_print", printer: "ev_ev_printer" } };

  it("returns the session on 200", async () => {
    const f = vi.fn(async () => Response.json(body));
    await expect(exchangeToken("https://app.test", "ev.K7QM-2XH0-9RTB-W41Z", f as unknown as typeof fetch)).resolves.toEqual(body);
    expect(f).toHaveBeenCalledWith(new URL("https://app.test/api/agent/token"), expect.objectContaining({ method: "POST", headers: { authorization: expect.stringContaining("Bearer ev.K7QM-2XH0-9RTB-W41Z") } }));
  });

  it("a rotated token gives a clear, final error", async () => {
    const f = vi.fn(async () => new Response("Unauthorized", { status: 401 }));
    await expect(exchangeToken("https://app.test", "ev.0000-0000-0000-0000", f as unknown as typeof fetch)).rejects.toBeInstanceOf(AgentUnauthorized);
  });

  it("other failures are retryable errors, and a malformed body is rejected", async () => {
    const down = vi.fn(async () => new Response("", { status: 503 }));
    await expect(exchangeToken("https://app.test", "t", down as unknown as typeof fetch)).rejects.toThrow(/HTTP 503/);
    const junk = vi.fn(async () => Response.json({ token: "" }));
    await expect(exchangeToken("https://app.test", "t", junk as unknown as typeof fetch)).rejects.toThrow();
  });
});

describe("claiming against a queue (PROTOCOL.md §3)", () => {
  it("claims the oldest claimable item", async () => {
    const q = new FakeQueue([
      item({ jobId: "newer", timestamps: { queued: "2026-10-13T12:05:00Z" } }),
      item({ jobId: "older", timestamps: { queued: "2026-10-13T12:00:00Z" } }),
      item({ jobId: "printing", state: "printing" }),
    ]);
    const page = await q.getItems();
    const now = new Date("2026-10-13T12:10:00Z");
    const claimables = page.items.map((i) => i.data).filter((i) => claim(i, now) !== null);
    claimables.sort((a, b) => (a.timestamps.queued ?? "").localeCompare(b.timestamps.queued ?? ""));
    expect(claimables.map((i) => i.jobId)).toEqual(["older", "newer"]);
  });

  it("a lost race cancels the mutation and leaves the winner's state", async () => {
    const q = new FakeQueue([item()]);
    // Another agent claims it just before our mutator runs.
    q.beforeMutate = () => q.items.set("job_1", item({ state: "claimed", attempts: 1, leaseUntil: "2026-10-13T12:02:00Z" }));
    const now = new Date("2026-10-13T12:00:00Z");
    await q.mutate("job_1", (cur) => claim(cur as PrintItem, now));
    expect(q.items.get("job_1")).toMatchObject({ state: "claimed", attempts: 1 });
  });
});

describe("dead connection watch", () => {
  it("is dead only after a minute without one successful heartbeat", async () => {
    const { connectionWatch, DEAD_CONNECTION_MS } = await import("../src/agent.js");
    let t = 0;
    const w = connectionWatch(() => t);
    t = 30_000;
    w.beat(false);
    expect(w.dead()).toBe(false);
    t = 50_000;
    w.beat(true); // one success resets it
    t = 50_000 + DEAD_CONNECTION_MS;
    w.beat(false);
    expect(w.dead()).toBe(false);
    t += 1;
    expect(w.dead()).toBe(true);
    expect(w.silentFor()).toBe(DEAD_CONNECTION_MS + 1);
  });
});

describe("reconnect back-off (BUG 7)", () => {
  /** Runs the loop against scripted sessions (how long each lasts before dropping); returns the wait before each reconnect. */
  async function waits(sessions: number[]) {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    vi.setSystemTime(0);
    const stop = new AbortController();
    const starts: number[] = [];
    const connect = async () => {
      starts.push(Date.now());
      const lasted = sessions[starts.length - 1];
      if (lasted === undefined) { stop.abort(); return; }
      vi.setSystemTime(Date.now() + lasted);
      throw new Error("session ended");
    };
    try {
      const run = runAgent({ url: "u", token: "t", printer: {} as never, signal: stop.signal }, connect);
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      await run;
    } finally {
      vi.useRealTimers();
    }
    return starts.slice(1).map((t, i) => t - starts[i]! - sessions[i]!);
  }

  it("keeps doubling while connecting keeps failing quickly", async () => {
    expect(await waits([0, 0, 0])).toEqual([1_000, 2_000, 4_000]);
  });

  it("starts over after a session that was healthy for a while", async () => {
    expect(await waits([0, 0, 5 * 60_000, 0])).toEqual([1_000, 2_000, 1_000, 2_000]);
  });
});
