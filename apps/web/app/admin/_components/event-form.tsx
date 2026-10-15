"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/admin/actions";
import { DEFAULT_COPY, type EventConfigInput } from "@/lib/events/schema";
import type { StyleId } from "@/lib/prompts/styles";
import { btn, field, Panel, SECTIONS, type SectionId } from "./ui";

export interface Option {
  id: string;
  label: string;
  disabled?: boolean;
  hint?: string;
}

interface Props {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  config: EventConfigInput;
  /** Present when editing: the slug is fixed after creation (SPEC §4.2). */
  slug?: string;
  styles: Option[];
  backgrounds: Option[];
  frames: Option[];
  /** Messaging Service senders; empty if the lookup failed (falls back to free entry). */
  senders: { e164: string; sms: boolean; whatsapp: boolean }[];
  submitLabel: string;
  /** Edit page only: widgets with their own actions, shown inside the section they belong to. */
  slots?: { uploads: React.ReactNode; printAgent: React.ReactNode };
  /** Thumbnail for the "your own frame" tile, once one is uploaded. */
  framePreview?: string | null;
}

const title = (id: SectionId) => SECTIONS.find((s) => s.id === id)!.title;

function FieldError({ state, name }: { state: ActionState; name: string }) {
  const msg = state.errors?.[name];
  return msg ? (
    <p className="mt-1.5 text-sm text-danger" role="alert">
      {msg}
    </p>
  ) : null;
}

/** An on/off setting that reveals its dependent options while on. */
function Toggle({ name, label, description, defaultChecked, children }: { name: string; label: string; description?: string; defaultChecked: boolean; children?: React.ReactNode }) {
  const [on, setOn] = useState(defaultChecked);
  return (
    <div className="space-y-5">
      <label className="flex cursor-pointer items-start justify-between gap-6">
        <span>
          <span className="block text-sm font-medium">{label}</span>
          {description && <span className="mt-0.5 block text-sm text-slate">{description}</span>}
        </span>
        <input type="checkbox" name={name} defaultChecked={defaultChecked} onChange={(e) => setOn(e.target.checked)} className="switch mt-0.5" />
      </label>
      {/* Hidden, not unmounted: values survive switching off and on, and still save. */}
      {children && (
        <div hidden={!on} className="space-y-5 border-l-2 border-line pl-5">
          {children}
        </div>
      )}
    </div>
  );
}

