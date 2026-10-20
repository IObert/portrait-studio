import { z } from "zod";

/** Fields of Twilio's inbound messaging webhook we use (SPEC §5.1). */
export const InboundSchema = z
  .object({
    MessageSid: z.string().regex(/^(SM|MM)[0-9a-f]{32}$/),
    AccountSid: z.string().regex(/^AC[0-9a-f]{32}$/),
    From: z.string().min(1),
    To: z.string().min(1),
    Body: z.string().default(""),
    NumMedia: z.coerce.number().int().min(0).default(0),
    /** Quick-reply / list-picker selections carry the item id here. */
    ButtonPayload: z.string().optional(),
    ListId: z.string().optional(),
  })
  .passthrough();

export type Inbound = z.infer<typeof InboundSchema>;

export interface InboundMedia {
  url: string;
  contentType: string;
}

/** MediaUrl0..N / MediaContentType0..N. */
export function mediaOf(params: Record<string, string>, count: number): InboundMedia[] {
  const out: InboundMedia[] = [];
  for (let i = 0; i < count; i++) {
    const url = params[`MediaUrl${i}`];
    if (url) out.push({ url, contentType: params[`MediaContentType${i}`] ?? "" });
  }
  return out;
}

/** The selected interactive option, if the message came from a button or list. */
export function selectionOf(m: Inbound): string | undefined {
  return m.ButtonPayload || m.ListId || undefined;
}
