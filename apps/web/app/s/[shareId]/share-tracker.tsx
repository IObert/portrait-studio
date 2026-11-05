"use client";

import { useEffect } from "react";
import { trackShareAction } from "@/lib/share/track-action";

/**
 * Counts one page view per portrait and tab session (D-50). It runs in the browser, so the crawlers that fetch the
 * page for a link preview (WhatsApp, iMessage, Slack) are not counted, and a reload does not count twice.
 */
export function ShareTracker({ shareId }: { shareId: string }) {
  useEffect(() => {
    const key = `ps:viewed:${shareId}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // Storage is blocked (private mode): count every load rather than none.
    }
    void trackShareAction(shareId, "view").catch(() => {});
  }, [shareId]);
  return null;
}
