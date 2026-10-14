import { connection } from "next/server";
import { getEventRepo } from "@/lib/admin/context";
import { exchangePrinterToken } from "@/lib/agent/token";
import { log } from "@/lib/log";
import { getServices } from "@/lib/services";

/**
 * Printer token → Sync token for the print agent (SPEC §11.2, PROTOCOL.md §2).
 * Public route: the printer token is the only credential (SPEC §10.1).
 */
export async function POST(request: Request) {
  await connection();
  const auth = request.headers.get("authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  try {
    const r = await exchangePrinterToken({ sync: getServices().sync, events: await getEventRepo() }, presented);
    if (!r.ok) {
      log.warn({ event: "agent_token_rejected" }, "print agent token rejected");
      return new Response("Unauthorized", { status: 401 });
    }
    log.info({ event: "agent_token_issued", slug: r.slug }, "print agent token issued");
    return Response.json({ token: r.token, ttl: r.ttl, slug: r.slug, objects: r.objects }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    log.error({ event: "agent_token_failed", err: (err as Error).message }, "print agent token failed");
    return new Response("Unavailable", { status: 503 });
  }
}
