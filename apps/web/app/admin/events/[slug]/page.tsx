import { Suspense } from "react";
import { updateEventAction } from "@/lib/admin/actions";
import { loadAdminEvent } from "@/lib/admin/event-load";
import { formOptions, senderOptions } from "@/lib/admin/options";
import { SAS_TTL_SECONDS } from "@/lib/blob/store";
import { getServices } from "@/lib/services";
import { AssetUpload, PrinterToken } from "../../_components/controls";
import { EventForm } from "../../_components/event-form";
import { SettingsSkeleton } from "../../_components/skeletons";
import { SECTIONS } from "../../_components/ui";

async function EventDetail({ params }: { params: Promise<{ slug: string }> }) {
  const event = await loadAdminEvent((await params).slug);
  const slug = event.slug;

  const { blob } = getServices();
  const preview = (path: string | undefined) => (path ? blob.readUrl(path, SAS_TTL_SECONDS) : Promise.resolve(null));
  const [framePreview, backgroundPreview, senders] = await Promise.all([
    preview(event.uploads.frame?.blobPath),
    preview(event.uploads.background?.blobPath),
    senderOptions(),
  ]);
  const appUrl = process.env.PUBLIC_BASE_URL ?? "https://<your-app>";

  return (
    <div className="grid gap-10 lg:grid-cols-[11rem_1fr]">
        <nav aria-label="Settings sections" className="hidden lg:block">
          <ul className="sticky top-6 space-y-0.5 text-sm">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="block rounded-md px-2.5 py-1.5 text-slate hover:bg-white hover:text-ink">
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <EventForm
          action={updateEventAction}
          config={event.config}
          slug={slug}
          {...formOptions(event.uploads)}
          senders={senders}
          submitLabel="Save"
          framePreview={framePreview}
          slots={{
            uploads: (
              <div className="grid gap-3 md:grid-cols-2">
                <AssetUpload slug={slug} kind="frame" previewUrl={framePreview} requirements="PNG, exactly 1200×1800 px, with a transparent window for the portrait." />
                <AssetUpload slug={slug} kind="background" previewUrl={backgroundPreview} requirements="PNG or JPEG, portrait, at least 1024×1536 px. Used exactly as uploaded." />
              </div>
            ),
            printAgent: <PrinterToken slug={slug} appUrl={appUrl} token={event.printerToken} />,
          }}
        />
    </div>
  );
}

export default function EventPage(props: PageProps<"/admin/events/[slug]">) {
  return (
    <Suspense fallback={<SettingsSkeleton />}>
      <EventDetail params={props.params} />
    </Suspense>
  );
}
