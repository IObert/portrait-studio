import { connection } from "next/server";
import { printerStatus } from "@/lib/admin/printer-status";
import { requireAdmin } from "@/lib/admin/guard";
import { log } from "@/lib/log";
import { getServices } from "@/lib/services";
import { SlugSchema } from "@/lib/sync/names";

/**
 * The print agent's current status for one event, for the admin pages to poll (SPEC §11.2).
 * Admin only (proxy.ts, re-checked here); never cached, because it is only useful when fresh.
 */
export async function GET(_req: Request, ctx: RouteContext<"/admin/events/[slug]/printer">) {
  await connection();
  try {
    await requireAdmin();
  } catch {
    return new Response("Unauthorized", { status: 401, headers: { "cache-control": "no-store" } });
  }
  const slug = SlugSchema.safeParse((await ctx.params).slug);
  if (!slug.success) return new Response("Not found", { status: 404 });
  try {
    return Response.json(await printerStatus(getServices().sync, slug.data), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    log.error({ event: "printer_status_failed", slug: slug.data, err: (err as Error).message }, "printer status failed");
    return new Response("Unavailable", { status: 503, headers: { "cache-control": "no-store" } });
  }
}
