/**
 * Print-queue decisions (PROTOCOL.md §3), as pure functions over one item so
 * the agent's behaviour is testable without Sync or a printer.
 */
export const LEASE_MS = 2 * 60 * 1000;
export const MAX_ATTEMPTS = 3;

export type PrintState = "queued" | "claimed" | "printing" | "printed" | "failed";

export interface PrintItem {
  jobId: string;
  blobPath: string;
  url?: string;
  who: string;
  state: PrintState;
  attempts: number;
  leaseUntil: string | null;
  error: string | null;
  reprint?: boolean;
  /** The printer's job id once submitted. A `printing` item with one is never submitted again. */
  printerJobId?: string | null;
  timestamps: Partial<Record<PrintState, string>>;
  settledAt?: string;
}

/** Ready to claim: queued, has a download link, and any back-off has passed. */
export function claimable(item: PrintItem, now: Date): boolean {
  return item.state === "queued" && !!item.url && (!item.leaseUntil || Date.parse(item.leaseUntil) <= now.getTime());
}

/** The claim mutation: returns the claimed item, or null to cancel (lost race or not claimable). */
export function claim(item: PrintItem | null, now: Date): PrintItem | null {
  if (!item || !claimable(item, now)) return null;
  return { ...item, state: "claimed", attempts: item.attempts + 1, leaseUntil: new Date(now.getTime() + LEASE_MS).toISOString(), error: null, timestamps: { ...item.timestamps, claimed: now.toISOString() } };
}

/**
 * claimed → printing, recording the printer's job id (only if we still hold
 * it). From here on the job is never submitted again: the agent only waits
 * for it, or cancels it.
 */
export function startPrinting(item: PrintItem | null, now: Date, printerJobId: string): PrintItem | null {
  // `printing` too: a resumed item whose old job belonged to another printer gets a fresh one.
  if (!item || (item.state !== "claimed" && item.state !== "printing")) return null;
  return { ...item, state: "printing", printerJobId, leaseUntil: new Date(now.getTime() + LEASE_MS).toISOString(), timestamps: { ...item.timestamps, printing: now.toISOString() } };
}

/** Lease renewal while claimed or printing, including while the printer is off. */
export function renew(item: PrintItem | null, now: Date): PrintItem | null {
  if (!item || (item.state !== "printing" && item.state !== "claimed")) return null;
  return { ...item, leaseUntil: new Date(now.getTime() + LEASE_MS).toISOString() };
}

export function printed(item: PrintItem | null, now: Date): PrintItem | null {
  if (!item || (item.state !== "printing" && item.state !== "claimed")) return null;
  return { ...item, state: "printed", leaseUntil: null, error: null, timestamps: { ...item.timestamps, printed: now.toISOString() } };
}

/**
 * A failed attempt: retry with back-off, or give up after MAX_ATTEMPTS (SPEC
 * §11.2). Call only after the printer job (if any) was cancelled, so a retry
 * can never add a second copy.
 */
export function failed(item: PrintItem | null, now: Date, error: string): PrintItem | null {
  if (!item || (item.state !== "printing" && item.state !== "claimed")) return null;
  const message = error.slice(0, 300);
  if (item.attempts >= MAX_ATTEMPTS) return { ...item, state: "failed", printerJobId: null, leaseUntil: null, error: message, timestamps: { ...item.timestamps, failed: now.toISOString() } };
  const backoff = Math.min(60_000, 5_000 * 2 ** (item.attempts - 1));
  return { ...item, state: "queued", printerJobId: null, leaseUntil: new Date(now.getTime() + backoff).toISOString(), error: message };
}

/** Our own `printing` item whose printer job outlived an agent restart: resume waiting, don't resubmit. */
export function resumable(item: PrintItem, now: Date): boolean {
  return item.state === "printing" && !!item.printerJobId && !!item.leaseUntil && Date.parse(item.leaseUntil) <= now.getTime();
}

/** Takes over a resumable item (lease expired): keeps the printer job id and the attempt count. */
export function resume(item: PrintItem | null, now: Date): PrintItem | null {
  if (!item || !resumable(item, now)) return null;
  return { ...item, leaseUntil: new Date(now.getTime() + LEASE_MS).toISOString() };
}
