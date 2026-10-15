import { Suspense } from "react";
import { en } from "@/i18n/en";
import { loadAdminEvent } from "@/lib/admin/event-load";
import { printerStatus, type PrinterView } from "@/lib/admin/printer-status";
import { BACKGROUND_IDS } from "@/lib/events/schema";
import { STYLE_IDS } from "@/lib/prompts/styles";
import { getServices } from "@/lib/services";
import { readLastReset, readStats } from "@/lib/stats";
import { StatsSkeleton } from "../../../_components/skeletons";

const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

function Row({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex justify-between gap-6 border-b border-line/70 py-2 text-sm last:border-0">
      <dt className="text-slate">{label}</dt>
      <dd className="font-medium tabular-nums" data-testid={`stat-${label}`}>{value}</dd>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-white px-5 py-4">
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      <dl>{children}</dl>
    </section>
  );
}

/** The attendee journey as one sequence; each bar is its share of the first step. */
function Funnel({ steps }: { steps: { label: string; value: number }[] }) {
  const max = Math.max(1, steps[0]!.value);
  return (
    <ol className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3 lg:grid-cols-5">
      {steps.map((s) => (
        <li key={s.label} className="bg-white px-5 py-4">
          <p className="text-sm text-slate">{s.label}</p>
          <p className="mt-1 font-display text-3xl font-semibold tabular-nums tracking-tight">{s.value}</p>
          <div className="mt-3 h-1 rounded-full bg-mist" aria-hidden>
            <div className="h-1 rounded-full bg-ink" style={{ width: `${Math.min(100, (s.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function Printer({ p }: { p: PrinterView }) {
  if (p.kind === "none") return <p className="text-sm text-slate">No print agent has connected yet.</p>;
  if (p.kind === "offline") return <p className="text-sm text-pause">Agent offline. Last seen {fmt(p.lastSeen)}.</p>;
  const ok = p.status === "idle" || p.status === "printing";
  return (
    <p className={`text-sm ${ok ? "text-go" : "text-pause"}`} data-testid="printer-status">
      {p.status.replaceAll("_", " ")}
      {p.detail ? ` (${p.detail})` : ""}, {p.mode === "simulate" ? "simulator" : `printer ${p.queue}`}, agent {p.agentVersion}
    </p>
  );
}

/** Stats (SPEC §10.5). Counters only, no personal data; the leads CSV is separate. */
async function Stats({ params }: { params: Promise<{ slug: string }> }) {
  const event = await loadAdminEvent((await params).slug);
  const slug = event.slug;
  const { sync } = getServices();
  const [s, lastReset, printer] = await Promise.all([readStats(sync, slug), readLastReset(sync, slug), printerStatus(sync, slug)]);
  const n = (k: string) => s[k] ?? 0;
  const avg = n("deliveryCount") ? `${Math.round(n("deliveryMsTotal") / n("deliveryCount") / 1000)} s` : "–";
  const styles = STYLE_IDS.filter((id) => n(`style:${id}`) > 0);
  const backgrounds = BACKGROUND_IDS.filter((id) => n(`background:${id}`) > 0);

  return (
    <div className="space-y-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-display text-2xl font-semibold tracking-tight">Stats</h2>
          <p className="text-sm text-slate" data-testid="last-reset">{lastReset ? `Counting since ${fmt(lastReset)}` : "Never reset"}</p>
        </div>
        <Funnel
          steps={[
            { label: "Interactions", value: n("interactions") },
            { label: "Opted in", value: n("uniqueOptIns") },
            { label: "Portraits requested", value: n("imagesRequested") },
            { label: "Delivered", value: n("imagesDelivered") },
            { label: "Printed", value: n("printsSucceeded") },
          ]}
        />
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Portraits">
            <Row label="Flagged" value={n("flagged")} />
            <Row label="Approved by admin" value={n("approvedByAdmin")} />
            <Row label="Rejected" value={n("rejected")} />
            <Row label="Failed" value={n("failed")} />
            <Row label="Average selfie to delivery" value={avg} />
            <Row label="Shown on the booth screen" value={n("slideshowYes")} />
          </Card>
          <Card title="Leads">
            <Row label="Leads: verified email" value={n("leadsVerifiedEmail")} />
            <Row label="Leads: returning" value={n("leadsReturning")} />
            <Row label="Leads: agree only" value={n("leadsAgreeOnly")} />
            <Row label="Deletion requests" value={n("deletionRequests")} />
          </Card>
          <Card title="Printing">
            <Row label="Prints succeeded" value={n("printsSucceeded")} />
            <Row label="Prints failed" value={n("printsFailed")} />
            <div className="pt-3">
              <Printer p={printer} />
            </div>
          </Card>
          <Card title="Styles and backgrounds">
            {styles.length + backgrounds.length === 0 && <p className="py-2 text-sm text-slate">Nothing generated yet.</p>}
            {styles.map((id) => <Row key={id} label={en.styles[id].name} value={n(`style:${id}`)} />)}
            {backgrounds.map((id) => <Row key={id} label={id === "uploaded" ? "Custom background" : en.backgrounds[id].name} value={n(`background:${id}`)} />)}
          </Card>
        </div>
        <p className="text-xs leading-relaxed text-slate">
          Reset the counters with <code className="rounded bg-white px-1 py-0.5 ring-1 ring-line">pnpm --filter web stats:reset --event {slug}</code>. Export leads with{" "}
          <code className="rounded bg-white px-1 py-0.5 ring-1 ring-line">pnpm --filter web leads:export --event {slug}</code>.
        </p>
    </div>
  );
}

export default function StatsPage(props: PageProps<"/admin/events/[slug]/stats">) {
  return (
    <Suspense fallback={<StatsSkeleton />}>
      <Stats params={props.params} />
    </Suspense>
  );
}
