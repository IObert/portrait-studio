"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { BlobPaths } from "../blob/paths";
import { generatePrinterToken } from "../auth/printer-token";
import { deleteEvent } from "../events/delete";
import { EventNotFound, InvalidTransition, SlugTaken } from "../events/repo";
import {
  BACKGROUND_IDS,
  crossCheckUploads,
  EventConfigInputSchema,
  FRAME_IDS,
  LOCALES,
  type EventConfigInput,
} from "../events/schema";
import { validateBackground, validateFrame } from "../images/validate-upload";
import { log } from "../log";
import { getServices } from "../services";
import { SlugSchema } from "../sync/names";
import { STYLE_IDS } from "../prompts/styles";
import { requireAdmin } from "./guard";
import { deleteHooks, getEventRepo } from "./context";

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

/** Admin name typed with an action, logged for accountability (SPEC §10.3). */
const ActorSchema = z.string().trim().max(60).optional();

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
      styles: form.getAll("styles").map(String).filter((v) => (STYLE_IDS as readonly string[]).includes(v)) as EventConfigInput["styles"],
      backgrounds: form.getAll("backgrounds").map(String).filter((v) => (BACKGROUND_IDS as readonly string[]).includes(v)) as EventConfigInput["backgrounds"],
      uploadedBackgroundName: str("uploadedBackgroundName"),
      frame: pick(str("frame"), FRAME_IDS, "none"),
      leadCollection: bool("leadCollection"),
      maxImagesPerPerson: num("maxImagesPerPerson"),
      printingEnabled: bool("printingEnabled"),
      maxPrintsPerPerson: num("maxPrintsPerPerson"),
      promo: { enabled: bool("promoEnabled"), text: str("promoText") },
      shareText: str("shareText"),
      ctaText: { headline: str("ctaHeadline"), steps: form.getAll("ctaStep").map(String) },
    },
  };
}

/** Parses the shared event form. Checkbox groups arrive as repeated fields. */
function parseConfig(form: FormData): EventConfigInput {
  const bool = (k: string) => form.get(k) === "on" || form.get(k) === "true";
  const num = (k: string) => Number(form.get(k) ?? Number.NaN);
  const list = <T extends readonly string[]>(k: string, allowed: T) =>
    form.getAll(k).map(String).filter((v): v is T[number] => (allowed as readonly string[]).includes(v));
  return EventConfigInputSchema.parse({
    name: String(form.get("name") ?? ""),
    language: z.enum(LOCALES).parse(form.get("language")),
    leadChannel: z.enum(["whatsapp", "sms"]).parse(form.get("leadChannel")),
    qrSender: String(form.get("qrSender") ?? "").trim(),
    styles: list("styles", STYLE_IDS),
    backgrounds: list("backgrounds", BACKGROUND_IDS),
    uploadedBackgroundName: String(form.get("uploadedBackgroundName") ?? ""),
    frame: z.enum(FRAME_IDS).parse(form.get("frame")),
    leadCollection: bool("leadCollection"),
    maxImagesPerPerson: num("maxImagesPerPerson"),
    printingEnabled: bool("printingEnabled"),
    maxPrintsPerPerson: num("maxPrintsPerPerson"),
    promo: { enabled: bool("promoEnabled"), text: String(form.get("promoText") ?? "") },
    shareText: String(form.get("shareText") ?? ""),
    ctaText: {
      headline: String(form.get("ctaHeadline") ?? ""),
      steps: form.getAll("ctaStep").map(String).map((s) => s.trim()).filter(Boolean),
    },
  });
}

export async function createEventAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  let slug: string;
  try {
    slug = SlugSchema.parse(String(form.get("slug") ?? "").trim().toLowerCase());
    const config = parseConfig(form);
    const uploadErrors = crossCheckUploads(config, { frame: null, background: null });
    if (Object.keys(uploadErrors).length) return { errors: uploadErrors, values: echo(form) };
    const events = await getEventRepo();
    await events.create(slug, config);
    log.info({ event: "event_created", slug, actor: actorOf(form) }, "event created");
  } catch (err) {
    return { ...fail(err, "Could not create the event"), values: echo(form) };
  }
  revalidatePath("/admin/events");
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
    log.info({ event: "event_updated", slug, actor: actorOf(form) }, "event updated");
    revalidatePath(`/admin/events/${slug}`);
    revalidatePath("/admin/events");
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
    // TODO(milestone e): ending an event must also remove its bindings (SPEC §4.1).
    log.info({ event: "event_state_changed", slug, state: updated.state, actor: actorOf(form) }, "event state changed");
    revalidatePath(`/admin/events/${slug}`);
    revalidatePath("/admin/events");
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
    log.info({ event: "event_asset_uploaded", slug, kind, actor: actorOf(form) }, "event asset uploaded");
    revalidatePath(`/admin/events/${slug}`);
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
    log.info({ event: "event_asset_removed", slug, kind, actor: actorOf(form) }, "event asset removed");
    revalidatePath(`/admin/events/${slug}`);
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
    await events.setPrinterTokenHash(slug, hash);
    log.info({ event: "printer_token_rotated", slug, actor: actorOf(form) }, "printer token rotated");
    revalidatePath(`/admin/events/${slug}`);
    // Shown once; only the hash is stored.
    return { ok: true, token };
  } catch (err) {
    return fail(err, "Could not generate a token");
  }
}

export async function deleteEventAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  try {
    const slug = SlugSchema.parse(form.get("slug"));
    // Destructive: the admin must type the slug to confirm (SPEC §4.4).
    if (String(form.get("confirm") ?? "").trim() !== slug)
      return { errors: { confirm: "Type the event code exactly to confirm" } };
    const events = await getEventRepo();
    const { sync, blob } = getServices();
    // The audit line carries slug and timestamp only, no admin name (SPEC §4.4).
    await deleteEvent({ sync, blob, events, hooks: deleteHooks, audit: log }, slug);
  } catch (err) {
    return fail(err, "Could not delete the event");
  }
  revalidatePath("/admin/events");
  redirect("/admin/events?deleted=1");
}

function actorOf(form: FormData): string | undefined {
  return ActorSchema.parse(String(form.get("actor") ?? "").trim() || undefined);
}
