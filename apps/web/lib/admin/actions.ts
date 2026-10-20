"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { BlobPaths } from "../blob/paths";
import { generatePrinterToken } from "../auth/printer-token";
import { deleteEvent } from "../events/delete";
import { eventIdCandidate, eventIdFromName } from "../events/event-id";
import { EventNotFound, InvalidTransition, SlugTaken } from "../events/repo";
import {
  BACKGROUND_IDS,
  crossCheckUploads,
  FRAME_IDS,
  LOCALES,
  type EventConfigInput,
} from "../events/schema";
import { validateBackground, validateFrame } from "../images/validate-upload";
import { log } from "../log";
import { getServices } from "../services";
import { SlugSchema } from "../sync/names";
import { STYLE_IDS } from "../prompts/styles";
import { parseConfig } from "./parse-config";
import { requireAdmin } from "./guard";
import { revalidateEvent } from "./revalidate";
import { getDeleteHooks, getEventRepo } from "./context";


export interface ActionState {
  ok?: boolean;
  /** Field path → message, for inline display. */
  errors?: Record<string, string>;
  message?: string;
  /** Printer token, returned once right after it is generated (SPEC §4.2). */
  token?: string;
  /**
   * The submitted values, echoed back on error. React resets uncontrolled forms
   * after an action, so the form re-renders from these to keep the admin's input.
   */
  values?: { config: EventConfigInput; slug: string };
}

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of err.issues) out[i.path.join(".") || "form"] = i.message;
  return out;
}

function fail(err: unknown, fallback = "Something went wrong"): ActionState {
  if (err instanceof SlugTaken) return { errors: { slug: err.message } };
  if (err instanceof InvalidTransition) return { message: err.message };
  if (err instanceof EventNotFound) return { message: "That event no longer exists" };
  if (err instanceof z.ZodError) return { errors: fieldErrors(err) };
  log.error({ err: err instanceof Error ? err.message : String(err) }, "admin action failed");
  return { message: fallback };
}

/** The form as submitted, unvalidated, for re-filling the form after an error. */
function echo(form: FormData): ActionState["values"] {
  const str = (k: string) => String(form.get(k) ?? "");
  const num = (k: string) => Number(form.get(k) ?? 0) || 0;
  const bool = (k: string) => form.get(k) === "on";
  const pick = <T extends readonly string[]>(v: string, allowed: T, d: T[number]) =>
    ((allowed as readonly string[]).includes(v) ? v : d) as T[number];
  return {
    slug: str("slug"),
    config: {
      name: str("name"),
      language: pick(str("language"), LOCALES, "en"),
      leadChannel: pick(str("leadChannel"), ["whatsapp", "sms"] as const, "whatsapp"),
      qrSender: str("qrSender"),
      qrText: str("qrText"),
      styles: form.getAll("styles").map(String).filter((v) => (STYLE_IDS as readonly string[]).includes(v)) as EventConfigInput["styles"],
      backgrounds: form.getAll("backgrounds").map(String).filter((v) => (BACKGROUND_IDS as readonly string[]).includes(v)) as EventConfigInput["backgrounds"],
      uploadedBackgroundName: str("uploadedBackgroundName"),
      frame: pick(str("frame"), FRAME_IDS, "none"),
      laKings: bool("laKings"),
      leadCollection: bool("leadCollection"),
      emailPromoCode: str("emailPromoCode"),
      emailShowSnippet: bool("emailShowSnippet"),
      maxImagesPerPerson: num("maxImagesPerPerson"),
      printingEnabled: bool("printingEnabled"),
      maxPrintsPerPerson: num("maxPrintsPerPerson"),
      promo: { enabled: bool("promoEnabled"), text: str("promoText") },
      shareText: str("shareText"),
      ctaText: { headline: str("ctaHeadline"), steps: form.getAll("ctaStep").map(String) },
    },
  };
}

export async function createEventAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  let slug = "";
  try {
    const config = parseConfig(form);
    const uploadErrors = crossCheckUploads(config, { frame: null, background: null });
    if (Object.keys(uploadErrors).length) return { errors: uploadErrors, values: echo(form) };
    const events = await getEventRepo();
    // The ID comes from the name and is never shown (D-35); a taken one gets -2, -3, …
    const base = eventIdFromName(config.name);
    for (let n = 1; !slug; n++) {
      if (n > 50) throw new Error("Too many events with this name");
      try {
        await events.create(eventIdCandidate(base, n), config);
        slug = eventIdCandidate(base, n);
      } catch (err) {
        if (!(err instanceof SlugTaken)) throw err;
      }
    }
    log.info({ event: "event_created", slug }, "event created");
  } catch (err) {
    return { ...fail(err, "Could not create the event"), values: echo(form) };
  }
  revalidatePath("/admin");
  redirect(`/admin/events/${slug}`);
}

