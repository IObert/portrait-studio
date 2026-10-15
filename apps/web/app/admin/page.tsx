import Link from "next/link";
import { Suspense } from "react";
import { getEventRepo } from "@/lib/admin/context";
import { requireAdmin } from "@/lib/admin/guard";
import { printerStatus } from "@/lib/admin/printer-status";
import type { PortraitEvent } from "@/lib/events/schema";
import { getServices } from "@/lib/services";
import { DeleteEvent } from "./_components/controls";
import { PrinterSummary } from "./_components/printer-summary";
import { StateBadge } from "./_components/state-badge";
import { btn, Empty, Notice } from "./_components/ui";

export const metadata = { title: "Events · Portrait Studio" };

const LANGUAGES = { en: "English", pt_BR: "Português" } as const;

/** Live first, then breaks, drafts, and ended events last. */
const ORDER: Record<PortraitEvent["state"], number> = { live: 0, break: 1, draft: 2, ended: 3 };

async function EventList() {
  await requireAdmin();
  const events = (await (await getEventRepo()).list()).sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.config.name.localeCompare(b.config.name));
  if (events.length === 0)
    return (
      <Empty title="No events yet">
        <p>Create one to set up the booth screen, styles and printing.</p>
        <Link href="/admin/events/new" className={`${btn.base} ${btn.primary} mt-4`}>
          New event
        </Link>
      </Empty>
    );
  const { sync } = getServices();
  const printers = await Promise.all(events.map((e) => printerStatus(sync, e.slug)));
  return (
    <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {events.map((e, i) => (
        <li key={e.slug} className="relative flex flex-col rounded-xl border border-line bg-white transition-colors hover:border-slate/40">
          <div className="flex-1 space-y-3 px-5 pt-5 pb-4">
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-display text-lg leading-snug font-semibold tracking-tight">
                {/* The whole card opens the event; the footer actions sit above this link. */}
                <Link href={`/admin/events/${e.slug}`} className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-signal">
                  {e.config.name}
                </Link>
              </h2>
              <StateBadge state={e.state} />
            </div>
            <p className="text-sm text-slate">
              <span className="font-mono text-xs">{e.slug}</span>
              <span className="mx-2 text-line">|</span>
              {LANGUAGES[e.config.language]}
            </p>
            <PrinterSummary printingEnabled={e.config.printingEnabled} printer={printers[i]!} />
          </div>
          <div className="relative z-10 flex items-center gap-1 border-t border-line px-3 py-2">
            <Link href={`/admin/events/${e.slug}/review`} className={`${btn.base} ${btn.quiet} px-2.5 py-1.5`}>
              Review
            </Link>
            <Link href={`/admin/events/${e.slug}/stats`} className={`${btn.base} ${btn.quiet} px-2.5 py-1.5`}>
              Stats
            </Link>
            {e.state !== "draft" && (
              <Link href={`/booth/${e.slug}`} target="_blank" className={`${btn.base} ${btn.quiet} px-2.5 py-1.5`}>
                Booth screen
              </Link>
            )}
            <span className="ml-auto">
              <DeleteEvent slug={e.slug} name={e.config.name} />
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

async function DeletedNotice({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  if (!(await searchParams).deleted) return null;
  return <Notice>Event deleted, with all its data.</Notice>;
}

export default function EventsPage(props: PageProps<"/admin">) {
  return (
    <div className="space-y-8">
      <Suspense>
        <DeletedNotice searchParams={props.searchParams} />
      </Suspense>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Events</h1>
          <p className="mt-1 text-slate">Pick an event to run its booth, review portraits or change its settings.</p>
        </div>
        <Link href="/admin/events/new" className={`${btn.base} ${btn.primary}`}>
          New event
        </Link>
      </div>
      <Suspense fallback={<p className="text-slate">Loading events…</p>}>
        <EventList />
      </Suspense>
    </div>
  );
}
