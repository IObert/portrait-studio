import { ShareSchema } from "../delivery/deliver";
import { bump } from "../stats";
import { Global } from "../sync/names";
import { SKIP, type SyncStore } from "../sync/store";

/** What the share page reports (D-50): the page opened, the share sheet used, the text copied, the image downloaded. */
export const SHARE_EVENT_KINDS = ["view", "share", "copy", "download"] as const;
export type ShareEventKind = (typeof SHARE_EVENT_KINDS)[number];

const METRIC = { view: "shareViews", share: "shareShares", copy: "shareTextCopied", download: "shareDownloads" } as const;

/**
 * Counts one event on a share page (D-50). Counters only: no address, no browser details.
 * The first `view` of a portrait's link also marks the link as opened, so the stats page can say how many
 * portraits were looked at, not only how many times.
 */
export async function recordShareEvent(sync: SyncStore, slug: string, shareId: string, kind: ShareEventKind, now: Date): Promise<void> {
  await bump(sync, slug, METRIC[kind]);
  if (kind !== "view") return;
  let first = false;
  await sync.map(Global.shares, ShareSchema).update(shareId, (cur) => {
    first = !!cur && !cur.openedAt;
    return first ? { ...cur!, openedAt: now.toISOString() } : SKIP;
  });
  if (first) await bump(sync, slug, "shareLinksOpened");
}