export async function updateEventAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  try {
    const slug = SlugSchema.parse(form.get("slug"));
    const config = parseConfig(form);
    const events = await getEventRepo();
    const current = await events.require(slug);
    const uploadErrors = crossCheckUploads(config, current.uploads);
    if (Object.keys(uploadErrors).length) return { errors: uploadErrors, values: echo(form) };
    await events.updateConfig(slug, config);
    log.info({ event: "event_updated", slug }, "event updated");
    revalidateEvent(slug);
    revalidatePath("/admin");
    return { ok: true, message: "Saved", values: { slug, config } };
  } catch (err) {
    return { ...fail(err, "Could not save the event"), values: echo(form) };
  }
}

export async function setStateAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  try {
    const slug = SlugSchema.parse(form.get("slug"));
    const to = z.enum(["draft", "live", "break", "ended"]).parse(form.get("state"));
    const events = await getEventRepo();
    const updated = await events.setState(slug, to);
    log.info({ event: "event_state_changed", slug, state: updated.state }, "event state changed");
    revalidateEvent(slug);
    revalidatePath("/admin");
    return { ok: true, message: `Event is now ${updated.state}` };
  } catch (err) {
    return fail(err, "Could not change the event state");
  }
}

export async function uploadAssetAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  try {
    const slug = SlugSchema.parse(form.get("slug"));
    const kind = z.enum(["frame", "background"]).parse(form.get("kind"));
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return { errors: { file: "Choose a file" } };
    if (file.size > MAX_UPLOAD_BYTES) return { errors: { file: "File is larger than 20 MB" } };

    const input = Buffer.from(await file.arrayBuffer());
    const checked = kind === "frame" ? await validateFrame(input) : await validateBackground(input);
    if (!checked.ok) return { errors: { file: checked.error } };

    const events = await getEventRepo();
    await events.require(slug);
    const { blob } = getServices();
    const path =
      kind === "frame"
        ? BlobPaths.frame(slug)
        : BlobPaths.background(slug, checked.contentType === "image/png" ? "png" : "jpg");
    await blob.put(path, checked.data, checked.contentType);
    // Replacing a JPEG background with a PNG (or the reverse) leaves the old file behind.
    if (kind === "background") {
      const other = BlobPaths.background(slug, checked.contentType === "image/png" ? "jpg" : "png");
      await blob.delete(other);
    }
    await events.setUpload(slug, kind, {
      blobPath: path,
      contentType: checked.contentType,
      width: checked.width,
      height: checked.height,
      uploadedAt: new Date().toISOString(),
    });
    log.info({ event: "event_asset_uploaded", slug, kind }, "event asset uploaded");
    revalidateEvent(slug);
    return { ok: true, message: `${kind === "frame" ? "Frame" : "Background"} uploaded` };
  } catch (err) {
    return fail(err, "Could not upload the file");
  }
}

export async function removeAssetAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  try {
    const slug = SlugSchema.parse(form.get("slug"));
    const kind = z.enum(["frame", "background"]).parse(form.get("kind"));
    const events = await getEventRepo();
    const event = await events.require(slug);
    const asset = event.uploads[kind];
    // Removing an asset the config still selects would leave the event unusable.
    if (kind === "frame" && event.config.frame === "uploaded")
      return { message: "Select a different frame before removing this one" };
    if (kind === "background" && event.config.backgrounds.includes("uploaded"))
      return { message: "Disable the uploaded background before removing it" };
    if (asset) await getServices().blob.delete(asset.blobPath);
    await events.setUpload(slug, kind, null);
    log.info({ event: "event_asset_removed", slug, kind }, "event asset removed");
    revalidateEvent(slug);
    return { ok: true, message: "Removed" };
  } catch (err) {
    return fail(err, "Could not remove the file");
  }
}

export async function rotatePrinterTokenAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  try {
    const slug = SlugSchema.parse(form.get("slug"));
    const events = await getEventRepo();
    await events.require(slug);
    const { token, hash } = generatePrinterToken(slug);
    await events.setPrinterToken(slug, token, hash);
    log.info({ event: "printer_token_rotated", slug }, "printer token rotated");
    revalidateEvent(slug);
    return { ok: true, token };
  } catch (err) {
    return fail(err, "Could not generate a token");
  }
}

export async function deleteEventAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  try {
    const slug = SlugSchema.parse(form.get("slug"));
    const events = await getEventRepo();
    // Destructive: the admin must type the event's name to confirm (SPEC §4.4, D-35).
    const event = await events.require(slug);
    if (String(form.get("confirm") ?? "").trim() !== event.config.name.trim())
      return { errors: { confirm: "Type the event name exactly to confirm" } };
    const { sync, blob } = getServices();
    // The audit line carries slug and timestamp only (SPEC §4.4).
    await deleteEvent({ sync, blob, events, hooks: getDeleteHooks(), audit: log }, slug);
  } catch (err) {
    return fail(err, "Could not delete the event");
  }
  revalidatePath("/admin");
  redirect("/admin?deleted=1");
}
