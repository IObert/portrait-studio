import Link from "next/link";
import { Suspense } from "react";
import { en } from "@/i18n/en";
import { loadAdminEvent } from "@/lib/admin/event-load";
import { printerStatus } from "@/lib/admin/printer-status";
import type { Job } from "@/lib/jobs/schema";
import { listForReview, listInProgress, listPrinting, reviewCounts } from "@/lib/review/list";
import { formatWait, IN_PROGRESS_LABEL, isSlow, PRINT_STATE_LABEL, printWaitHint } from "@/lib/review/pending";
import { getServices } from "@/lib/services";
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
function Meta({ job, who }: { job: Pick<Job, "style" | "background" | "subjects"> | null; who: string }) {
  const bg = !job?.background ? "?" : job.background === "uploaded" ? "Custom background" : en.backgrounds[job.background].name;
  const facts = [
    job?.style ? en.styles[job.style].name : "Unknown style",
    bg,
    `${job?.subjects ?? "?"} ${job?.subjects === 1 ? "person" : "people"}`,
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
      <p className="font-mono text-xs text-slate">{who}</p>
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
  const tab = (["delivered", "printing", "progress"] as const).find((t) => t === sp.tab) ?? "flagged";
  const notice = sp.notice ? NOTICES[sp.notice] : undefined;
  const counts = await reviewCounts(slug);
  const { flagged, delivered } = tab === "flagged" || tab === "delivered" ? await listForReview(slug) : { flagged: [], delivered: [] };
  const printing = tab === "printing" ? await listPrinting(slug) : [];
  const printer = tab === "printing" ? await printerStatus(getServices().sync, slug) : null;
  const inProgress = tab === "progress" ? await listInProgress(slug) : [];
  const description = {
    flagged: "Portraits the AI check held back. Approve to send them, or discard.",
    delivered: "Portraits attendees received. Remove one to take it off the screen and break its share link.",
    printing: "Prints that have not come out yet, the oldest first. A print that waits too long is explained here.",
    progress: "Portraits that are not done: being checked, waiting for a choice, generating, or failed. The longest-waiting come first.",
  }[tab];
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
              {description}
            </p>
          </div>
          <nav className="flex gap-1 rounded-lg bg-mist p-1 ring-1 ring-line">
            {tabLink("flagged", "Flagged", counts.flagged)}
            {tabLink("delivered", "Delivered", counts.delivered)}
            {tabLink("printing", "Printing", counts.printing)}
            {tabLink("progress", "In progress", counts.inProgress)}
          </nav>
        </div>
        {notice && <Notice>{notice}</Notice>}

        {tab === "printing" ? (
          <>
            {printer && (
              <p className="text-sm text-slate" data-testid="printing-agent">
                {printer.kind === "none"
                  ? "No print agent has connected to this event."
                  : printer.kind === "offline"
                    ? "The print agent is offline."
                    : `Print agent online: ${printer.status.replaceAll("_", " ")}, ${printer.queue}.`}
              </p>
            )}
            {printing.length === 0 ? (
              <Empty title="Nothing is waiting to print.">Prints appear here from the moment they are asked for until they have come out.</Empty>
            ) : (
              <ul className="grid gap-4 md:grid-cols-2">
                {printing.map((item) => {
                  const hint = printer ? printWaitHint(item.state, item.waitedMs, printer) : null;
                  const actions = [
                    ...(item.state === "failed" ? [{ action: "reprint" as const, label: "Reprint" }] : []),
                    ...(item.state === "queued" || item.state === "failed" ? [{ action: "print_remove" as const, label: "Remove from print queue" }] : []),
                  ];
                  return (
                    <li key={item.jobId} className="flex gap-4 rounded-xl border border-line bg-white p-4" data-testid="printing-item">
                      <Thumb url={item.outputUrl} label="Portrait" />
                      <div className="min-w-0 flex-1 space-y-3">
                        <Meta job={item.job} who={item.who} />
                        <ul className="space-y-0.5 text-sm text-slate">
                          <li>
                            {PRINT_STATE_LABEL[item.state]}
                            {item.reprint ? " (reprint)" : ""}
                          </li>
                          <li>Asked for {item.waitedMs === null ? "at an unknown time" : `${formatWait(item.waitedMs)} ago`}</li>
                          {item.state === "failed" && <li className="text-danger">{item.error || "No reason recorded."}</li>}
                        </ul>
                        {hint && (
                          <p className="rounded-lg border-l-2 border-pause bg-pause/5 px-3 py-2 text-sm" data-testid="printing-hint">
                            {hint}
                          </p>
                        )}
                        {actions.length > 0 && <ReviewButtons slug={slug} jobId={item.jobId} actions={actions} />}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : tab === "progress" ? (
          inProgress.length === 0 ? (
            <Empty title="Nothing in progress.">Portraits appear here while they are checked or generated, and stay if they get stuck or fail.</Empty>
          ) : (
            <ul className="grid gap-4 md:grid-cols-2">
              {inProgress.map((item) => {
                const slow = isSlow(item.state, item.waitedMs);
                return (
                  <li key={item.job.jobId} className="space-y-3 rounded-xl border border-line bg-white p-4" data-testid="progress-item" data-slow={slow ? "true" : "false"}>
                    <Meta job={item.job} who={item.who} />
                    <ul className="space-y-0.5 text-sm text-slate">
                      <li className={slow ? "font-medium text-pause" : undefined}>{IN_PROGRESS_LABEL[item.state]}</li>
                      <li>{item.waitedMs === null ? "Since an unknown time" : `For ${formatWait(item.waitedMs)}`}</li>
                      {item.job.attempts > 0 && <li>Attempts: {item.job.attempts}</li>}
                      {item.state === "failed" && <li className="text-danger">{item.job.error || "No reason recorded."}</li>}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )
        ) : tab === "flagged" ? (
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
                    <Meta job={item.job} who={item.who} />
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
              // A print on its way cannot be asked for again; "Print" is for a portrait never printed, "Reprint" after one was.
              const printOnItsWay = item.print && (item.print.state === "queued" || item.print.state === "claimed" || item.print.state === "printing");
              const actions = [
                ...(event.config.printingEnabled && !printOnItsWay ? [{ action: "reprint" as const, label: item.print ? "Reprint" : "Print" }] : []),
                ...(printPending ? [{ action: "print_remove" as const, label: "Remove from print queue" }] : []),
                // Only hides it from the booth screen; "Remove" below is final (share link and files).
                ...(item.inSlideshow ? [{ action: "slideshow_hide" as const, label: "Hide from booth screen" }] : []),
                ...(item.hiddenFromScreen && !item.inSlideshow ? [{ action: "slideshow_show" as const, label: "Show on booth screen again" }] : []),
                { action: "remove" as const, label: "Remove" },
              ];
              return (
                <li key={item.job.jobId} className="flex gap-4 rounded-xl border border-line bg-white p-4" data-testid="delivered-item">
                  <Thumb url={item.outputUrl} label="Portrait" />
                  <div className="min-w-0 flex-1 space-y-3">
                    <Meta job={item.job} who={item.who} />
                    <ul className="space-y-0.5 text-sm text-slate">
                      <li>{item.inSlideshow ? "On the booth screen" : item.hiddenFromScreen ? "Hidden from the booth screen" : "Not on the booth screen"}</li>
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
