import { connection } from "next/server";
import { getEnv, requireEnv } from "@/lib/env";
import { verifyMedia } from "@/lib/media-token";
import { getServices } from "@/lib/services";

/**
 * Streams a generated image for a signed, expiring link (SPEC §6.1). Used as
 * the Twilio media URL; the token is the only credential. A trailing `.jpg`
 * is ignored: the WhatsApp delivery template's media URL must end in a file
 * type (`<base>/{{1}}` with `{{1}}` = `m/<token>.jpg`).
 */
export async function GET(_req: Request, ctx: RouteContext<"/m/[token]">) {
  await connection();
  const { MEDIA_SIGNING_SECRET } = requireEnv(getEnv(), ["MEDIA_SIGNING_SECRET"]);
  const claim = verifyMedia(MEDIA_SIGNING_SECRET, (await ctx.params).token.replace(/\.jpg$/, ""));
  if (!claim) return new Response("Not found", { status: 404 });
  const bytes = await getServices().blob.get(claim.p);
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": claim.p.endsWith(".png") ? "image/png" : "image/jpeg",
      "content-length": String(bytes.byteLength),
      "cache-control": "private, max-age=300",
      "x-robots-tag": "noindex",
    },
  });
}
