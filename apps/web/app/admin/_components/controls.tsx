"use client";

import { startTransition, useActionState, useId, useRef, useState } from "react";
import {
  type ActionState,
  deleteEventAction,
  removeAssetAction,
  rotatePrinterTokenAction,
  setStateAction,
  uploadAssetAction,
} from "@/lib/admin/actions";
import type { EventState } from "@/lib/events/schema";
import { btn, field } from "./ui";

function Status({ state }: { state: ActionState }) {
  const msg = state.message ?? Object.values(state.errors ?? {})[0];
  if (!msg) return null;
  return (
    <p className={`text-sm ${state.ok ? "text-go" : "text-danger"}`} role="status">
      {msg}
    </p>
  );
}

const PauseIcon = (
  <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
    <rect x="5" y="4" width="3.5" height="12" rx="1" />
    <rect x="11.5" y="4" width="3.5" height="12" rx="1" />
  </svg>
);
const StopIcon = (
  <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
    <rect x="4.5" y="4.5" width="11" height="11" rx="1.5" />
  </svg>
);

/** `label` is the accessible name; buttons with an icon show only the icon, with the label as tooltip. */
const STATE_BUTTONS: { to: EventState; label: string; from: EventState[]; cls: string; icon?: React.ReactNode; hint?: string }[] = [
  { to: "live", label: "Go live", from: ["draft", "break", "ended"], cls: "bg-go text-white hover:bg-[#0b6a40]" },
  { to: "break", label: "Break", hint: "Take a break: attendees hear you'll be right back", from: ["live"], cls: `${btn.secondary} px-2.5`, icon: PauseIcon },
  { to: "ended", label: "End", hint: "End the event", from: ["live", "break"], cls: `${btn.secondary} px-2.5 hover:text-danger`, icon: StopIcon },
  { to: "draft", label: "Back to draft", from: ["live", "break", "ended"], cls: btn.quiet },
];

export function StateControls({ slug, state: current }: { slug: string; state: EventState }) {
  const [state, action, pending] = useActionState(setStateAction, {});
  return (
    <form action={action} className="flex flex-wrap items-center justify-end gap-2">
      <input type="hidden" name="slug" value={slug} />
      <Status state={state} />
      {/* Back to draft is the rare one: last and quiet. */}
      {STATE_BUTTONS.filter((b) => b.from.includes(current)).map((b) => (
        <button
          key={b.to}
          name="state"
          value={b.to}
          disabled={pending}
          aria-label={b.icon ? b.label : undefined}
          title={b.hint}
          className={`${btn.base} ${b.cls}`}
        >
          {b.icon ?? b.label}
        </button>
      ))}
    </form>
  );
}

/** Builds the FormData an action expects; these widgets sit inside the settings form, so they cannot nest a <form>. */
function send(dispatch: (f: FormData) => void, fields: Record<string, string | Blob>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  startTransition(() => dispatch(fd));
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
  const file = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState(false);
  const title = kind === "frame" ? "Custom frame" : "Custom background";
  return (
    <div className="flex gap-4 rounded-lg border border-line p-3">
      <div className="flex aspect-2/3 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[repeating-conic-gradient(#e1e3ea_0_25%,#fff_0_50%)] bg-size-[12px_12px]">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived SAS URL, not optimizable
          <img src={previewUrl} alt={`Uploaded ${kind}`} className="h-full w-full object-contain" />
        ) : (
          <span className="text-xs text-slate">none</span>
        )}
      </div>
      <div className="min-w-0 space-y-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-xs leading-relaxed text-slate">{requirements}</p>
        <div className="flex flex-wrap items-center gap-2">
          {/* No name: never submitted with the settings form. */}
          <input
            ref={file}
            type="file"
            accept={kind === "frame" ? "image/png" : "image/png,image/jpeg"}
            aria-label={`${title} file`}
            onChange={(e) => setPicked(!!e.target.files?.length)}
            className="max-w-full text-xs text-slate file:mr-2 file:rounded-md file:border file:border-line file:bg-white file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-ink hover:file:bg-mist"
          />
          <button
            type="button"
            disabled={uploading || !picked}
            onClick={() => {
              const f = file.current?.files?.[0];
              if (f) send(upload, { slug, kind, file: f });
            }}
            className={`${btn.base} ${btn.secondary} px-2.5 py-1 text-xs`}
          >
            {uploading ? "Uploading…" : "Upload"}
          </button>
          {previewUrl && (
            <button type="button" disabled={removing} onClick={() => send(remove, { slug, kind })} className="px-1 text-xs font-medium text-danger hover:underline">
              Remove
            </button>
          )}
        </div>
        <Status state={upState} />
        <Status state={rmState} />
      </div>
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
      className={`${btn.base} ${btn.secondary} shrink-0 px-2.5 py-1 text-xs`}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** One copyable value: what to type on the printer laptop. */
