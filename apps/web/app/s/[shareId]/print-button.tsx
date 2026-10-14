"use client";

import { useActionState } from "react";
import { sharePrintAction, type SharePrintState } from "@/lib/share/print-action";

interface Props {
  shareId: string;
  left: number;
  already: boolean;
  /** Plain strings only: the catalog's functions cannot cross to the client. */
  labels: { print: string; printing: string; printDone: string };
}

/** Print at the booth from the share page (D-26): uses one of the owner's prints, never adds it to the screen. */
export function PrintButton({ shareId, left, already, labels }: Props) {
  const [state, action, pending] = useActionState<SharePrintState, FormData>(sharePrintAction, {});
  const done = already || state.ok;
  const btn = "w-full rounded-full px-6 py-3 text-base font-semibold";
  return (
    <form action={action} className="flex w-full flex-col gap-2">
      <input type="hidden" name="shareId" value={shareId} />
      {done ? (
        <p className={`${btn} border border-white/20 text-center text-white/70`} data-testid="share-print-done">
          {labels.printDone}
        </p>
      ) : (
        <button type="submit" disabled={pending || left < 1} className={`${btn} bg-[#EF223A] text-white disabled:opacity-50`} data-testid="share-print">
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
