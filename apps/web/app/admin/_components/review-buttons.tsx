"use client";

import { useActionState } from "react";
import { reviewAction, type ReviewState } from "@/lib/admin/review-actions";

type Action = "approve" | "discard" | "slideshow_remove" | "print_remove" | "reprint";

const STYLE: Record<Action, string> = {
  approve: "bg-green-700 text-white hover:bg-green-600",
  discard: "bg-zinc-200 text-zinc-800 hover:bg-zinc-300",
  slideshow_remove: "bg-zinc-200 text-zinc-800 hover:bg-zinc-300",
  print_remove: "bg-zinc-200 text-zinc-800 hover:bg-zinc-300",
  reprint: "bg-zinc-900 text-white hover:bg-zinc-700",
};

/** Buttons for one review card. The admin name field is shared via the form's `actor` input. */
export function ReviewButtons({ slug, jobId, actions }: { slug: string; jobId: string; actions: { action: Action; label: string }[] }) {
  const [state, run, pending] = useActionState<ReviewState, FormData>(reviewAction, {});
  return (
    <form action={run} className="space-y-2">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="jobId" value={jobId} />
      {actions.length > 0 && (
        <input name="actor" placeholder="Your name (optional, logged)" maxLength={60} className="w-full rounded border border-zinc-300 px-2 py-1 text-xs" />
      )}
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <button key={a.action} name="action" value={a.action} disabled={pending} className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${STYLE[a.action]}`}>
            {a.label}
          </button>
        ))}
      </div>
      {state.message && (
        <p role="status" className={`text-sm ${state.ok ? "text-green-700" : "text-red-700"}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}
