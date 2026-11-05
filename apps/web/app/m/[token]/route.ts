import { connection } from "next/server";
import { getEventRepo } from "@/lib/admin/context";
import { getEnv, requireEnv } from "@/lib/env";
import { applyCalibration } from "@/lib/image/calibration";
import { verifyMedia } from "@/lib/media-token";
import { getServices } from "@/lib/services";

/**
 * Streams a generated image for a signed, expiring link (SPEC §6.1). Used as
 * the Twilio media URL and the print agent's download link; the token is the only credential.
 * A print PNG is fitted to what the event's printer does not trim (D-45) as it is
 * downloaded, so a change to the calibration also reaches prints that are already queued.
 */
export async function GET(_req: Request, ctx: RouteContext<"/m/[token]">) {
  await connection();
  const { MEDIA_SIGNING_SECRET } = requireEnv(getEnv(), ["MEDIA_SIGNING_SECRET"]);
  const claim = verifyMedia(MEDIA_SIGNING_SECRET, (await ctx.params).token);
  if (!claim) return new Response("Not found", { status: 404 });
  let bytes = await getServices().blob.get(claim.p);
  if (!bytes) return new Response("Not found", { status: 404 });
  if (claim.p.endsWith(".print.png")) {
    // The slug is safe to read here: verifyMedia only passes events/<slug>/generated/ paths.
    const event = await (await getEventRepo()).get(claim.p.split("/")[1]!);
    if (event) bytes = await applyCalibration(bytes, event.config.printCalibration);
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": claim.p.endsWith(".png") ? "image/png" : "image/jpeg",
      "content-length": String(bytes.byteLength),
      "cache-control": "private, max-age=300",
      "x-robots-tag": "noindex",
    },
  });
}