function Credential({ label, value, testId, mono = true }: { label: string; value: string; testId?: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <dt className="w-16 shrink-0 text-sm text-slate">{label}</dt>
      <dd className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-mist/60 py-1.5 pr-1.5 pl-3">
        <span className={`min-w-0 flex-1 truncate select-all ${mono ? "font-mono text-sm tracking-wide" : "text-sm"}`} data-testid={testId}>
          {value}
        </span>
        <CopyButton text={value} label={label.toLowerCase()} />
      </dd>
    </div>
  );
}

/**
 * The print agent's credentials (D-33): one short token per event, kept visible here,
 * because the agent runs on a laptop next to the printer and someone types it in there.
 */
export function PrinterToken({ slug, appUrl, token: saved }: { slug: string; appUrl: string; token: string | null }) {
  const [state, action, pending] = useActionState(rotatePrinterTokenAction, {});
  const token = state.token ?? saved;
  // Simulator by default: it works with no printer attached (SPEC §11.2).
  const command = token ? `node agent.mjs --url ${appUrl} --token ${token} --simulate --out ./prints` : null;
  const rotate = (
    <button
      type="button"
      disabled={pending}
      className={`${btn.base} ${token ? btn.quiet : btn.secondary}`}
      onClick={() => {
        if (token && !confirm("Rotate the printer token? The running print agent stops until it is restarted with the new token.")) return;
        send(action, { slug });
      }}
    >
      {pending ? "Generating…" : token ? "Rotate token" : "Generate token"}
    </button>
  );
  return (
    <div className="space-y-4">
      {token && command ? (
        <>
          <dl className="space-y-2">
            <Credential label="Server" value={appUrl} />
            <Credential label="Token" value={token} testId="agent-token" />
          </dl>
          <details className="group rounded-lg border border-line">
            <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium marker:hidden">
              <span className="inline-block transition-transform group-open:rotate-90" aria-hidden>
                ›
              </span>{" "}
              Full command
            </summary>
            <div className="space-y-2 border-t border-line p-3">
              <div className="flex items-start gap-2">
                <pre className="min-w-0 flex-1 overflow-x-auto rounded-md bg-ink p-3 text-xs text-white" data-testid="agent-command">
                  {command}
                </pre>
                <CopyButton text={command} label="command" />
              </div>
              <p className="text-xs leading-relaxed text-slate">
                With a real printer, replace <code>--simulate --out ./prints</code> with <code>--printer &lt;CUPS queue&gt;</code> (see <code>lpstat -p</code>). Run <code>node agent.mjs doctor --fix</code> first to set up the DS620 queue. Needs Node.js 24+.
              </p>
            </div>
          </details>
          <div className="flex flex-wrap items-center gap-3">
            {rotate}
            <span className="text-xs text-slate">Typing is forgiving: case, dashes and O/0 don&rsquo;t matter.</span>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {rotate}
          <span className="text-sm text-slate">No token yet. The print agent needs one to connect.</span>
        </div>
      )}
      <Status state={{ ...state, message: state.token ? undefined : state.message }} />
    </div>
  );
}

/** Row action on the event list: opens a dialog that asks for the event name (SPEC §4.4, D-35). */
export function DeleteEvent({ slug, name }: { slug: string; name: string }) {
  const [state, action, pending] = useActionState(deleteEventAction, {});
  const [typed, setTyped] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const inputId = useId();
  return (
    <>
      <button type="button" onClick={() => dialog.current?.showModal()} aria-label="Delete" title={`Delete ${name}`} className={`${btn.base} ${btn.quiet} px-2 py-1.5 hover:text-danger`}>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4" aria-hidden>
          <path d="M4 6h12M8 6V4h4v2M6 6l.7 10h6.6L14 6M8.5 9v4.5M11.5 9v4.5" />
        </svg>
      </button>
      <dialog
        ref={dialog}
        onClose={() => setTyped("")}
        aria-label={`Delete ${name}`}
        className="m-auto w-full max-w-md rounded-xl p-0 text-left text-ink shadow-2xl backdrop:bg-ink/50"
      >
        <form action={action} className="space-y-4 p-6">
          <input type="hidden" name="slug" value={slug} />
          <h2 className="font-display text-xl font-semibold tracking-tight">Delete {name}?</h2>
          <p className="text-sm leading-relaxed text-slate">
            Deletes the event and all its data immediately: sessions, jobs, leads, stats, the print queue, every selfie and
            generated image, and the uploaded frame and background. This cannot be undone.
          </p>
          <div>
            <label className={field.label} htmlFor={inputId}>
              Type <strong className="font-semibold">{name}</strong> to confirm
            </label>
            <input id={inputId} name="confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className={field.input} />
          </div>
          <Status state={state} />
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => dialog.current?.close()} className={`${btn.base} ${btn.secondary}`}>
              Cancel
            </button>
            <button disabled={pending || typed.trim() !== name.trim()} className={`${btn.base} ${btn.danger}`}>
              {pending ? "Deleting…" : "Delete event"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
