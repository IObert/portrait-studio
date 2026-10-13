import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { catalogs } from "@/i18n";
import { loadShare } from "@/lib/share/load";
import { ShareButtons } from "./share-buttons";

/** OpenGraph preview for a pasted link (SPEC §6.2). */
export async function generateMetadata(props: PageProps<"/s/[shareId]">): Promise<Metadata> {
  // Expiry depends on the current time: render at request time.
  await connection();
  const view = await loadShare((await props.params).shareId);
  const base: Metadata = { robots: { index: false, follow: false } };
  if ("gone" in view) return { ...base, title: catalogs[view.locale].share[view.gone === "removed" ? "removed" : "gone"] };
  const title = catalogs[view.event.config.language].share.title({ eventName: view.event.config.name });
  return {
    ...base,
    title,
    openGraph: { title, type: "website", images: [{ url: view.imageUrl, width: 1200, height: 1800 }] },
    twitter: { card: "summary_large_image", title, images: [view.imageUrl] },
  };
}

async function Share({ params }: { params: Promise<{ shareId: string }> }) {
  await connection();
  const view = await loadShare((await params).shareId);
  if ("gone" in view) {
    const c = catalogs[view.locale];
    return (
      <p className="text-center text-lg text-white/80" data-testid="share-gone">
        {view.gone === "removed" ? c.share.removed : c.share.gone}
      </p>
    );
  }
  const c = catalogs[view.event.config.language];
  return (
    <div lang={view.event.config.language === "pt_BR" ? "pt-BR" : "en"} className="flex w-full max-w-sm flex-col items-center gap-6">
      <h1 className="text-center text-xl font-semibold text-white">{c.share.title({ eventName: view.event.config.name })}</h1>
      {/* eslint-disable-next-line @next/next/no-img-element -- signed, expiring URL; not optimizable */}
      <img src={view.imageUrl} alt={c.share.title({ eventName: view.event.config.name })} width={1200} height={1800} className="w-full rounded-xl shadow-2xl" />
      <ShareButtons
        imageUrl={view.imageUrl}
        shareText={view.event.config.shareText}
        // Only plain strings cross to the client (the catalog also holds functions).
        labels={{ share: c.share.share, copyText: c.share.copyText, copied: c.share.copied, download: c.share.download }}
      />
    </div>
  );
}

export default function SharePage(props: PageProps<"/s/[shareId]">) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 py-10">
      <Suspense fallback={null}>
        <Share params={props.params} />
      </Suspense>
    </main>
  );
}
