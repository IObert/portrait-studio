import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getEventRepo } from "@/lib/admin/context";
import { requireAdmin } from "@/lib/admin/guard";
import { buildBoothState } from "@/lib/booth/state";
import { SlugSchema } from "@/lib/sync/names";
import { BoothScreen } from "./booth-screen";

export const metadata = { title: "Booth", robots: { index: false, follow: false } };

async function Booth({ params }: { params: Promise<{ slug: string }> }) {
  await requireAdmin();
  const slug = SlugSchema.safeParse((await params).slug);
  if (!slug.success) notFound();
  const event = await (await getEventRepo()).get(slug.data);
  const initial = event ? await buildBoothState(event) : null;
  // Drafts are not shown (SPEC §4.1).
  if (!initial) notFound();
  return <BoothScreen slug={slug.data} initial={initial} />;
}

export default function BoothPage(props: PageProps<"/booth/[slug]">) {
  return (
    // Non-semantic fallback (no <main>): React swaps it out once the screen streams in.
    <Suspense fallback={<div className="h-screen w-screen bg-zinc-950" aria-hidden />}>
      <Booth params={props.params} />
    </Suspense>
  );
}
