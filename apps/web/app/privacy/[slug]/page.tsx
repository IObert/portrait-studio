import type { Metadata } from "next";
import { Suspense } from "react";
import { catalogs } from "@/i18n";
import type { Catalog } from "@/i18n";
import { getEventRepo } from "@/lib/admin/context";
import { SlugSchema } from "@/lib/sync/names";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Privacy notice (SPEC §10.6). Public. Content is a TODO for the organizer. */
async function Notice({ params }: { params: Promise<{ slug: string }> }) {
  const slug = SlugSchema.safeParse((await params).slug);
  const event = slug.success ? await (await getEventRepo()).get(slug.data) : null;
  // Draft events are not public (SPEC §4.1).
  if (!event || event.state === "draft") return <p className="text-zinc-600">{catalogs.en.privacy.notFound}</p>;
  const c: Catalog = catalogs[event.config.language];
  const p = c.privacy;
  const todo = <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">TODO</p>;

  return (
    <article lang={event.config.language === "pt_BR" ? "pt-BR" : "en"} className="space-y-6">
      <h1 className="text-2xl font-semibold">{p.title({ eventName: event.config.name })}</h1>
      <p className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">{p.todoBanner}</p>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{p.sections.controller}</h2>
        {todo}
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{p.sections.data}</h2>
        {todo}
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{p.sections.purposes}</h2>
        {todo}
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{p.sections.processors}</h2>
        <p>{p.knownFacts.processors}</p>
        {todo}
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{p.sections.retention}</h2>
        <p>{p.knownFacts.retention}</p>
        {todo}
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{p.sections.rights}</h2>
        <p>{p.knownFacts.deletion}</p>
        {todo}
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{p.sections.contact}</h2>
        {todo}
      </section>
    </article>
  );
}

export default function PrivacyPage(props: PageProps<"/privacy/[slug]">) {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Suspense fallback={null}>
        <Notice params={props.params} />
      </Suspense>
    </main>
  );
}
