import Link from "next/link";
import { Suspense } from "react";
import { en } from "@/i18n/en";
import { loadAdminEvent } from "@/lib/admin/event-load";
import { listForReview, type ReviewItem } from "@/lib/review/list";
import { ReviewButtons } from "../../../_components/review-buttons";
import { ReviewSkeleton } from "../../../_components/skeletons";
import { Empty, Notice } from "../../../_components/ui";

function Thumb({ url, label, size = "md" }: { url: string | null; label: string; size?: "md" | "lg" }) {
  return (
    <figure className="shrink-0 space-y-1.5">
      <div className={`flex aspect-2/3 items-center justify-center overflow-hidden rounded-lg bg-mist ${size === "lg" ? "w-36" : "w-28"}`}>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived SAS URL
          <img src={url} alt={label} className="h-full w-full object-cover" />
        ) : (
          <span className="text-xs text-slate">{label}: gone</span>
        )}
      </div>
      <figcaption className="text-xs text-slate">{label}</figcaption>
    </figure>
  );
}

/** Style, background, people and who, as separate facts rather than one dotted string. */
function Meta({ item }: { item: ReviewItem }) {
  const bg = !item.job.background ? "?" : item.job.background === "uploaded" ? "Custom background" : en.backgrounds[item.job.background].name;
  const facts = [
    item.job.style ? en.styles[item.job.style].name : "Unknown style",
    bg,
    `${item.job.subjects ?? "?"} ${item.job.subjects === 1 ? "person" : "people"}`,
  ];
  return (
    <div className="space-y-1.5">
      <ul className="flex flex-wrap gap-1.5">
        {facts.map((f) => (
          <li key={f} className="rounded-md bg-mist px-2 py-0.5 text-xs text-ink">
            {f}
          </li>
        ))}
      </ul>
      <p className="font-mono text-xs text-slate">{item.who}</p>
    </div>
  );
}

const PRINT_LABEL: Record<string, string> = { queued: "Queued to print", printing: "Printing", printed: "Printed", failed: "Print failed" };

const NOTICES: Record<string, string> = {
  removed: "Removed. The share link no longer works and the files are deleted.",
  "removed-printing": "Removed. A print was already in progress and could not be stopped.",
};

async function Review({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ tab?: string; notice?: string }> }) {
  const event = await loadAdminEvent((await params).slug);
  const slug = event.slug;
  const sp = await searchParams;
  const tab = sp.tab === "delivered" ? "delivered" : "flagged";
  const notice = sp.notice ? NOTICES[sp.notice] : undefined;
  const { flagged, delivered } = await listForReview(slug);
  const tabLink = (t: string, label: string, n: number) => (
    <Link
      href={`/admin/events/${slug}/review?tab=${t}`}
      aria-current={tab === t ? "page" : undefined}
      className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === t ? "bg-white text-ink shadow-sm ring-1 ring-line" : "text-slate hover:text-ink"}`}
    >
      {label} <span className="tabular-nums text-slate">({n})</span>
    </Link>
  );

  return (
    <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-semibold tracking-tight">Review</h2>
            <p className="mt-0.5 text-sm text-slate">
              {tab === "flagged" ? "Portraits the AI check held back. Approve to send them, or discard." : "Portraits attendees received. Remove one to take it off the screen and break its share link."}
            </p>
          </div>
          <nav className="flex gap-1 rounded-lg bg-mist p-1 ring-1 ring-line">
            {tabLink("flagged", "Flagged", flagged.length)}
            {tabLink("delivered", "Delivered", delivered.length)}
          </nav>
        </div>
        {notice && <Notice>{notice}</Notice>}

        {tab === "flagged" ? (
          flagged.length === 0 ? (
            <Empty title="Nothing flagged.">New flags appear here when the AI check is unsure about a portrait.</Empty>
          ) : (
            <ul className="space-y-4">
              {flagged.map((item) => (
                <li key={item.job.jobId} className="flex flex-col gap-5 rounded-xl border border-line bg-white p-5 sm:flex-row" data-testid="flagged-item">
                  <div className="flex gap-3">
                    <Thumb url={item.selfieUrl} label="Selfie" />
                    <Thumb url={item.outputUrl} label="Output" size="lg" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-4">
                    <Meta item={item} />
                    <div className="rounded-lg border-l-2 border-pause bg-pause/5 px-3 py-2 text-sm">
                      <p className="font-medium text-pause">Why it was flagged</p>
                      <p className="mt-0.5">{item.job.aiReview?.reason || "No reason given."}</p>
                    </div>
                    <ReviewButtons slug={slug} jobId={item.job.jobId} actions={[{ action: "approve", label: "Approve & send" }, { action: "discard", label: "Discard" }]} />
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : delivered.length === 0 ? (
          <Empty title="Nothing delivered yet.">Portraits show up here as soon as they reach an attendee.</Empty>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {delivered.map((item) => {
              const printPending = item.print && (item.print.state === "queued" || item.print.state === "failed");
              const actions = [
                ...(event.config.printingEnabled ? [{ action: "reprint" as const, label: "Reprint" }] : []),
                ...(printPending ? [{ action: "print_remove" as const, label: "Remove from print queue" }] : []),
                { action: "remove" as const, label: "Remove" },
              ];
              return (
                <li key={item.job.jobId} className="flex gap-4 rounded-xl border border-line bg-white p-4" data-testid="delivered-item">
                  <Thumb url={item.outputUrl} label="Portrait" />
                  <div className="min-w-0 flex-1 space-y-3">
                    <Meta item={item} />
                    <ul className="space-y-0.5 text-sm text-slate">
                      <li>{item.inSlideshow ? "On the booth screen" : "Not on the booth screen"}</li>
                      <li>{item.print ? `${PRINT_LABEL[item.print.state] ?? item.print.state}${item.print.reprint ? " (reprint)" : ""}` : "Not printed"}</li>
                    </ul>
                    {/* Always mounted: the result message must survive the last action disappearing. */}
                    <ReviewButtons slug={slug} jobId={item.job.jobId} actions={actions} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
    </div>
  );
}

export default function ReviewPage(props: PageProps<"/admin/events/[slug]/review">) {
  return (
    <Suspense fallback={<ReviewSkeleton />}>
      <Review params={props.params} searchParams={props.searchParams as Promise<{ tab?: string; notice?: string }>} />
    </Suspense>
  );
}
