import { getAdminMemory, getEventRepo } from "@/lib/admin/context";
import { requireAdmin } from "@/lib/admin/guard";
import { leadsCsv } from "@/lib/admin/leads-csv";
import { log } from "@/lib/log";
import { getServices } from "@/lib/services";
import { SlugSchema } from "@/lib/sync/names";

/** Leads CSV (SPEC §10.5). Admin only (proxy plus a re-check here); never cached. */
export async function GET(_req: Request, ctx: RouteContext<"/admin/events/[slug]/leads.csv">) {
  try {
    await requireAdmin();
  } catch {
    return new Response("Unauthorized", { status: 401, headers: { "www-authenticate": 'Basic realm="Portrait Studio admin"' } });
  }
  const slug = SlugSchema.safeParse((await ctx.params).slug);
  if (!slug.success || !(await (await getEventRepo()).get(slug.data))) return new Response("Not found", { status: 404 });
  const csv = await leadsCsv({ sync: getServices().sync, memory: getAdminMemory() }, slug.data);
  log.info({ event: "leads_exported", slug: slug.data, rows: csv.split("\r\n").length - 2 }, "leads CSV exported");
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="leads-${slug.data}.csv"`,
      "cache-control": "no-store",
    },
  });
}
