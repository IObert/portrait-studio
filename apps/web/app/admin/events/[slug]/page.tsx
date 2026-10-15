import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { updateEventAction } from "@/lib/admin/actions";
import { getEventRepo } from "@/lib/admin/context";
import { requireAdmin } from "@/lib/admin/guard";
import { formOptions, senderOptions } from "@/lib/admin/options";
import { SAS_TTL_SECONDS } from "@/lib/blob/store";
import { getServices } from "@/lib/services";
import { SlugSchema } from "@/lib/sync/names";
import { EventForm } from "../../_components/event-form";
import { AssetUpload, PrinterToken, StateControls } from "../../_components/controls";
import { StateBadge } from "../../_components/state-badge";

async function EventDetail({ params }: { params: Promise<{ slug: string }> }) {
  await requireAdmin();
  const parsed = SlugSchema.safeParse((await params).slug);
  if (!parsed.success) notFound();
  const slug = parsed.data;
  const event = await (await getEventRepo()).get(slug);
  if (!event) notFound();

  const { blob } = getServices();
  const preview = (path: string | undefined) => (path ? blob.readUrl(path, SAS_TTL_SECONDS) : Promise.resolve(null));
  const [framePreview, backgroundPreview, senders] = await Promise.all([
    preview(event.uploads.frame?.blobPath),
    preview(event.uploads.background?.blobPath),
    senderOptions(),
  ]);
  const appUrl = process.env.PUBLIC_BASE_URL ?? "https://<your-app>";

  return (
    <div className="space-y-10">
      <div className="space-y-3">
        <Link href="/admin" className="text-sm text-zinc-500 hover:text-zinc-800">
          ← Events
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{event.config.name}</h1>
          <StateBadge state={event.state} />
        </div>
        <StateControls slug={slug} state={event.state} />
        <nav className="flex gap-4 text-sm">
          <Link href={`/admin/events/${slug}/review`} className="text-blue-700 hover:underline">Review</Link>
          <Link href={`/admin/events/${slug}/stats`} className="text-blue-700 hover:underline">Stats</Link>
          <Link href={`/booth/${slug}`} className="text-blue-700 hover:underline" target="_blank">Booth screen ↗</Link>
        </nav>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Uploads</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <AssetUpload slug={slug} kind="frame" previewUrl={framePreview} requirements="PNG, exactly 1200×1800 px, with a transparent window for the portrait." />
          <AssetUpload slug={slug} kind="background" previewUrl={backgroundPreview} requirements="PNG or JPEG, portrait, at least 1024×1536 px. Composited exactly as uploaded." />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Settings</h2>
        <EventForm action={updateEventAction} config={event.config} slug={slug} {...formOptions(event.uploads)} senders={senders} submitLabel="Save" />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Print agent</h2>
        <PrinterToken slug={slug} appUrl={appUrl} hasToken={!!event.printerTokenHash} />
      </section>
    </div>
  );
}

export default function EventPage(props: PageProps<"/admin/events/[slug]">) {
  return (
    <Suspense fallback={<p className="text-zinc-500">Loading event…</p>}>
      <EventDetail params={props.params} />
    </Suspense>
  );
}
