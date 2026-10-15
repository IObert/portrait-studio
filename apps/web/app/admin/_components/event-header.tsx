import Link from "next/link";
import { printerStatus } from "@/lib/admin/printer-status";
import type { PortraitEvent } from "@/lib/events/schema";
import { countFlagged } from "@/lib/review/list";
import { getServices } from "@/lib/services";
import { StateControls } from "./controls";
import { EventTabs } from "./event-tabs";
import { PrinterSummary } from "./printer-summary";
import { StateBadge } from "./state-badge";

const backLink = (
  <Link href="/admin" className="inline-flex items-center gap-1 text-sm text-slate hover:text-ink">
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M10 3L5 8l5 5" />
    </svg>
    Events
  </Link>
);

/** Top of every event page: who, what state, is the printer ready, and where to go next. Rendered once, by the event layout. */
export async function EventHeader({ event }: { event: PortraitEvent }) {
  const [printer, flagged] = await Promise.all([printerStatus(getServices().sync, event.slug), countFlagged(event.slug)]);
  return (
    <div className="mb-8 space-y-5">
      {backLink}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl font-semibold tracking-tight">{event.config.name}</h1>
            <StateBadge state={event.state} />
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-slate">
            <span className="font-mono text-xs">{event.slug}</span>
            <PrinterSummary printingEnabled={event.config.printingEnabled} printer={printer} />
          </div>
        </div>
        <StateControls slug={event.slug} state={event.state} />
      </div>
      <EventTabs slug={event.slug} flagged={flagged} boothOpen={event.state !== "draft"} />
    </div>
  );
}

/** Same footprint as the header, for the first load only; tab switches never show it. */
export function EventHeaderSkeleton() {
  const bar = "rounded-md bg-line/70 motion-safe:animate-pulse";
  return (
    <div className="mb-8 space-y-5" aria-hidden>
      {backLink}
      <div className="space-y-3">
        <div className={`${bar} h-9 w-72`} />
        <div className={`${bar} h-4 w-56`} />
      </div>
      <div className="flex gap-4 border-b border-line pb-3">
        {[64, 56, 44].map((w) => (
          <div key={w} className={`${bar} h-4`} style={{ width: w }} />
        ))}
      </div>
    </div>
  );
}
