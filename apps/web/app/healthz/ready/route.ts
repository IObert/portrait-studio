import { connection } from "next/server";
import { runReadiness } from "@/lib/health/ready";
import { log } from "@/lib/log";
import { getServices } from "@/lib/services";

/** Readiness probe (SPEC §10.7): Sync and Blob Storage must be reachable. */
export async function GET() {
  await connection();
  let result;
  try {
    const { sync, blob } = getServices();
    result = await runReadiness([
      { name: "sync", run: () => sync.ping() },
      { name: "blob", run: () => blob.ping() },
    ]);
  } catch (err) {
    log.error({ err: (err as Error).message }, "readiness: configuration incomplete");
    result = { ok: false, checks: { config: "fail" as const } };
  }
  if (!result.ok) log.warn({ event: "not_ready", checks: result.checks }, "readiness check failed");
  return Response.json(result, { status: result.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
