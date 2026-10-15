import type { EventState } from "@/lib/events/schema";

const STYLES: Record<EventState, { pill: string; dot: string }> = {
  draft: { pill: "bg-mist text-slate ring-line", dot: "bg-slate/50" },
  live: { pill: "bg-go/8 text-go ring-go/20", dot: "live-dot bg-go" },
  break: { pill: "bg-pause/8 text-pause ring-pause/25", dot: "bg-pause" },
  ended: { pill: "bg-mist text-slate ring-line", dot: "bg-ink" },
};

export function StateBadge({ state }: { state: EventState }) {
  const s = STYLES[state];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${s.pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden />
      <span data-testid="state">{state}</span>
    </span>
  );
}
