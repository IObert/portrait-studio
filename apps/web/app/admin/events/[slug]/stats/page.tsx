import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { en } from "@/i18n/en";
import { getEventRepo } from "@/lib/admin/context";
import { requireAdmin } from "@/lib/admin/guard";
import { printerStatus, type PrinterView } from "@/lib/admin/printer-status";
import { BACKGROUND_IDS } from "@/lib/events/schema";
import { STYLE_IDS } from "@/lib/prompts/styles";
import { getServices } from "@/lib/services";
import { readLastReset, readStats } from "@/lib/stats";
import { SlugSchema } from "@/lib/sync/names";

const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

function Row({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex justify-between gap-6 border-b border-zinc-100 py-1.5 text-sm last:border-0">
      <dt className="text-zinc-600">{label}</dt>
      <dd className="font-medium tabular-nums" data-testid={`stat-${label}`}>{value}</dd>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
      <dl>{children}</dl>
    </section>
  );
}

function Printer({ p }: { p: PrinterView }) {
  if (p.kind === "none") return <p className="text-sm text-zinc-500">No print agent has connected yet.</p>;
  if (p.kind === "offline") return <p className="text-sm text-amber-700">Agent offline. Last seen {fmt(p.lastSeen)}.</p>;
  const ok = p.status === "idle" || p.status === "printing";
  return (
    <p className={`text-sm ${ok ? "text-emerald-700" : "text-amber-700"}`} data-testid="printer-status">
      {p.status.replaceAll("_", " ")}
      {p.detail ? ` (${p.detail})` : ""} · {p.mode === "simulate" ? "simulator" : p.queue} · agent {p.agentVersion}
    </p>
  );
}

/** Stats (SPEC §10.5). Counters only, no personal data; the leads CSV is separate. */
async function Stats({ params }: { params: Promise<{ slug: string }> }) {
  await requireAdmin();
  const slug = SlugSchema.safeParse((await params).slug);
  if (!slug.success) notFound();
  const event = await (await getEventRepo()).get(slug.data);
  if (!event) notFound();
  const { sync } = getServices();
  const [s, lastReset, printer] = await Promise.all([readStats(sync, slug.data), readLastReset(sync, slug.data), printerStatus(sync, slug.data)]);
  const n = (k: string) => s[k] ?? 0;
  const avg = n("deliveryCount") ? `${Math.round(n("deliveryMsTotal") / n("deliveryCount") / 1000)} s` : "–";
  const styles = STYLE_IDS.filter((id) => n(`style:${id}`) > 0);
  const backgrounds = BACKGROUND_IDS.filter((id) => n(`background:${id}`) > 0);

  return (
    <div className="space-y-6">
      <Link href={`/admin/events/${slug.data}`} className="text-sm text-zinc-500 hover:text-zinc-800">
        ← {event.config.name}
      </Link>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold">Stats</h1>
        <p className="text-sm text-zinc-500" data-testid="last-reset">{lastReset ? `Counting since ${fmt(lastReset)}` : "Never reset"}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="People">
          <Row label="Interactions" value={n("interactions")} />
          <Row label="Opted in" value={n("uniqueOptIns")} />
          <Row label="Leads: verified email" value={n("leadsVerifiedEmail")} />
          <Row label="Leads: returning" value={n("leadsReturning")} />
          <Row label="Leads: agree only" value={n("leadsAgreeOnly")} />
          <Row label="Deletion requests" value={n("deletionRequests")} />
        </Card>
        <Card title="Portraits">
          <Row label="Requested" value={n("imagesRequested")} />
          <Row label="Delivered" value={n("imagesDelivered")} />
          <Row label="Flagged" value={n("flagged")} />
          <Row label="Rejected" value={n("rejected")} />
          <Row label="Failed" value={n("failed")} />
          <Row label="Approved by admin" value={n("approvedByAdmin")} />
          <Row label="Average selfie to delivery" value={avg} />
          <Row label="Shown on the booth screen" value={n("slideshowYes")} />
        </Card>
        <Card title="Printing">
          <Row label="Prints succeeded" value={n("printsSucceeded")} />
          <Row label="Prints failed" value={n("printsFailed")} />
          <div className="pt-2">
            <Printer p={printer} />
          </div>
        </Card>
        <Card title="Styles and backgrounds">
          {styles.length + backgrounds.length === 0 && <p className="text-sm text-zinc-500">Nothing generated yet.</p>}
          {styles.map((id) => <Row key={id} label={en.styles[id].name} value={n(`style:${id}`)} />)}
          {backgrounds.map((id) => <Row key={id} label={id === "uploaded" ? "Uploaded background" : en.backgrounds[id].name} value={n(`background:${id}`)} />)}
        </Card>
      </div>
      <p className="text-xs text-zinc-500">
        Reset the counters with <code>pnpm --filter web stats:reset --event {slug.data}</code>. Export leads with{" "}
        <code>pnpm --filter web leads:export --event {slug.data}</code>.
      </p>
    </div>
  );
}

export default function StatsPage(props: PageProps<"/admin/events/[slug]/stats">) {
  return (
    <Suspense fallback={null}>
      <Stats params={props.params} />
    </Suspense>
  );
}
