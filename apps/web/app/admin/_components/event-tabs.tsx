"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";

/**
 * Tabs under the event header. Lives in the event layout, which stays mounted across tabs,
 * so the active tab comes from the URL on the client and moves on click, before the page arrives.
 */
export function EventTabs({ slug, flagged, boothOpen }: { slug: string; flagged: number; boothOpen: boolean }) {
  // null on the settings page itself; "review" / "stats" below it.
  const segment = useSelectedLayoutSegment() ?? "settings";
  const base = `/admin/events/${slug}`;
  const tabs = [
    { id: "settings", href: base, label: "Settings" },
    { id: "review", href: `${base}/review`, label: "Review", badge: flagged },
    { id: "stats", href: `${base}/stats`, label: "Stats" },
  ];
  return (
    <nav aria-label="Event" className="flex items-center gap-1 overflow-x-auto border-b border-line whitespace-nowrap">
      {tabs.map((t) => (
        <Link
          key={t.id}
          href={t.href}
          // Load the tab's content ahead of the click, not just its shell.
          prefetch
          aria-current={t.id === segment ? "page" : undefined}
          className={`-mb-px inline-flex items-center border-b-2 px-3 py-2.5 text-sm font-medium ${t.id === segment ? "border-signal text-ink" : "border-transparent text-slate hover:text-ink"}`}
        >
          {t.label}
          {!!t.badge && (
            <span className="ml-1.5 rounded-full bg-signal px-1.5 py-px text-xs font-semibold text-white">
              <span className="sr-only">, flagged: </span>
              {t.badge}
            </span>
          )}
        </Link>
      ))}
      {/* Drafts have no booth screen (SPEC §4.1). */}
      {boothOpen && (
        <Link href={`/booth/${slug}`} target="_blank" prefetch={false} className="-mb-px ml-auto inline-flex items-center gap-1 border-b-2 border-transparent px-3 py-2.5 text-sm font-medium text-slate hover:text-ink">
          Open booth screen
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <path d="M6 3H3v10h10v-3M9 3h4v4M13 3L7 9" />
          </svg>
        </Link>
      )}
    </nav>
  );
}
