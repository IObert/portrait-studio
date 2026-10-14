import { z } from "zod";
import { STYLE_IDS } from "../prompts/styles";
import { SlugSchema } from "../sync/names";

// Event configuration (SPEC §4.2), stored in the global `events` map by slug.

export const EVENT_STATES = ["draft", "live", "break", "ended"] as const;
export type EventState = (typeof EVENT_STATES)[number];

export const LOCALES = ["en", "pt_BR"] as const;
export type Locale = (typeof LOCALES)[number];

/** Fixed backgrounds (SPEC §8.2, PROMPTS.md §C). `uploaded` is the event's own image. */
export const FIXED_BACKGROUNDS = ["gradient", "solid-white", "solid-black", "original"] as const;
export const BACKGROUND_IDS = [...FIXED_BACKGROUNDS, "uploaded"] as const;
export type BackgroundId = (typeof BACKGROUND_IDS)[number];

/** Fixed frames shipped in apps/web/assets/frames (SPEC §8.3). */
export const FIXED_FRAMES = [
  "none",
  "twilio-tab-bottom",
  "twilio-tab-bottom-left",
  "twilio-tab-top",
  "twilio-border-left",
  "twilio-border-right",
] as const;
export const FRAME_IDS = [...FIXED_FRAMES, "uploaded"] as const;
export type FrameId = (typeof FRAME_IDS)[number];

const text = (max: number) => z.string().trim().max(max);

export const UploadedAssetSchema = z.object({
  blobPath: z.string().min(1),
  contentType: z.enum(["image/png", "image/jpeg"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  uploadedAt: z.iso.datetime(),
});

const E164 = z.string().regex(/^\+[1-9]\d{6,14}$/, "E.164, e.g. +13203780782");

/** The admin-editable fields. Upload metadata and the token hash are managed separately. */
export const EventConfigInputSchema = z
  .object({
    name: text(80).min(1),
    language: z.enum(LOCALES),
    leadChannel: z.enum(["whatsapp", "sms"]),
    qrSender: E164,
    styles: z.array(z.enum(STYLE_IDS)).min(1, "Enable at least one style"),
    backgrounds: z.array(z.enum(BACKGROUND_IDS)).min(1, "Enable at least one background"),
    /** Localized display name of the uploaded background (SPEC §8.2). */
    uploadedBackgroundName: text(40).default(""),
    frame: z.enum(FRAME_IDS),
    leadCollection: z.boolean(),
    /**
     * Verification email extras (D-20), only used with lead collection on:
     * a promo code shown in the email, and whether to show the Verify code snippet.
     */
    emailPromoCode: text(40).default(""),
    emailShowSnippet: z.boolean().default(false),
    maxImagesPerPerson: z.number().int().min(1).max(20),
    printingEnabled: z.boolean(),
    maxPrintsPerPerson: z.number().int().min(0).max(20),
    promo: z.object({ enabled: z.boolean(), text: text(600) }),
    shareText: text(280),
    ctaText: z.object({ headline: text(80), steps: z.array(text(120)).max(5) }),
  })
  .superRefine((e, ctx) => {
    if (e.promo.enabled && !e.printingEnabled)
      ctx.addIssue({ code: "custom", path: ["promo", "enabled"], message: "Promo needs printing to be on (SPEC §5.9)" });
    if (e.promo.enabled && !e.promo.text)
      ctx.addIssue({ code: "custom", path: ["promo", "text"], message: "Promo text is required when promo is on" });
    if (!e.leadCollection && (e.emailPromoCode || e.emailShowSnippet))
      ctx.addIssue({ code: "custom", path: ["emailPromoCode"], message: "Email extras need lead collection to be on" });
    if (e.backgrounds.includes("uploaded") && !e.uploadedBackgroundName)
      ctx.addIssue({ code: "custom", path: ["uploadedBackgroundName"], message: "Name the uploaded background" });
  });
export type EventConfigInput = z.infer<typeof EventConfigInputSchema>;

/** The stored event item. Must stay well under Sync's 16 KiB item limit. */
export const EventSchema = z.object({
  slug: SlugSchema,
  state: z.enum(EVENT_STATES),
  config: EventConfigInputSchema,
  uploads: z.object({
    frame: UploadedAssetSchema.nullable(),
    background: UploadedAssetSchema.nullable(),
  }),
  /** SHA-256 of the printer token; the token itself is shown once and never stored (SPEC §4.2). */
  printerTokenHash: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  printerTokenCreatedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type PortraitEvent = z.infer<typeof EventSchema>;

/**
 * Checks that are only knowable with upload state: an event cannot use the
 * uploaded frame/background until one exists. Returns field → message.
 */
export function crossCheckUploads(config: EventConfigInput, uploads: PortraitEvent["uploads"]): Record<string, string> {
  const errors: Record<string, string> = {};
  if (config.frame === "uploaded" && !uploads.frame) errors.frame = "Upload a frame before selecting it";
  if (config.backgrounds.includes("uploaded") && !uploads.background)
    errors.backgrounds = "Upload a background before enabling it";
  return errors;
}

/** Defaults for a new event: everything enabled, safe limits, printing off. */
export function defaultConfig(name: string, qrSender: string): EventConfigInput {
  return {
    name,
    language: "en",
    leadChannel: "whatsapp",
    qrSender,
    styles: [...STYLE_IDS],
    backgrounds: [...FIXED_BACKGROUNDS],
    uploadedBackgroundName: "",
    frame: "none",
    leadCollection: true,
    emailPromoCode: "",
    emailShowSnippet: false,
    maxImagesPerPerson: 3,
    printingEnabled: false,
    maxPrintsPerPerson: 1,
    promo: { enabled: false, text: "" },
    shareText: "",
    ctaText: { headline: "", steps: [] },
  };
}
