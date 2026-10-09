export interface BackoffOptions {
  attempts: number;
  baseMs: number;
  maxMs: number;
}

/** Exponential backoff with full jitter; honours a server-provided delay. */
export function backoffDelay(attempt: number, opts: Pick<BackoffOptions, "baseMs" | "maxMs">, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined && retryAfterMs > 0) return Math.min(retryAfterMs, opts.maxMs);
  const cap = Math.min(opts.maxMs, opts.baseMs * 2 ** attempt);
  return Math.floor(Math.random() * cap);
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
