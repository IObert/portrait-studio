"use client";

import { useEffect, useRef, useState } from "react";
import { type ConnectionState, SyncClient, type SyncMapItem } from "twilio-sync";
import type { BoothDoc, BoothSlide } from "@/lib/booth/state";

const SLIDE_MS = 6_000;
const MAX_BACKOFF_MS = 30_000;

async function fetchToken(slug: string): Promise<string> {
  const res = await fetch(`/booth/${slug}/token`, { cache: "no-store" });
  if (!res.ok) throw new Error(`token ${res.status}`);
  return ((await res.json()) as { token: string }).token;
}

/**
 * Kiosk screen (SPEC §10.4). Changes are pushed by Twilio Sync over the client
 * SDK, with a read-only token scoped to this event (D-17). On a network drop it
 * keeps showing the last state; the SDK reconnects by itself.
 */
export function BoothScreen({ slug, initialDoc, initialSlides }: { slug: string; initialDoc: BoothDoc; initialSlides: BoothSlide[] }) {
  const [doc, setDoc] = useState(initialDoc);
  const [slides, setSlides] = useState(initialSlides);
  const [online, setOnline] = useState(true);
  const [slide, setSlide] = useState(0);
  const backoff = useRef(1_000);

  useEffect(() => {
    let client: SyncClient | null = null;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const upsert = (id: string, data: { url?: string; addedAt?: string }) => {
      if (!data.url) return;
      setSlides((prev) => [{ id, url: data.url!, addedAt: data.addedAt ?? new Date().toISOString() }, ...prev.filter((s) => s.id !== id)].sort((a, b) => b.addedAt.localeCompare(a.addedAt)));
    };

    const start = async () => {
      try {
        client = new SyncClient(await fetchToken(slug));
        client.on("connectionStateChanged", (state: ConnectionState) => setOnline(state === "connected"));
        client.on("tokenAboutToExpire", async () => {
          try {
            await client?.updateToken(await fetchToken(slug));
          } catch {
            /* the SDK raises tokenExpired next; that path restarts */
          }
        });
        client.on("tokenExpired", () => restart());

        // Read-only token: open existing objects only (creating needs write).
        const booth = await client.document({ id: `ev_${slug.replaceAll("-", "_")}_booth`, mode: "open_existing" });
        setDoc(booth.data as BoothDoc);
        booth.on("updated", (e: { data: BoothDoc }) => setDoc(e.data));

        const map = await client.map({ id: `ev_${slug.replaceAll("-", "_")}_slideshow`, mode: "open_existing" });
        const page = await map.getItems({ pageSize: 50 });
        const toSlide = (i: SyncMapItem): BoothSlide => {
          const d = i.data as { url?: string; addedAt?: string };
          return { id: i.key, url: d.url ?? "", addedAt: d.addedAt ?? "" };
        };
        setSlides(page.items.map(toSlide).filter((x: BoothSlide) => x.url).sort((a: BoothSlide, b: BoothSlide) => b.addedAt.localeCompare(a.addedAt)));
        map.on("itemAdded", (e: { item: { key: string; data: { url?: string; addedAt?: string } } }) => upsert(e.item.key, e.item.data));
        map.on("itemUpdated", (e: { item: { key: string; data: { url?: string; addedAt?: string } } }) => upsert(e.item.key, e.item.data));
        // A removed image disappears at once (SPEC §10.4).
        map.on("itemRemoved", (e: { key: string }) => setSlides((prev) => prev.filter((s) => s.id !== e.key)));

        setOnline(true);
        backoff.current = 1_000;
      } catch {
        restart();
      }
    };

    const restart = () => {
      setOnline(false);
      void client?.shutdown().catch(() => {});
      client = null;
      if (stopped) return;
      retry = setTimeout(() => void start(), backoff.current);
      backoff.current = Math.min(MAX_BACKOFF_MS, backoff.current * 2);
    };

    void start();
    return () => {
      stopped = true;
      clearTimeout(retry);
      void client?.shutdown().catch(() => {});
    };
  }, [slug]);

  // Auto-advance through the consented images.
  const shown = doc.state === "live" ? slides : [];
  useEffect(() => {
    if (shown.length < 2) return;
    const t = setInterval(() => setSlide((s) => (s + 1) % shown.length), SLIDE_MS);
    return () => clearInterval(t);
  }, [shown.length]);
  const current = shown.length ? shown[slide % shown.length] : null;

  return (
    <main lang={doc.locale === "pt_BR" ? "pt-BR" : "en"} className="relative flex h-screen w-screen overflow-hidden bg-zinc-950 text-white" data-state={doc.state}>
      {doc.state === "live" ? (
        // CTA + QR always keep the left 55%; the 2:3 slideshow fits the rest by height.
        <div className="flex h-full w-full gap-[4vw] p-[4vh]">
          <section className="flex w-[55%] shrink-0 flex-col justify-center gap-[4vh]">
            <h1 className="text-[5.5vh] font-bold leading-tight">{doc.cta.headline || doc.name}</h1>
            {doc.cta.steps.length > 0 && (
              <ol className="space-y-[2vh] text-[3vh]">
                {doc.cta.steps.map((s, i) => (
                  <li key={i} className="flex items-center gap-[1.5vw]">
                    <span className="flex h-[5vh] w-[5vh] shrink-0 items-center justify-center rounded-full bg-white text-[2.5vh] font-bold text-zinc-950">{i + 1}</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            )}
            <div className="flex items-center gap-[2vw]">
              <div className="aspect-square h-[30vh] shrink-0 rounded-2xl bg-white p-[1vh] [&>svg]:h-full [&>svg]:w-full" data-testid="qr" dangerouslySetInnerHTML={{ __html: doc.qrSvg }} />
              <p className="text-[3vh] font-semibold tracking-wide">{doc.number}</p>
            </div>
          </section>
          <section className="flex min-w-0 flex-1 items-center justify-center">
            {current ? (
              // eslint-disable-next-line @next/next/no-img-element -- signed, expiring URL
              <img key={current.id} src={current.url} alt="" data-testid="slide" className="max-h-full max-w-full rounded-2xl object-contain shadow-2xl" />
            ) : (
              <div className="aspect-[2/3] max-h-full w-full max-w-full rounded-2xl border-2 border-dashed border-white/20" />
            )}
          </section>
        </div>
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-6 p-12 text-center">
          <h1 className="text-6xl font-bold">{doc.name}</h1>
          <p className="text-4xl text-white/80" data-testid="status-message">
            {doc.state === "break" ? doc.messages.onBreak : doc.messages.ended}
          </p>
        </div>
      )}
      {!online && <span className="absolute bottom-4 right-4 h-3 w-3 rounded-full bg-amber-400" title="Reconnecting…" data-testid="offline" />}
    </main>
  );
}
