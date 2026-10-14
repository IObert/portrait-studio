"use client";

import { useActionState, useState } from "react";
import {
  type ActionState,
  deleteEventAction,
  removeAssetAction,
  rotatePrinterTokenAction,
  setStateAction,
  uploadAssetAction,
} from "@/lib/admin/actions";
import type { EventState } from "@/lib/events/schema";

const btn = "rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50";

function Status({ state }: { state: ActionState }) {
  const msg = state.message ?? Object.values(state.errors ?? {})[0];
  if (!msg) return null;
  return (
    <p className={`text-sm ${state.ok ? "text-green-700" : "text-red-700"}`} role="status">
      {msg}
    </p>
  );
}

const STATE_BUTTONS: { to: EventState; label: string; from: EventState[]; cls: string }[] = [
  { to: "live", label: "Go live", from: ["draft", "break", "ended"], cls: "bg-green-700 text-white hover:bg-green-600" },
  { to: "break", label: "Break", from: ["live"], cls: "bg-amber-500 text-white hover:bg-amber-400" },
  { to: "ended", label: "End", from: ["live", "break"], cls: "bg-red-700 text-white hover:bg-red-600" },
  { to: "draft", label: "Back to draft", from: ["live", "break", "ended"], cls: "bg-zinc-200 text-zinc-800 hover:bg-zinc-300" },
];

export function StateControls({ slug, state: current }: { slug: string; state: EventState }) {
  const [state, action, pending] = useActionState(setStateAction, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="slug" value={slug} />
      {STATE_BUTTONS.filter((b) => b.from.includes(current)).map((b) => (
        <button key={b.to} name="state" value={b.to} disabled={pending} className={`${btn} ${b.cls}`}>
          {b.label}
        </button>
      ))}
      <Status state={state} />
    </form>
  );
}

export function AssetUpload({
  slug,
  kind,
  previewUrl,
  requirements,
}: {
  slug: string;
  kind: "frame" | "background";
  previewUrl: string | null;
  requirements: string;
}) {
  const [upState, upload, uploading] = useActionState(uploadAssetAction, {});
  const [rmState, remove, removing] = useActionState(removeAssetAction, {});
  return (
    <div className="flex gap-4 rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex h-36 w-24 shrink-0 items-center justify-center overflow-hidden rounded bg-[repeating-conic-gradient(#e4e4e7_0_25%,#fff_0_50%)] bg-[length:16px_16px]">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived SAS URL, not optimizable
          <img src={previewUrl} alt={`Uploaded ${kind}`} className="h-full w-full object-contain" />
        ) : (
          <span className="text-xs text-zinc-500">none</span>
        )}
      </div>
      <div className="space-y-2">
        <h3 className="font-medium capitalize">{kind}</h3>
        <p className="text-xs text-zinc-500">{requirements}</p>
        <form action={upload} className="flex items-center gap-2">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="kind" value={kind} />
          <input type="file" name="file" accept={kind === "frame" ? "image/png" : "image/png,image/jpeg"} required className="text-sm" />
          <button disabled={uploading} className={`${btn} bg-zinc-900 text-white hover:bg-zinc-700`}>
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </form>
        {previewUrl && (
          <form action={remove}>
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="kind" value={kind} />
            <button disabled={removing} className="text-sm text-red-700 hover:underline">
              Remove
            </button>
          </form>
        )}
        <Status state={upState} />
        <Status state={rmState} />
      </div>
    </div>
  );
}

export function PrinterToken({ slug, appUrl, hasToken }: { slug: string; appUrl: string; hasToken: boolean }) {
  const [state, action, pending] = useActionState(rotatePrinterTokenAction, {});
  const [copied, setCopied] = useState(false);
  // Simulator by default: it works with no printer attached (SPEC §11.2).
  const command = state.token ? `node agent.mjs --url ${appUrl} --token ${state.token} --simulate --out ./prints` : null;
  return (
    <div className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4">
      <form action={action} className="flex items-center gap-3">
        <input type="hidden" name="slug" value={slug} />
        <button
          disabled={pending}
          className={`${btn} bg-zinc-900 text-white hover:bg-zinc-700`}
          onClick={(e) => {
            if (hasToken && !confirm("Rotate the printer token? The running print agent will stop working until restarted with the new token.")) e.preventDefault();
          }}
        >
          {hasToken ? "Rotate token" : "Generate token"}
        </button>
        <span className="text-sm text-zinc-500">{hasToken ? "A token is active." : "No token yet."}</span>
      </form>
      {command && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-amber-800">Copy this now. The token will not be shown again.</p>
          <pre className="overflow-x-auto rounded bg-zinc-900 p-3 text-xs text-zinc-100" data-testid="agent-command">{command}</pre>
          <div className="flex gap-3">
            <button
              type="button"
              className="text-sm text-blue-700 hover:underline"
              onClick={() => navigator.clipboard.writeText(command).then(() => setCopied(true))}
            >
              {copied ? "Copied" : "Copy command"}
            </button>
            <span className="text-xs text-zinc-500">
              With a real printer, replace <code>--simulate --out ./prints</code> with <code>--printer &lt;CUPS queue&gt;</code> (see <code>lpstat -p</code>). Needs Node.js 22+.
            </span>
          </div>
        </div>
      )}
      <Status state={{ ...state, message: state.token ? undefined : state.message }} />
    </div>
  );
}

export function DeleteEvent({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState(deleteEventAction, {});
  const [typed, setTyped] = useState("");
  return (
    <form action={action} className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4">
      <input type="hidden" name="slug" value={slug} />
      <p className="text-sm text-red-900">
        Deletes the event and all its data immediately: sessions, jobs, leads, stats, the print queue, every selfie and
        generated image, and the uploaded frame and background. This cannot be undone.
      </p>
      <label className="block text-sm text-red-900" htmlFor="confirm">
        Type <code className="font-mono font-semibold">{slug}</code> to confirm
      </label>
      <div className="flex items-center gap-3">
        <input id="confirm" name="confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className="w-64 rounded-md border border-red-300 px-3 py-1.5 font-mono text-sm" />
        <button disabled={pending || typed !== slug} className={`${btn} bg-red-700 text-white hover:bg-red-600`}>
          {pending ? "Deleting…" : "Delete event"}
        </button>
      </div>
      <Status state={state} />
    </form>
  );
}
