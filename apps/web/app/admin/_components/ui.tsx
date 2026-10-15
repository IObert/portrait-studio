// Shared admin building blocks. Server-safe: no hooks.

/** Brand mark: a tilted red print, the same object the booth screen piles up. */
export function Mark({ className = "h-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 30" aria-hidden className={className}>
      <rect x="3" y="2" width="18" height="26" rx="2" fill="#EF223A" transform="rotate(-8 12 15)" />
      <rect x="6.2" y="5.6" width="11.6" height="13.6" rx="1" fill="#fff" opacity="0.92" transform="rotate(-8 12 15)" />
    </svg>
  );
}

export const btn = {
  base: "inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
  primary: "bg-signal font-semibold text-white hover:bg-signal-2",
  secondary: "border border-line bg-white text-ink hover:border-slate/40 hover:bg-mist",
  danger: "bg-danger text-white hover:bg-[#9a0f24]",
  quiet: "text-slate hover:bg-mist hover:text-ink",
};

export const field = {
  input:
    "mt-1.5 block w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-slate/60 focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/15 disabled:bg-mist disabled:text-slate",
  label: "block text-sm font-medium text-ink",
  hint: "mt-1.5 text-xs leading-relaxed text-slate",
};

/** A card with a heading row; the main grouping device on admin pages. */
export function Panel({
  id,
  title,
  description,
  aside,
  children,
}: {
  id?: string;
  title: string;
  description?: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className="scroll-mt-24 rounded-xl border border-line bg-white">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-6 py-4">
        <div className="max-w-prose">
          <h2 id={id ? `${id}-title` : undefined} className="text-base font-semibold">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm text-slate">{description}</p>}
        </div>
        {aside}
      </header>
      <div className="space-y-6 px-6 py-5">{children}</div>
    </section>
  );
}

export function Notice({ tone = "ok", children }: { tone?: "ok" | "warn"; children: React.ReactNode }) {
  const cls = tone === "ok" ? "border-go/20 bg-go/5 text-go" : "border-pause/25 bg-pause/5 text-pause";
  return (
    <p role="status" className={`rounded-lg border px-4 py-2.5 text-sm ${cls}`}>
      {children}
    </p>
  );
}

/** Empty states invite the next step instead of just reporting nothing. */
export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-white/60 px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-slate">{children}</div>}
    </div>
  );
}

/** Settings sections, in the order people reach for them. Also the in-page nav. */
export const SECTIONS = [
  { id: "event", title: "Event" },
  { id: "booth", title: "Booth screen and QR code" },
  { id: "portraits", title: "Portraits" },
  { id: "printing", title: "Printing" },
  { id: "leads", title: "Lead collection" },
] as const;
export type SectionId = (typeof SECTIONS)[number]["id"];

/** An undeveloped print: the 404 illustration (app-wide and per event). */
export function EmptyPrint({ onDark = false }: { onDark?: boolean }) {
  return (
    <div className="relative h-56 w-40" aria-hidden>
      <div className={`absolute inset-0 rotate-6 rounded-xl ${onDark ? "bg-white/10" : "bg-line"}`} />
      <div className="absolute inset-0 -rotate-3 rounded-xl bg-white p-3 pb-12 shadow-2xl ring-1 ring-line/60">
        <div className="flex h-full items-center justify-center rounded-md bg-[repeating-linear-gradient(135deg,#e1e3ea_0_6px,#f3f4f7_6px_12px)]">
          <span className="font-display text-5xl font-semibold text-ink/25">404</span>
        </div>
        <div className="absolute bottom-4 left-3 h-2 w-16 rounded-full bg-signal" />
      </div>
    </div>
  );
}
