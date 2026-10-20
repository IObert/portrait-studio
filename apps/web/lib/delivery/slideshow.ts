import { z } from "zod";
import type { Catalog } from "../../i18n/types";
import { ACTION_SLIDESHOW } from "../conversation/actions";
import type { Session } from "../conversation/session";
import { matchesKeyword, normalize } from "../conversation/text";
import type { Channel } from "../messaging/address";

/**
 * `url` is the signed image link, stored so the booth gets it with the push (D-17).
 * Items written before it existed fall back to signing on read.
 */
export const SlideshowItemSchema = z.object({ blobPath: z.string(), addedAt: z.iso.datetime(), url: z.string().url().optional() });

/** How long after the question a typed keyword still counts as the answer (SMS has no buttons). */
const SLIDESHOW_ANSWER_WINDOW_MS = 10 * 60 * 1000;

/** `print` means print it and show it on the booth screen (D-24). */
export type SlideshowAnswer = { jobId: string; answer: "print" | "printonly" | "yes" | "no" } | null;

/**
 * Reads the answer to the question after a delivery (SPEC §5.8, D-24): the
 * button payload, or on SMS an exact localized keyword for the pending
 * question. Anything else is not an answer, and no answer means the image is
 * neither printed nor shown. Old buttons keep working, so an earlier portrait
 * can still be printed later.
 */
export function readSlideshowAnswer(session: Session, c: Catalog, input: { channel: Channel; text: string; selection?: string }): SlideshowAnswer {
  const fromButton = ACTION_SLIDESHOW.parse(input.selection);
  if (fromButton) return fromButton;
  // SMS answer to the print menu: "PRINT 2" picks the second portrait listed (D-28).
  if (input.channel === "sms" && session.printMenu.length) {
    const m = new RegExp(`^(?:${c.delivery.printKeywords.map((k) => normalize(k)).join("|")})\\s+(\\d{1,2})$`).exec(normalize(input.text));
    const jobId = m ? session.printMenu[Number(m[1]) - 1] : undefined;
    if (jobId) return { jobId, answer: "printonly" };
  }
  if (input.channel !== "sms" || !session.pendingSlideshow) return null;
  // A bare "ok" must answer a recent question, not one ignored long ago.
  const askedAt = session.pendingSlideshow.askedAt ? Date.parse(session.pendingSlideshow.askedAt) : 0;
  if (Date.now() - askedAt > SLIDESHOW_ANSWER_WINDOW_MS) return null;
  if (session.pendingSlideshow.print && matchesKeyword(input.text, c.delivery.printKeywords)) return { jobId: session.pendingSlideshow.jobId, answer: "print" };
  if (matchesKeyword(input.text, c.delivery.yesKeywords)) return { jobId: session.pendingSlideshow.jobId, answer: "yes" };
  if (matchesKeyword(input.text, c.delivery.noKeywords)) return { jobId: session.pendingSlideshow.jobId, answer: "no" };
  return null;
}
