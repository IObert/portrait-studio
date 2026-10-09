/**
 * HTTP Basic auth for /admin and /booth (SPEC §10.1). Runs in proxy.ts, so it
 * uses Web Crypto only and keeps no shared state.
 */

async function digest(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}

/** Constant-time string comparison: compares fixed-length SHA-256 digests. */
export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

export function parseBasicAuth(header: string | null): { user: string; password: string } | null {
  if (!header?.startsWith("Basic ")) return null;
  let decoded: string;
  try {
    decoded = new TextDecoder().decode(Uint8Array.from(atob(header.slice(6).trim()), (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
  const i = decoded.indexOf(":");
  if (i < 0) return null;
  return { user: decoded.slice(0, i), password: decoded.slice(i + 1) };
}

/** False if credentials are not configured: fail closed, never open. */
export async function checkBasicAuth(
  header: string | null,
  user: string | undefined,
  password: string | undefined,
): Promise<boolean> {
  if (!user || !password) return false;
  const creds = parseBasicAuth(header);
  if (!creds) return false;
  // Evaluate both so timing does not reveal which part was wrong.
  const [u, p] = await Promise.all([constantTimeEqual(creds.user, user), constantTimeEqual(creds.password, password)]);
  return u && p;
}
