import { type SyncDocument, SyncClient, type SyncMap, type SyncMapItem } from "twilio-sync";
import { z } from "zod";
import { log } from "./log.js";
import type { Printer } from "./printer.js";
import { claim, claimable, failed, printed, type PrintItem, renew, startPrinting } from "./queue.js";

export const AGENT_VERSION = "0.1.0";
const HEARTBEAT_MS = 15_000;
const RENEW_MS = 30_000;
const MAX_BACKOFF_MS = 60_000;

const TokenResponse = z.object({
  token: z.string().min(10),
  ttl: z.number().int().positive(),
  slug: z.string(),
  objects: z.object({ print: z.string(), printer: z.string() }),
});
type Session = z.infer<typeof TokenResponse>;

export class AgentUnauthorized extends Error {
  constructor() {
    super("The printer token was rejected. It may have been rotated: copy the new command from the admin page.");
    this.name = "AgentUnauthorized";
  }
}

/** POST /api/agent/token (PROTOCOL.md §2). */
export async function exchangeToken(url: string, printerToken: string, fetchImpl: typeof fetch = fetch): Promise<Session> {
  const res = await fetchImpl(new URL("/api/agent/token", url), {
    method: "POST",
    headers: { authorization: `Bearer ${printerToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401) throw new AgentUnauthorized();
  if (!res.ok) throw new Error(`token exchange failed: HTTP ${res.status}`);
  return TokenResponse.parse(await res.json());
}

export interface AgentOptions {
  url: string;
  token: string;
  printer: Printer;
  signal: AbortSignal;
}

/**
 * The print agent (SPEC §11.2): exchanges its printer token for a Sync token,
 * watches the event's print queue, claims items with a compare-and-set
 * (SDK mutate), prints them one at a time and reports a heartbeat. On any
 * connection problem it reconnects with back-off and carries on with what is
 * still queued.
 */
export async function runAgent(opts: AgentOptions): Promise<void> {
  let backoff = 1_000;
  while (!opts.signal.aborted) {
    try {
      await session(opts);
      backoff = 1_000;
    } catch (err) {
      if (err instanceof AgentUnauthorized) throw err;
      if (opts.signal.aborted) return;
      log("warn", `Connection problem (${(err as Error).message}); retrying in ${Math.round(backoff / 1000)}s`);
      await sleep(backoff, opts.signal);
      backoff = Math.min(MAX_BACKOFF_MS, backoff * 2);
    }
  }
}

/** One connected session. Returns or throws when it should be re-established. */
async function session(opts: AgentOptions): Promise<void> {
  const s = await exchangeToken(opts.url, opts.token);
  log("info", `Connected to event "${s.slug}"`);
  const client = new SyncClient(s.token);
  const ended = new AbortController();
  const stop = () => ended.abort();
  opts.signal.addEventListener("abort", stop, { once: true });

  client.on("tokenAboutToExpire", async () => {
    try {
      await client.updateToken((await exchangeToken(opts.url, opts.token)).token);
    } catch (err) {
      log("warn", `Token refresh failed: ${(err as Error).message}`);
    }
  });
  client.on("tokenExpired", stop);
  client.on("connectionStateChanged", (state) => {
    if (state === "denied" || state === "error") stop();
    else if (state === "connected") log("info", "Sync connected");
    else if (state === "disconnected") log("warn", "Sync disconnected; the SDK is reconnecting");
  });

  let printing = false;
  try {
    const queue = await client.map({ id: s.objects.print, mode: "open_existing" });
    const status = await client.document({ id: s.objects.printer, mode: "open_existing" });
    log("info", `Printer: ${await opts.printer.describe()}`);

    // Wake up on new or changed queue items; also poll gently as a safety net.
    let wake: () => void = () => {};
    const kick = () => wake();
    queue.on("itemAdded", kick);
    queue.on("itemUpdated", kick);

    const beat = setInterval(() => void heartbeat(status, opts.printer, printing), HEARTBEAT_MS);
    await heartbeat(status, opts.printer, printing);
    try {
      while (!ended.signal.aborted) {
        const next = await nextClaimable(queue);
        if (next) {
          printing = true;
          await printOne(queue, next, opts.printer, ended.signal);
          printing = false;
          await heartbeat(status, opts.printer, printing);
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, 10_000);
          ended.signal.addEventListener("abort", () => resolve(), { once: true });
        });
      }
    } finally {
      clearInterval(beat);
    }
  } finally {
    opts.signal.removeEventListener("abort", stop);
    await client.shutdown().catch(() => {});
  }
  if (!opts.signal.aborted) throw new Error("session ended");
}

/** Oldest claimable item, if any. */
async function nextClaimable(queue: SyncMap): Promise<string | null> {
  const page = await queue.getItems({ pageSize: 100 });
  const now = new Date();
  const items = page.items.map((i: SyncMapItem) => i.data as PrintItem).filter((i: PrintItem) => claimable(i, now));
  items.sort((a: PrintItem, b: PrintItem) => (a.timestamps.queued ?? "").localeCompare(b.timestamps.queued ?? ""));
  return items[0]?.jobId ?? null;
}

/**
 * mutate() re-runs the mutator on conflicts; returning null cancels (PROTOCOL.md §3).
 * The SDK's Mutator type omits null, but the documented (and tested) behaviour allows it.
 */
type Mutator = Parameters<SyncMap["mutate"]>[1];
async function transition(queue: SyncMap, jobId: string, fn: (cur: PrintItem | null) => PrintItem | null): Promise<PrintItem | null> {
  let result: PrintItem | null = null;
  const mutator = ((cur: object | undefined) => {
    result = fn((cur as PrintItem | undefined) ?? null);
    return result;
  }) as unknown as Mutator;
  await queue.mutate(jobId, mutator);
  return result;
}

async function printOne(queue: SyncMap, jobId: string, printer: Printer, signal: AbortSignal): Promise<void> {
  const claimed = await transition(queue, jobId, (cur) => claim(cur, new Date()));
  if (!claimed) return; // another agent got it, or it changed
  log("info", `Printing ${jobId} (attempt ${claimed.attempts})`);
  const renewal = setInterval(() => void transition(queue, jobId, (cur) => renew(cur, new Date())).catch(() => {}), RENEW_MS);
  try {
    if (!claimed.url) throw new Error("print item has no download link");
    const res = await fetch(claimed.url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
    const png = Buffer.from(await res.arrayBuffer());
    if (png.byteLength < 8 || png.subarray(1, 4).toString() !== "PNG") throw new Error("download is not a PNG");
    await transition(queue, jobId, (cur) => startPrinting(cur, new Date()));
    await printer.print(png, jobId, signal);
    await transition(queue, jobId, (cur) => printed(cur, new Date()));
    log("info", `Printed ${jobId}`);
  } catch (err) {
    const message = (err as Error).message;
    const after = await transition(queue, jobId, (cur) => failed(cur, new Date(), message)).catch(() => null);
    log(after?.state === "failed" ? "error" : "warn", `Print ${jobId} ${after?.state === "failed" ? "failed" : "will be retried"}: ${message}`);
  } finally {
    clearInterval(renewal);
  }
}

/** Heartbeat and printer status every 15 s (SPEC §11.2, PROTOCOL.md §4). */
async function heartbeat(doc: SyncDocument, printer: Printer, printing: boolean) {
  try {
    const st = await printer.status();
    await doc.set({
      agentVersion: AGENT_VERSION,
      mode: printer.mode,
      queue: printer.queue,
      status: printing && st.status === "idle" ? "printing" : st.status,
      detail: st.detail,
      heartbeatAt: new Date().toISOString(),
    });
  } catch (err) {
    log("warn", `Heartbeat failed: ${(err as Error).message}`);
  }
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });
}
