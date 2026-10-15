"use client";

import { useActionState } from "react";
import { sharePrintAction, type SharePrintState } from "@/lib/share/print-action";

interface Props {
  shareId: string;
  left: number;
  /** A print is queued or printing: no second tap. */
  pending: boolean;
  /** Plain strings only: the catalog's functions cannot cross to the client. */
  labels: { print: string; printing: string; printPending: string };
}

/** Print at the booth from the share page (D-26): uses one of the owner's prints, never adds it to the screen. */
export function PrintButton({ shareId, left, pending: onItsWay, labels }: Props) {
  const [state, action, pending] = useActionState<SharePrintState, FormData>(sharePrintAction, {});
  // Just sent, or still on its way from before: the button returns once it has printed (reload).
  const done = onItsWay || state.ok;
  const btn = "w-full rounded-full px-6 py-3.5 text-base font-semibold focus-visible:outline-white";
  return (
    <form action={action} className="flex w-full flex-col gap-2">
      <input type="hidden" name="shareId" value={shareId} />
      {done ? (
        <p className={`${btn} border border-white/20 text-center text-white/70`} data-testid="share-print-done">
          {labels.printPending}
        </p>
      ) : (
        <button type="submit" disabled={pending || left < 1} className={`${btn} bg-signal text-white transition-colors hover:bg-[#d61b31] disabled:opacity-50`} data-testid="share-print">
          {pending ? labels.printing : labels.print}
        </button>
      )}
      {state.message && (
        <p role="status" className="text-center text-sm text-white/80">
          {state.message}
        </p>
      )}
    </form>
  );
}
