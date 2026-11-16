import QRCode from "qrcode";
import { connection } from "next/server";
import { getEventRepo } from "@/lib/admin/context";
import { requireAdmin } from "@/lib/admin/guard";
import { qrTarget } from "@/lib/booth/state";
import { SlugSchema } from "@/lib/sync/names";

/**
 * The event's QR code as a download (D-55): for an event without a booth screen, where it is
 * printed on a sign or shown on a slide. `?format=png` for a 1024 px image, SVG otherwise.
 */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  await connection();
  await requireAdmin();
  const slug = SlugSchema.safeParse((await ctx.params).slug);
  if (!slug.success) return new Response("Not found", { status: 404 });
  const event = await (await getEventRepo()).get(slug.data);
  if (!event) return new Response("Not found", { status: 404 });
  const target = qrTarget(event);
  const png = new URL(req.url).searchParams.get("format") === "png";
  const headers = { "cache-control": "no-store", "content-disposition": `attachment; filename="qr-${slug.data}.${png ? "png" : "svg"}"` };
  if (png) return new Response(new Uint8Array(await QRCode.toBuffer(target, { type: "png", width: 1024, margin: 2, errorCorrectionLevel: "M" })), { headers: { ...headers, "content-type": "image/png" } });
  return new Response(await QRCode.toString(target, { type: "svg", margin: 2, errorCorrectionLevel: "M" }), { headers: { ...headers, "content-type": "image/svg+xml" } });
}
