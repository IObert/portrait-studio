import { connection } from "next/server";
import { getInboundDeps } from "@/lib/conversation/context";
import { apologize, handleInbound } from "@/lib/conversation/inbound";
import { getEnv, requireEnv } from "@/lib/env";
import { log } from "@/lib/log";
import { parseAddress } from "@/lib/messaging/address";
import { InboundSchema, mediaOf, selectionOf } from "@/lib/twilio/inbound";
import { isValidTwilioSignature } from "@/lib/twilio/signature";

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response/>';
const twiml = () => new Response(EMPTY_TWIML, { status: 200, headers: { "content-type": "text/xml" } });

/**
 * Single inbound webhook for the Messaging Service (SPEC §5.1). Replies are
 * sent with the REST API; the response is always empty TwiML.
 */
export async function POST(request: Request) {
  await connection();
  const env = requireEnv(getEnv(), ["TWILIO_AUTH_TOKEN", "PUBLIC_BASE_URL"]);
  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form) if (typeof v === "string") params[k] = v;

  const url = new URL(request.url);
  if (
    !isValidTwilioSignature({
      authToken: env.TWILIO_AUTH_TOKEN,
      publicBaseUrl: env.PUBLIC_BASE_URL,
      pathAndQuery: url.pathname + url.search,
      signature: request.headers.get("x-twilio-signature"),
      params,
    })
  ) {
    log.warn({ event: "inbound_bad_signature" }, "rejected inbound webhook with invalid signature");
    return new Response("Forbidden", { status: 403 });
  }

  const parsed = InboundSchema.safeParse(params);
  const from = parsed.success ? parseAddress(parsed.data.From) : null;
  if (!parsed.success || !from) {
    log.warn({ event: "inbound_invalid", fields: parsed.success ? ["From"] : parsed.error.issues.map((i) => i.path.join(".")) }, "invalid inbound payload");
    return twiml();
  }
  const m = parsed.data;

  const deps = await getInboundDeps();
  try {
    await handleInbound(deps, {
      messageSid: m.MessageSid,
      from,
      to: m.To.replace(/^whatsapp:/, ""),
      text: m.Body,
      selection: selectionOf(m),
      media: mediaOf(params, m.NumMedia),
    });
  } catch (err) {
    // Fail closed: nothing proceeds, the attendee gets a localized apology (SPEC §5.6).
    log.error({ event: "inbound_failed", messageSid: m.MessageSid, err: (err as Error).message }, "inbound processing failed");
    await apologize(deps, from, m.To.replace(/^whatsapp:/, ""));
  }
  return twiml();
}
