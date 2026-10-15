"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/admin/actions";
import type { EventConfigInput } from "@/lib/events/schema";

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
}

function FieldError({ state, name }: { state: ActionState; name: string }) {
  const msg = state.errors?.[name];
  return msg ? (
    <p className="mt-1 text-sm text-red-700" role="alert">
      {msg}
    </p>
  ) : null;
}

const input = "mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none";
const label = "block text-sm font-medium text-zinc-800";

export function EventForm({ action, config: initial, slug, styles, backgrounds, frames, senders, submitLabel }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  // React resets uncontrolled fields after an action; re-render from the echoed values
  // (a new key remounts the form so defaultValue applies again).
  const config = state.values?.config ?? initial;
  const typedSlug = slug ? undefined : state.values?.slug;
  const steps = [...config.ctaText.steps.filter(Boolean), "", "", ""].slice(0, Math.max(3, config.ctaText.steps.filter(Boolean).length + 1));

  return (
    <form key={JSON.stringify(state.values ?? null)} action={formAction} className="space-y-8">
      <section className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="name">Name</label>
          <input id="name" name="name" defaultValue={config.name} required maxLength={80} className={input} />
          <FieldError state={state} name="name" />
        </div>
        <div>
          <label className={label} htmlFor="slug">Event code</label>
          {slug ? (
            <>
              <input type="hidden" name="slug" value={slug} />
              <input id="slug" value={slug} readOnly disabled className={`${input} bg-zinc-100 font-mono`} />
              <p className="mt-1 text-xs text-zinc-500">Cannot be changed after creation.</p>
            </>
          ) : (
            <>
              <input id="slug" name="slug" defaultValue={typedSlug} required maxLength={40} pattern="[a-z0-9](?:[a-z0-9-]*[a-z0-9])?" placeholder="sp-london" className={`${input} font-mono`} />
              <p className="mt-1 text-xs text-zinc-500">Lowercase letters, digits and dashes. Used in the QR text and URLs.</p>
            </>
          )}
          <FieldError state={state} name="slug" />
        </div>
        <div>
          <label className={label} htmlFor="language">Language</label>
          <select id="language" name="language" defaultValue={config.language} className={input}>
            <option value="en">English</option>
            <option value="pt_BR">Português (Brasil)</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="leadChannel">QR code channel</label>
          <select id="leadChannel" name="leadChannel" defaultValue={config.leadChannel} className={input}>
            <option value="whatsapp">WhatsApp</option>
            <option value="sms">SMS</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="qrSender">QR sender number</label>
          {senders.length > 0 ? (
            <select id="qrSender" name="qrSender" defaultValue={config.qrSender || senders[0]!.e164} className={`${input} font-mono`}>
              {senders.map((s) => (
                <option key={s.e164} value={s.e164}>
                  {s.e164} ({[s.whatsapp && "WhatsApp", s.sms && "SMS"].filter(Boolean).join(" + ") || "no messaging"})
                </option>
              ))}
            </select>
          ) : (
            <>
              <input id="qrSender" name="qrSender" defaultValue={config.qrSender} required placeholder="+13203780782" className={`${input} font-mono`} />
              <p className="mt-1 text-xs text-amber-700">Could not load the Messaging Service senders; enter the number by hand.</p>
            </>
          )}
          <FieldError state={state} name="qrSender" />
        </div>
      </section>

      <fieldset className="space-y-2">
        <legend className={label}>Styles</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {styles.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="styles" value={s.id} defaultChecked={config.styles.includes(s.id as never)} />
              {s.label}
            </label>
          ))}
        </div>
        <p className="text-xs text-zinc-500">With only one style enabled, attendees skip the style menu.</p>
        <FieldError state={state} name="styles" />
      </fieldset>

      <fieldset className="space-y-2">
        <legend className={label}>Backgrounds</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {backgrounds.map((b) => (
            <label key={b.id} className={`flex items-center gap-2 text-sm ${b.disabled ? "text-zinc-400" : ""}`}>
              <input type="checkbox" name="backgrounds" value={b.id} disabled={b.disabled} defaultChecked={config.backgrounds.includes(b.id as never)} />
              {b.label}
              {b.hint && <span className="text-xs text-zinc-400">({b.hint})</span>}
            </label>
          ))}
        </div>
        <div className="max-w-sm">
          <label className="block text-sm text-zinc-700" htmlFor="uploadedBackgroundName">Name of the uploaded background, in the event language</label>
          <input id="uploadedBackgroundName" name="uploadedBackgroundName" defaultValue={config.uploadedBackgroundName} maxLength={40} className={input} />
          <FieldError state={state} name="uploadedBackgroundName" />
        </div>
        <FieldError state={state} name="backgrounds" />
      </fieldset>

      <div className="max-w-sm">
        <label className={label} htmlFor="frame">Frame</label>
        <select id="frame" name="frame" defaultValue={config.frame} className={input}>
          {frames.map((f) => (
            <option key={f.id} value={f.id} disabled={f.disabled}>
              {f.label}
              {f.hint ? ` (${f.hint})` : ""}
            </option>
          ))}
        </select>
        <FieldError state={state} name="frame" />
      </div>

      <section className="grid gap-4 sm:grid-cols-2">
        <fieldset className="space-y-2 sm:col-span-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="leadCollection" defaultChecked={config.leadCollection} />
            Collect leads (name, verified email)
          </label>
          <div className="ml-6 grid gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 sm:grid-cols-2">
            <p className="text-xs text-zinc-500 sm:col-span-2">Verification email extras (only with lead collection on):</p>
            <div>
              <label className="block text-sm text-zinc-700" htmlFor="emailPromoCode">Promo code in the email</label>
              <input id="emailPromoCode" name="emailPromoCode" defaultValue={config.emailPromoCode} maxLength={40} placeholder="e.g. wearedevs-25 (empty = no promo)" className={`${input} font-mono`} />
              <FieldError state={state} name="emailPromoCode" />
            </div>
            <label className="flex items-center gap-2 self-end text-sm">
              <input type="checkbox" name="emailShowSnippet" defaultChecked={config.emailShowSnippet} />
              Show the &ldquo;sent with one line of code&rdquo; snippet
            </label>
          </div>
        </fieldset>
        <div>
          <label className={label} htmlFor="maxImagesPerPerson">Free portraits per person (digital)</label>
          <input id="maxImagesPerPerson" name="maxImagesPerPerson" type="number" min={1} max={20} defaultValue={config.maxImagesPerPerson} className={input} />
          <FieldError state={state} name="maxImagesPerPerson" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="printingEnabled" defaultChecked={config.printingEnabled} />
          Printing enabled
        </label>
        <div>
          <label className={label} htmlFor="maxPrintsPerPerson">Prints per person (attendees pick which portraits)</label>
          <input id="maxPrintsPerPerson" name="maxPrintsPerPerson" type="number" min={0} max={20} defaultValue={config.maxPrintsPerPerson} className={input} />
          <FieldError state={state} name="maxPrintsPerPerson" />
        </div>
      </section>

      <fieldset className="space-y-2">
        <legend className={label}>Promo after a successful print</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="promoEnabled" defaultChecked={config.promo.enabled} />
          Send promo (needs printing)
        </label>
        <FieldError state={state} name="promo.enabled" />
        <textarea name="promoText" defaultValue={config.promo.text} rows={3} maxLength={600} className={input} placeholder="Promo text, in the event language" />
        <FieldError state={state} name="promo.text" />
      </fieldset>

      <div>
        <label className={label} htmlFor="shareText">Share caption</label>
        <textarea id="shareText" name="shareText" defaultValue={config.shareText} rows={2} maxLength={280} className={input} placeholder="Suggested caption on the share page, in the event language" />
      </div>

      <fieldset className="space-y-2">
        <legend className={label}>Booth screen</legend>
        <input name="ctaHeadline" defaultValue={config.ctaText.headline} maxLength={80} className={input} placeholder="Headline" aria-label="Headline" />
        {steps.map((s, i) => (
          <input key={i} name="ctaStep" defaultValue={s} maxLength={120} className={input} placeholder={`Step ${i + 1}`} aria-label={`Step ${i + 1}`} />
        ))}
      </fieldset>

      <div className="flex items-center gap-4 border-t border-zinc-200 pt-6">
        <button type="submit" disabled={pending} className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50">
          {pending ? "Saving…" : submitLabel}
        </button>
        {state.message && (
          <p className={`text-sm ${state.ok ? "text-green-700" : "text-red-700"}`} role="status">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
