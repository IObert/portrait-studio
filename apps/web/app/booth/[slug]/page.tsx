import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getEventRepo } from "@/lib/admin/context";
import { requireAdmin } from "@/lib/admin/guard";
import { boothDoc, boothSlides } from "@/lib/booth/state";
import { getServices } from "@/lib/services";
import { SlugSchema } from "@/lib/sync/names";
import { BoothScreen } from "./booth-screen";

export const metadata = { title: "Booth", robots: { index: false, follow: false } };

async function Booth({ params }: { params: Promise<{ slug: string }> }) {
  await requireAdmin();
  const slug = SlugSchema.safeParse((await params).slug);
  if (!slug.success) notFound();
  const event = await (await getEventRepo()).get(slug.data);
  // Drafts are not shown (SPEC §4.1).
  const doc = event ? await boothDoc(event) : null;
  if (!doc) notFound();
  // First paint from the server; the Sync SDK keeps it live after that (D-17).
  return <BoothScreen slug={slug.data} initialDoc={doc} initialSlides={await boothSlides(getServices().sync, slug.data)} />;
}

export default function BoothPage(props: PageProps<"/booth/[slug]">) {
  return (
    // Non-semantic fallback (no <main>): React swaps it out once the screen streams in.
    <Suspense fallback={<div className="h-screen w-screen bg-zinc-950" aria-hidden />}>
      <Booth params={props.params} />
    </Suspense>
  );
}
