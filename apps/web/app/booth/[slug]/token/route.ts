import { connection } from "next/server";
import { getEventRepo } from "@/lib/admin/context";
import { requireAdmin } from "@/lib/admin/guard";
import { publishBooth } from "@/lib/booth/state";
import { boothToken } from "@/lib/booth/token";
import { log } from "@/lib/log";
import { getServices } from "@/lib/services";
import { SlugSchema } from "@/lib/sync/names";

/**
 * Read-only Sync token for the booth screen (D-17). Behind basic auth
 * (proxy.ts, re-checked here). The browser calls it at start and when the
 * token is about to expire.
 */
export async function GET(_req: Request, ctx: RouteContext<"/booth/[slug]/token">) {
  await connection();
  await requireAdmin();
  const slug = SlugSchema.safeParse((await ctx.params).slug);
  if (!slug.success) return new Response("Not found", { status: 404 });
  const event = await (await getEventRepo()).get(slug.data);
  if (!event || event.state === "draft") return new Response("Not found", { status: 404 });
  // e2e mode has no Twilio Sync to push from: the screen stays on its server render.
  if (process.env.PORTRAIT_E2E_FAKE_SYNC === "1") return new Response("Live updates unavailable in test mode", { status: 503 });
  const { sync } = getServices();
  try {
    // Objects must exist before a read-only token can open them.
    await publishBooth(sync, event);
    const t = await boothToken(sync, slug.data);
    return Response.json({ token: t.token, ttl: t.ttl }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    log.error({ event: "booth_token_failed", slug: slug.data, err: (err as Error).message }, "booth token failed");
    return new Response("Unavailable", { status: 503 });
  }
}
