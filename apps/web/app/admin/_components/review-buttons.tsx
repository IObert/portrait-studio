"use client";

import { useActionState } from "react";
import { reviewAction, type ReviewState } from "@/lib/admin/review-actions";
import { btn } from "./ui";

type Action = "approve" | "discard" | "remove" | "print_remove" | "reprint";

const STYLE: Record<Action, string> = {
  approve: "bg-go text-white hover:bg-[#0b6a40]",
  discard: btn.secondary,
  remove: `${btn.quiet} text-danger hover:text-danger`,
  print_remove: btn.secondary,
  reprint: btn.secondary,
};

/** Buttons for one review card. */
export function ReviewButtons({ slug, jobId, actions }: { slug: string; jobId: string; actions: { action: Action; label: string }[] }) {
  const [state, run, pending] = useActionState<ReviewState, FormData>(reviewAction, {});
  return (
    <form action={run} className="space-y-2">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="jobId" value={jobId} />
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <button
            key={a.action}
            name="action"
            value={a.action}
            disabled={pending}
            className={`${btn.base} ${STYLE[a.action]} py-1.5`}
            onClick={(e) => {
              // Irreversible: confirm first.
              if (a.action === "remove" && !confirm("Remove this portrait? It disappears from the booth screen, the share link stops working and the files are deleted. This cannot be undone.")) e.preventDefault();
            }}
          >
            {a.label}
          </button>
        ))}
      </div>
      {state.message && (
        <p role="status" className={`text-sm ${state.ok ? "text-go" : "text-danger"}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}
