import type { EventState } from "@/lib/events/schema";

const STYLES: Record<EventState, string> = {
  draft: "bg-zinc-100 text-zinc-700",
  live: "bg-green-100 text-green-800",
  break: "bg-amber-100 text-amber-800",
  ended: "bg-red-100 text-red-800",
};

export function StateBadge({ state }: { state: EventState }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[state]}`} data-testid="state">
      {state}
    </span>
  );
}
