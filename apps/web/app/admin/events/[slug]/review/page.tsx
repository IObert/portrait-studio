import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { en } from "@/i18n/en";
import { getEventRepo } from "@/lib/admin/context";
import { requireAdmin } from "@/lib/admin/guard";
import { listForReview, type ReviewItem } from "@/lib/review/list";
import { SlugSchema } from "@/lib/sync/names";
import { ReviewButtons } from "../../../_components/review-buttons";

function Thumb({ url, label }: { url: string | null; label: string }) {
  return (
    <div className="flex h-48 w-32 shrink-0 items-center justify-center overflow-hidden rounded bg-zinc-100">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived SAS URL
        <img src={url} alt={label} className="h-full w-full object-cover" />
      ) : (
        <span className="text-xs text-zinc-400">{label}: gone</span>
      )}
    </div>
  );
}

function Meta({ item }: { item: ReviewItem }) {
  const bg = !item.job.background ? "?" : item.job.background === "uploaded" ? "Uploaded" : en.backgrounds[item.job.background].name;
  return (
    <p className="text-xs text-zinc-500">
      {item.job.style ? en.styles[item.job.style].name : "?"} · {bg} · {item.job.subjects ?? "?"} {item.job.subjects === 1 ? "person" : "people"} · {item.who}
    </p>
  );
}

const NOTICES: Record<string, string> = {
  removed: "Removed. The share link no longer works and the files are deleted.",
  "removed-printing": "Removed. A print was already in progress and could not be stopped.",
};

async function Review({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ tab?: string; notice?: string }> }) {
  await requireAdmin();
  const slug = SlugSchema.safeParse((await params).slug);
  if (!slug.success) notFound();
  const event = await (await getEventRepo()).get(slug.data);
  if (!event) notFound();
  const sp = await searchParams;
  const tab = sp.tab === "delivered" ? "delivered" : "flagged";
  const notice = sp.notice ? NOTICES[sp.notice] : undefined;
  const { flagged, delivered } = await listForReview(slug.data);
  const tabLink = (t: string, label: string, n: number) => (
    <Link href={`/admin/events/${slug.data}/review?tab=${t}`} className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === t ? "bg-zinc-900 text-white" : "bg-zinc-200 text-zinc-800"}`}>
      {label} ({n})
    </Link>
  );

  return (
    <div className="space-y-6">
      <Link href={`/admin/events/${slug.data}`} className="text-sm text-zinc-500 hover:text-zinc-800">
        ← {event.config.name}
      </Link>
      <h1 className="text-2xl font-semibold">Review</h1>
      {notice && (
        <p role="status" className="rounded-md bg-green-50 px-4 py-2 text-sm text-green-800">
          {notice}
        </p>
      )}
      <nav className="flex gap-2">
        {tabLink("flagged", "Flagged", flagged.length)}
        {tabLink("delivered", "Delivered", delivered.length)}
      </nav>

      {tab === "flagged" ? (
        flagged.length === 0 ? (
          <p className="text-zinc-600">Nothing flagged.</p>
        ) : (
          <ul className="space-y-4">
            {flagged.map((item) => (
              <li key={item.job.jobId} className="flex gap-4 rounded-lg border border-zinc-200 bg-white p-4" data-testid="flagged-item">
                <Thumb url={item.selfieUrl} label="Selfie" />
                <Thumb url={item.outputUrl} label="Output" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Meta item={item} />
                  <p className="text-sm">
                    <span className="font-medium">AI review:</span> {item.job.aiReview?.reason || "no reason given"}
                  </p>
                  <ReviewButtons slug={slug.data} jobId={item.job.jobId} actions={[{ action: "approve", label: "Approve & send" }, { action: "discard", label: "Discard" }]} />
                </div>
              </li>
            ))}
          </ul>
        )
      ) : delivered.length === 0 ? (
        <p className="text-zinc-600">Nothing delivered yet.</p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {delivered.map((item) => {
            const printPending = item.print && (item.print.state === "queued" || item.print.state === "failed");
            const actions = [
              { action: "remove" as const, label: "Remove" },
              ...(printPending ? [{ action: "print_remove" as const, label: "Remove from print queue" }] : []),
              ...(event.config.printingEnabled ? [{ action: "reprint" as const, label: "Reprint" }] : []),
            ];
            return (
              <li key={item.job.jobId} className="flex gap-4 rounded-lg border border-zinc-200 bg-white p-4" data-testid="delivered-item">
                <Thumb url={item.outputUrl} label="Portrait" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Meta item={item} />
                  <p className="text-xs text-zinc-600">
                    Slideshow: {item.inSlideshow ? "yes" : "no"} · Print: {item.print ? `${item.print.state}${item.print.reprint ? " (reprint)" : ""}` : "none"}
                  </p>
                  {/* Always mounted: the result message must survive the last action disappearing. */}
                  <ReviewButtons slug={slug.data} jobId={item.job.jobId} actions={actions} />
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
    <Suspense fallback={<p className="text-zinc-500">Loading review…</p>}>
      <Review params={props.params} searchParams={props.searchParams as Promise<{ tab?: string; notice?: string }>} />
    </Suspense>
  );
}
