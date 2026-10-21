"use client";

import { useEffect, useRef, useState } from "react";
import type { PrinterView } from "@/lib/admin/printer-status";
import { describePrinting, PrinterLine } from "./printer-summary";

/** How often the status is fetched, and how often "last seen 3 min ago" is recounted. Heartbeats arrive every 15 s; 'offline' means 45 s of silence. */
export const POLL_MS = 30_000;
const TICK_MS = 15_000;
/** After this many failed fetches in a row the line says it is not refreshing. A flaky laptop is not an offline printer. */
const STALE_AFTER_FAILURES = 2;

/**
 * Printing at a glance that stays current without a page refresh. Starts from the
 * server-rendered status (no flash), then asks the server every POLL_MS. Paused while
 * the tab is hidden, and refreshed the moment it is shown again. A failed fetch keeps
 * the last known status instead of guessing (D-44).
 */
export function LivePrinterSummary({ slug, printingEnabled, initial }: { slug: string; printingEnabled: boolean; initial: PrinterView }) {
  const [printer, setPrinter] = useState(initial);
  const [failures, setFailures] = useState(0);
  const [, setTick] = useState(0);
  const inFlight = useRef(false);

  useEffect(() => {
    let stopped = false;
    const refresh = async () => {
      if (stopped || inFlight.current || document.hidden) return;
      inFlight.current = true;
      try {
        const res = await fetch(`/admin/events/${slug}/printer`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const next = (await res.json()) as PrinterView;
        if (!stopped) {
          setPrinter(next);
          setFailures(0);
        }
      } catch {
        if (!stopped) setFailures((n) => n + 1);
      } finally {
        inFlight.current = false;
      }
    };
    const poll = setInterval(() => void refresh(), POLL_MS);
    // Recount "N min ago" between fetches; it only needs a re-render, not a request.
    const tick = setInterval(() => setTick((n) => n + 1), TICK_MS);
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(poll);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [slug]);

  const { tone, text } = describePrinting(printingEnabled, printer);
  return <PrinterLine tone={tone} text={text} stale={failures >= STALE_AFTER_FAILURES} />;
}
