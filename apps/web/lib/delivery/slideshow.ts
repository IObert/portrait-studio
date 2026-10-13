import { z } from "zod";
import type { Catalog } from "../../i18n/types";
import { ACTION_SLIDESHOW } from "../conversation/actions";
import type { Session } from "../conversation/session";
import { matchesKeyword } from "../conversation/text";
import type { Channel } from "../messaging/address";

/**
 * `url` is the signed image link, stored so the booth gets it with the push (D-17).
 * Items written before it existed fall back to signing on read.
 */
export const SlideshowItemSchema = z.object({ blobPath: z.string(), addedAt: z.iso.datetime(), url: z.string().url().optional() });

export type SlideshowAnswer = { jobId: string; answer: "yes" | "no" } | null;

/**
 * Reads a slideshow answer (SPEC §5.8): the button payload, or on SMS an exact
 * localized keyword for the pending question. Anything else is not an answer,
 * and no answer means the image is not shown.
 */
export function readSlideshowAnswer(session: Session, c: Catalog, input: { channel: Channel; text: string; selection?: string }): SlideshowAnswer {
  const fromButton = ACTION_SLIDESHOW.parse(input.selection);
  if (fromButton) return fromButton;
  if (input.channel !== "sms" || !session.pendingSlideshow) return null;
  if (matchesKeyword(input.text, c.delivery.yesKeywords)) return { jobId: session.pendingSlideshow.jobId, answer: "yes" };
  if (matchesKeyword(input.text, c.delivery.noKeywords)) return { jobId: session.pendingSlideshow.jobId, answer: "no" };
  return null;
}