/** Checkbox chips for a multi-select (styles, backgrounds). */
function Chips({ name, options, selected }: { name: string; options: Option[]; selected: readonly string[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {options.map((o) => (
        <label
          key={o.id}
          title={o.hint}
          className={`relative inline-flex cursor-pointer items-center gap-2 rounded-full border border-line bg-white py-1.5 pr-3.5 pl-2.5 text-sm transition-colors has-checked:border-signal has-checked:bg-signal/8 has-checked:text-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-signal has-disabled:cursor-not-allowed has-disabled:text-slate/60 ${o.disabled ? "" : "hover:border-slate/40"}`}
        >
          <input type="checkbox" name={name} value={o.id} disabled={o.disabled} defaultChecked={selected.includes(o.id)} className="peer absolute inset-0 cursor-pointer appearance-none rounded-full opacity-0 disabled:cursor-not-allowed" />
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 opacity-30 peer-checked:text-signal peer-checked:opacity-100" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M3.5 8.5l3 3 6-7" />
          </svg>
          {o.label}
          {o.hint && <span className="text-xs">({o.hint})</span>}
        </label>
      ))}
    </div>
  );
}

/** A selectable thumbnail: the real input covers the tile, so it stays a checkbox/radio to forms, keyboards and tests. */
function Tile({ type, name, value, label, defaultChecked, disabled, hint, children }: { type: "checkbox" | "radio"; name: string; value: string; label: string; defaultChecked: boolean; disabled?: boolean; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="group relative flex w-24 cursor-pointer flex-col gap-1.5 has-disabled:cursor-not-allowed">
      <input type={type} name={name} value={value} disabled={disabled} defaultChecked={defaultChecked} aria-label={label} className="peer absolute inset-0 z-10 cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed" />
      <span className="relative block aspect-2/3 overflow-hidden rounded-lg ring-1 ring-line transition group-hover:ring-slate/40 peer-checked:ring-2 peer-checked:ring-signal peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-signal peer-disabled:opacity-60">
        {children}
      </span>
      <span className="pointer-events-none absolute top-1.5 right-1.5 hidden h-5 w-5 items-center justify-center rounded-full bg-signal text-white shadow peer-checked:flex" aria-hidden>
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M3.5 8.5l3 3 6-7" />
        </svg>
      </span>
      <span className="text-xs leading-tight font-medium" aria-hidden>
        {label}
      </span>
      {hint && <span className="-mt-1 text-[11px] leading-snug text-slate">{hint}</span>}
    </label>
  );
}

/** Frames as thumbnails; the last tile is the event's own upload, empty until one exists. */
function FramePicker({ frames, selected, uploadedPreview }: { frames: Option[]; selected: string; uploadedPreview?: string | null }) {
  return (
    <div className="mt-2 flex flex-wrap gap-3">
      {frames.map((f) =>
        f.id === "uploaded" ? (
          <Tile key={f.id} type="radio" name="frame" value={f.id} label="Your own" defaultChecked={selected === f.id} disabled={f.disabled} hint={uploadedPreview ? undefined : "PNG, 1200×1800, transparent window"}>
            {uploadedPreview ? (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived SAS URL
              <img src={uploadedPreview} alt="" className="h-full w-full bg-[repeating-conic-gradient(#e1e3ea_0_25%,#fff_0_50%)] bg-size-[10px_10px] object-cover" />
            ) : (
              <span className="flex h-full w-full flex-col items-center justify-center gap-1 border-2 border-dashed border-line bg-white text-slate">
                <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                  <path d="M10 13V4M6.5 7.5L10 4l3.5 3.5M4 13v3h12v-3" />
                </svg>
                <span className="text-[10px] font-medium">Upload below</span>
              </span>
            )}
          </Tile>
        ) : (
          <Tile key={f.id} type="radio" name="frame" value={f.id} label={f.label} defaultChecked={selected === f.id}>
            {/* eslint-disable-next-line @next/next/no-img-element -- tiny static preview */}
            <img src={`/previews/frames/${f.id}.webp`} alt="" className="h-full w-full object-cover" loading="lazy" />
          </Tile>
        ),
      )}
    </div>
  );
}

const EVENT_HINT = "{event} is replaced by the event name.";

/** Switching language swaps in that language's suggested texts, unless the admin has written their own. */
function swapDefaultCopy(form: HTMLFormElement | null, locale: string) {
  const copy = DEFAULT_COPY[locale as keyof typeof DEFAULT_COPY];
  if (!form || !copy) return;
  const all = Object.values(DEFAULT_COPY);
  for (const [name, key] of [["shareText", "shareText"], ["promoText", "promo"]] as const) {
    const el = form.elements.namedItem(name) as HTMLTextAreaElement | null;
    if (el && (el.value === "" || all.some((c) => c[key] === el.value))) el.value = copy[key];
  }
}

const LANGUAGE_HINT = "Messages, the booth screen and the share page use this language.";

export function EventForm({ action, config: initial, slug, styles, backgrounds, frames, senders, submitLabel, slots, framePreview }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  // React resets uncontrolled fields after an action; re-render from the echoed values
  // (a new key remounts the form so defaultValue applies again).
  const config = state.values?.config ?? initial;
  const filled = config.ctaText.steps.filter(Boolean);
  const steps = [...filled, "", "", ""].slice(0, Math.min(5, Math.max(3, filled.length + 1)));
  const afterCreate = (what: string) => <p className={field.hint}>{what} can be added once the event is created.</p>;

  return (
    <form key={JSON.stringify(state.values ?? null)} action={formAction} className="min-w-0 space-y-6">
      <Panel id="event" title={title("event")}>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className={field.label} htmlFor="name">Name</label>
            <input id="name" name="name" defaultValue={config.name} required maxLength={80} className={field.input} />
            <FieldError state={state} name="name" />
          </div>
          {slug && <input type="hidden" name="slug" value={slug} />}
          <div>
            <label className={field.label} htmlFor="language">Language</label>
            <select id="language" name="language" defaultValue={config.language} onChange={(e) => swapDefaultCopy(e.currentTarget.form, e.currentTarget.value)} className={field.input}>
              <option value="en">English</option>
              <option value="pt_BR">Português (Brasil)</option>
            </select>
            <p className={field.hint}>{LANGUAGE_HINT}</p>
          </div>
        </div>
      </Panel>

      <Panel id="booth" title={title("booth")} description="What attendees see on the booth screen, and where the QR code takes them.">
        <div className="space-y-3">
          <div>
            <label className={field.label} htmlFor="ctaHeadline">Headline</label>
            <input id="ctaHeadline" name="ctaHeadline" defaultValue={config.ctaText.headline} maxLength={80} className={field.input} placeholder={config.name || "Get your portrait"} />
            <p className={field.hint}>Empty shows the event name.</p>
          </div>
          <fieldset>
            <legend className={field.label}>Steps</legend>
            <ol className="mt-1.5 space-y-2">
              {steps.map((s, i) => (
                <li key={i} className="flex items-center gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-mist text-xs font-semibold text-slate" aria-hidden>
                    {i + 1}
                  </span>
                  <input name="ctaStep" defaultValue={s} maxLength={120} className={`${field.input} mt-0`} placeholder={["Scan the code", "Send a selfie", "Pick a style"][i] ?? "Another step"} aria-label={`Step ${i + 1}`} />
                </li>
              ))}
            </ol>
            <p className={`${field.hint} pl-9`}>Empty steps are left out. Save to get room for another, up to five.</p>
          </fieldset>
        </div>
        <div className="grid gap-5 border-t border-line pt-5 sm:grid-cols-2">
          <div>
            <label className={field.label} htmlFor="leadChannel">QR code channel</label>
            <select id="leadChannel" name="leadChannel" defaultValue={config.leadChannel} className={field.input}>
              <option value="whatsapp">WhatsApp</option>
              <option value="sms">SMS</option>
            </select>
          </div>
          <div>
            <label className={field.label} htmlFor="qrSender">QR sender number</label>
            {senders.length > 0 ? (
              <select id="qrSender" name="qrSender" defaultValue={config.qrSender || senders[0]!.e164} className={`${field.input} font-mono`}>
                {senders.map((s) => (
                  <option key={s.e164} value={s.e164}>
                    {s.e164} ({[s.whatsapp && "WhatsApp", s.sms && "SMS"].filter(Boolean).join(" + ") || "no messaging"})
                  </option>
                ))}
              </select>
            ) : (
              <>
                <input id="qrSender" name="qrSender" defaultValue={config.qrSender} required placeholder="+13203780782" className={`${field.input} font-mono`} />
                <p className={`${field.hint} text-pause`}>Could not load the Messaging Service senders; enter the number by hand.</p>
              </>
            )}
            <FieldError state={state} name="qrSender" />
          </div>
        </div>
      </Panel>

      <Panel id="portraits" title={title("portraits")} description="The choices attendees get, and what every portrait looks like.">
        <fieldset>
          <legend className={field.label}>Styles</legend>
          <div className="mt-2 flex flex-wrap gap-3">
            {styles.map((o) => (
              <Tile key={o.id} type="checkbox" name="styles" value={o.id} label={o.label} defaultChecked={config.styles.includes(o.id as StyleId)}>
                {/* Real output from scripts/style-previews.ts: production prompt and model. */}
                {/* eslint-disable-next-line @next/next/no-img-element -- tiny static preview */}
                <img src={`/previews/styles/${o.id}.webp`} alt="" className="h-full w-full object-cover" loading="lazy" />
              </Tile>
            ))}
          </div>
          <p className={field.hint}>With only one style on, attendees skip the style menu.</p>
          <FieldError state={state} name="styles" />
        </fieldset>
        <fieldset>
          <legend className={field.label}>Backgrounds</legend>
          <Chips name="backgrounds" options={backgrounds} selected={config.backgrounds} />
          <FieldError state={state} name="backgrounds" />
          <div className="mt-4 max-w-sm">
            <label className={field.label} htmlFor="uploadedBackgroundName">Name of the custom background</label>
            <input id="uploadedBackgroundName" name="uploadedBackgroundName" defaultValue={config.uploadedBackgroundName} maxLength={40} className={field.input} placeholder="e.g. Conference hall" />
            <p className={field.hint}>Shown in the attendee&rsquo;s menu, in the event language.</p>
            <FieldError state={state} name="uploadedBackgroundName" />
          </div>
        </fieldset>
        <div>
          <fieldset>
            <legend className={field.label}>Frame</legend>
            <FramePicker frames={frames} selected={config.frame} uploadedPreview={framePreview} />
          </fieldset>
          <FieldError state={state} name="frame" />
        </div>
        {slots ? slots.uploads : afterCreate("A custom frame and background")}
        <div className="grid gap-5 border-t border-line pt-5 sm:grid-cols-2">
          <div>
            <label className={field.label} htmlFor="maxImagesPerPerson">Portraits per person</label>
            <input id="maxImagesPerPerson" name="maxImagesPerPerson" type="number" min={1} max={20} defaultValue={config.maxImagesPerPerson} className={`${field.input} max-w-28`} />
            <p className={field.hint}>Digital portraits each attendee can make.</p>
            <FieldError state={state} name="maxImagesPerPerson" />
          </div>
          <div>
            <label className={field.label} htmlFor="shareText">Share caption</label>
            <textarea id="shareText" name="shareText" defaultValue={config.shareText} rows={3} maxLength={280} className={field.input} placeholder="Suggested caption on the share page, in the event language" />
            <p className={field.hint}>{EVENT_HINT}</p>
          </div>
        </div>
      </Panel>

      <Panel id="printing" title={title("printing")} description="Physical prints from the booth printer, and the promo sent after one.">
        <Toggle name="printingEnabled" label="Printing enabled" description="Attendees can ask for a print of their portraits." defaultChecked={config.printingEnabled}>
          <div>
            <label className={field.label} htmlFor="maxPrintsPerPerson">Prints per person</label>
            <input id="maxPrintsPerPerson" name="maxPrintsPerPerson" type="number" min={0} max={20} defaultValue={config.maxPrintsPerPerson} className={`${field.input} max-w-28`} />
            <p className={field.hint}>Attendees pick which of their portraits to print.</p>
            <FieldError state={state} name="maxPrintsPerPerson" />
          </div>
          <Toggle name="promoEnabled" label="Send promo (needs printing)" description="A message sent after a successful print." defaultChecked={config.promo.enabled}>
            <div>
              <textarea name="promoText" defaultValue={config.promo.text} rows={3} maxLength={600} className={`${field.input} mt-0`} placeholder="Promo text, in the event language" aria-label="Promo text" />
              <p className={field.hint}>{EVENT_HINT}</p>
              <FieldError state={state} name="promo.text" />
            </div>
          </Toggle>
          <FieldError state={state} name="promo.enabled" />
        </Toggle>
        <div className="border-t border-line pt-5">
          <h3 className="text-sm font-medium">Print agent</h3>
          <p className="mt-0.5 mb-3 text-sm text-slate">Runs on the laptop next to the printer and pulls print jobs from here.</p>
          {slots ? slots.printAgent : afterCreate("The printer token")}
        </div>
      </Panel>

      <Panel id="leads" title={title("leads")}>
        <Toggle name="leadCollection" label="Collect leads" description="Ask for a name and a verified email before the first portrait." defaultChecked={config.leadCollection}>
          <div>
            <label className={field.label} htmlFor="emailPromoCode">Promo code in the verification email</label>
            <input id="emailPromoCode" name="emailPromoCode" defaultValue={config.emailPromoCode} maxLength={40} placeholder="e.g. wearedevs-25" className={`${field.input} max-w-sm font-mono`} />
            <p className={field.hint}>Leave empty for no promo code.</p>
            <FieldError state={state} name="emailPromoCode" />
          </div>
          <label className="flex cursor-pointer items-center gap-2.5 text-sm">
            <input type="checkbox" name="emailShowSnippet" defaultChecked={config.emailShowSnippet} className="h-4 w-4 rounded accent-signal" />
            Show the &ldquo;sent with one line of code&rdquo; snippet in the email
          </label>
        </Toggle>
      </Panel>

      {/* Save stays in reach on a long page. */}
      <div className="sticky bottom-0 z-20 -mx-2 flex items-center gap-4 rounded-t-xl border border-b-0 border-line bg-white/95 px-5 py-3 shadow-[0_-4px_16px_rgb(18_28_45/0.06)] backdrop-blur">
        <button type="submit" disabled={pending} className={`${btn.base} ${btn.primary} min-w-24`}>
          {pending ? "Saving…" : submitLabel}
        </button>
        {state.message && (
          <p className={`text-sm ${state.ok ? "text-go" : "text-danger"}`} role="status">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
