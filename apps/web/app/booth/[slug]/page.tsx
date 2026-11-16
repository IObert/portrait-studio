import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getEventRepo } from "@/lib/admin/context";
import { boothDoc, boothSlides } from "@/lib/booth/state";
import { getServices } from "@/lib/services";
import { SlugSchema } from "@/lib/sync/names";
import { BoothScreen } from "./booth-screen";

export const metadata = { title: "Booth", robots: { index: false, follow: false } };

/** The event runs without a big screen (D-55): say so, rather than an empty or 404 page. */
function ScreenOff({ name }: { name: string }) {
  return (
    <main className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-ink px-8 text-center text-white">
      <h1 className="text-2xl font-semibold">The booth screen is turned off</h1>
      <p className="max-w-md text-white/70">{name} runs without a big screen. It can be turned on in the event settings.</p>
    </main>
  );
}

async function Booth({ params }: { params: Promise<{ slug: string }> }) {
  const slug = SlugSchema.safeParse((await params).slug);
  if (!slug.success) notFound();
  const event = await (await getEventRepo()).get(slug.data);
  // Drafts are not shown (SPEC §4.1).
  if (event && event.state !== "draft" && !event.config.boothScreenEnabled) return <ScreenOff name={event.config.name} />;
  const doc = event ? await boothDoc(event) : null;
  if (!doc) notFound();
  // First paint from the server; the Sync SDK keeps it live after that (D-17).
  return <BoothScreen slug={slug.data} initialDoc={doc} initialSlides={await boothSlides(getServices().sync, slug.data)} />;
}

export default function BoothPage(props: PageProps<"/booth/[slug]">) {
  return (
    // Non-semantic fallback (no <main>): React swaps it out once the screen streams in.
    <Suspense fallback={<div className="h-screen w-screen bg-ink" aria-hidden />}>
      <Booth params={props.params} />
    </Suspense>
  );
}
