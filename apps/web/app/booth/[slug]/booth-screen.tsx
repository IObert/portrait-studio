"use client";

import { useEffect, useRef, useState } from "react";
import type { BoothState } from "@/lib/booth/state";

const SLIDE_MS = 6_000;
const MAX_BACKOFF_MS = 30_000;

/**
 * Kiosk screen (SPEC §10.4). Live updates over SSE; on a network drop it keeps
 * showing the last state and reconnects with exponential back-off.
 */
export function BoothScreen({ slug, initial }: { slug: string; initial: BoothState }) {
  const [state, setState] = useState(initial);
  const [online, setOnline] = useState(true);
  const [slide, setSlide] = useState(0);
  const backoff = useRef(1_000);

  useEffect(() => {
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const connect = () => {
      source = new EventSource(`/booth/${slug}/stream`);
      source.addEventListener("state", (e) => {
        setState(JSON.parse((e as MessageEvent<string>).data) as BoothState);
        setOnline(true);
        backoff.current = 1_000;
      });
      source.addEventListener("gone", () => {
        // Event deleted or back to draft: stop, keep the last screen.
        closed = true;
        source?.close();
      });
      source.onerror = () => {
        setOnline(false);
        source?.close();
        if (closed) return;
        timer = setTimeout(connect, backoff.current);
        backoff.current = Math.min(MAX_BACKOFF_MS, backoff.current * 2);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      source?.close();
    };
  }, [slug]);

  // Auto-advance; a removed image disappears at once because the list is replaced.
  const slides = state.state === "live" ? state.slides : [];
  useEffect(() => {
    if (slides.length < 2) return;
    const t = setInterval(() => setSlide((s) => (s + 1) % slides.length), SLIDE_MS);
    return () => clearInterval(t);
  }, [slides.length]);
  const current = slides.length ? slides[slide % slides.length] : null;

  return (
    <main lang={state.locale === "pt_BR" ? "pt-BR" : "en"} className="relative flex h-screen w-screen overflow-hidden bg-zinc-950 text-white" data-state={state.state}>
      {state.state === "live" ? (
        // CTA + QR always keep the left 55%; the 2:3 slideshow fits the rest by height.
        <div className="flex h-full w-full gap-[4vw] p-[4vh]">
          <section className="flex w-[55%] shrink-0 flex-col justify-center gap-[4vh]">
            <h1 className="text-[5.5vh] font-bold leading-tight">{state.cta.headline || state.name}</h1>
            {state.cta.steps.length > 0 && (
              <ol className="space-y-[2vh] text-[3vh]">
                {state.cta.steps.map((s, i) => (
                  <li key={i} className="flex items-center gap-[1.5vw]">
                    <span className="flex h-[5vh] w-[5vh] shrink-0 items-center justify-center rounded-full bg-white text-[2.5vh] font-bold text-zinc-950">{i + 1}</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            )}
            <div className="flex items-center gap-[2vw]">
              <div className="aspect-square h-[30vh] shrink-0 rounded-2xl bg-white p-[1vh] [&>svg]:h-full [&>svg]:w-full" data-testid="qr" dangerouslySetInnerHTML={{ __html: state.qrSvg }} />
              <p className="text-[3vh] font-semibold tracking-wide">{state.number}</p>
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
          <h1 className="text-6xl font-bold">{state.name}</h1>
          <p className="text-4xl text-white/80" data-testid="status-message">
            {state.state === "break" ? state.messages.onBreak : state.messages.ended}
          </p>
        </div>
      )}
      {!online && <span className="absolute bottom-4 right-4 h-3 w-3 rounded-full bg-amber-400" title="Reconnecting…" data-testid="offline" />}
    </main>
  );
}
