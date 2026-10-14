"use client";

import { useEffect, useRef, useState } from "react";
import type { BoothSlide } from "@/lib/booth/state";

const SLIDE_MS = 6_000;
/** Cards kept on the pile: the top one and two below it. */
const PILE = 3;
/** Resting tilt per card, so the pile looks hand-dropped. Cycles. */
const TILTS = [-3, 2.5, -1.5, 3, -2.5, 1.5];

interface Card {
  /** Unique per drop: the same portrait can land again on the next round. */
  key: number;
  slide: BoothSlide;
  tilt: number;
}

function preload(url: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = img.onerror = () => resolve();
    img.src = url;
    // decode() avoids a jank frame when the card first paints; ignore if unsupported.
    img.decode?.().then(resolve, resolve);
  });
}

/**
 * Booth slideshow as a pile of cards (user choice): every 6 s the next
 * portrait drops on top with a small tilt. It is only shown once its image
 * has loaded, so a slow network never shows an empty frame.
 */
export function SlideStack({ slides }: { slides: BoothSlide[] }) {
  const [cards, setCards] = useState<Card[]>([]);
  const next = useRef(0);
  const drops = useRef(0);
  // The timer loop reads the latest list (pushed live by Sync) without restarting.
  const slidesRef = useRef(slides);
  useEffect(() => {
    slidesRef.current = slides;
  }, [slides]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function drop() {
      const list = slidesRef.current;
      if (list.length === 0) {
        setCards([]);
        timer = setTimeout(drop, 1_000);
        return;
      }
      // Removed slides (admin takedown) leave the pile on the next drop.
      const ids = new Set(list.map((s) => s.id));
      const slide = list[next.current % list.length]!;
      next.current = (next.current + 1) % list.length;
      await preload(slide.url);
      if (cancelled) return;
      const n = drops.current++;
      setCards((pile) => {
        const kept = pile.filter((c) => ids.has(c.slide.id));
        // One portrait only: no point stacking copies of it.
        if (list.length === 1 && kept.some((c) => c.slide.id === slide.id)) return kept.slice(-1);
        return [...kept, { key: n, slide, tilt: TILTS[n % TILTS.length]! }].slice(-PILE);
      });
      if (list.length > 1) timer = setTimeout(drop, SLIDE_MS);
      else timer = setTimeout(drop, 1_000);
    }

    void drop();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  // A 2:3 box that fits the column on any screen: as tall as it can be, unless the column is too narrow
  // (portrait screens), then as wide as the column. Container units read the parent's size.
  // 94%: room for the tilted cards below the top one.
  const box = "aspect-[2/3] h-[min(94cqh,141cqw)]";
  return (
    <div className="flex h-full w-full items-center justify-center [container-type:size]">
      {cards.length === 0 ? (
        <div className={`${box} rounded-2xl border-2 border-dashed border-white/20`} />
      ) : (
        // Fixed box: cards stack inside it, so the layout never jumps.
        <div className={`relative ${box}`}>
          {cards.map((c, i) => {
            const top = i === cards.length - 1;
            return (
              // eslint-disable-next-line @next/next/no-img-element -- signed, expiring URL
              <img
                key={c.key}
                src={c.slide.url}
                alt=""
                data-testid={top ? "slide" : undefined}
                className={`booth-card absolute inset-0 h-full w-full rounded-2xl object-cover shadow-2xl ${top ? "booth-card-drop" : ""}`}
                style={{ "--tilt": `${top ? 0 : c.tilt}deg`, zIndex: i } as React.CSSProperties}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
