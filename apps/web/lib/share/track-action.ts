"use server";

import { z } from "zod";
import { log } from "../log";
import { getServices } from "../services";
import { shareTarget } from "./load";
import { recordShareEvent, SHARE_EVENT_KINDS, type ShareEventKind } from "./track";

const Input = z.object({ shareId: z.string().regex(/^[A-Za-z0-9_-]{22,64}$/), kind: z.enum(SHARE_EVENT_KINDS) });

/**
 * The share page reports what the visitor did (D-50). It sends only the share id and the kind; the event
 * comes from the share record, so a made-up id counts nothing. A link that is unknown, expired or whose
 * portrait was removed is ignored. This never fails the page: a lost count is better than an error.
 */
export async function trackShareAction(shareId: string, kind: ShareEventKind): Promise<void> {
  const parsed = Input.safeParse({ shareId, kind });
  if (!parsed.success) return;
  try {
    const target = await shareTarget(parsed.data.shareId);
    if (!target || target.job.state !== "delivered") return;
    await recordShareEvent(getServices().sync, target.event.slug, parsed.data.shareId, parsed.data.kind, new Date());
  } catch (err) {
    log.warn({ event: "share_track_failed", kind, err: (err as Error).message }, "share page count failed");
  }
}
