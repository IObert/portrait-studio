export interface Check {
  name: string;
  run: () => Promise<void>;
}

export interface ReadyResult {
  ok: boolean;
  checks: Record<string, "ok" | "fail">;
}

/** Runs checks in parallel with a timeout each. Only names and pass/fail are reported. */
export async function runReadiness(checks: Check[], timeoutMs = 3_000): Promise<ReadyResult> {
  const results = await Promise.all(
    checks.map(async (c) => {
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          c.run(),
          new Promise((_, reject) => (timer = setTimeout(() => reject(new Error("timeout")), timeoutMs))),
        ]);
        return [c.name, "ok"] as const;
      } catch {
        return [c.name, "fail"] as const;
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  return { ok: results.every(([, r]) => r === "ok"), checks: Object.fromEntries(results) };
}
