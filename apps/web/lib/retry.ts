export interface BackoffOptions {
  attempts: number;
  baseMs: number;
  maxMs: number;
}

/**
 * Exponential backoff with jitter; honours a server-provided delay. `minMs`
 * stops full jitter from producing a near-zero wait (an instant retry after a
 * 429 would only hit the limit again).
 */
export function backoffDelay(
  attempt: number,
  opts: Pick<BackoffOptions, "baseMs" | "maxMs"> & { minMs?: number },
  retryAfterMs?: number,
): number {
  const min = opts.minMs ?? 0;
  if (retryAfterMs !== undefined && retryAfterMs > 0) return Math.max(min, Math.min(retryAfterMs, opts.maxMs));
  const cap = Math.min(opts.maxMs, opts.baseMs * 2 ** attempt);
  return Math.max(min, Math.floor(Math.random() * cap));
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
