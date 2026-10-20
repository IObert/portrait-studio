import { z } from "zod";
import { kingsBackgrounds } from "../events/kings";
import { BACKGROUND_IDS, EventConfigInputSchema, FRAME_IDS, LOCALES, type EventConfigInput } from "../events/schema";
import { STYLE_IDS } from "../prompts/styles";

/** Parses the shared event form. Checkbox groups arrive as repeated fields. */
export function parseConfig(form: FormData): EventConfigInput {
  const bool = (k: string) => form.get(k) === "on" || form.get(k) === "true";
  const num = (k: string) => Number(form.get(k) ?? Number.NaN);
  const list = <T extends readonly string[]>(k: string, allowed: T) =>
    form.getAll(k).map(String).filter((v): v is T[number] => (allowed as readonly string[]).includes(v));
  const laKings = bool("laKings");
  // Switched-off toggles only hide their options, which are still submitted. Options of
  // something that is off don't apply, so they are dropped instead of failing validation
  // with an error the admin can't see.
  const leadCollection = bool("leadCollection");
  const printingEnabled = bool("printingEnabled");
  return EventConfigInputSchema.parse({
    name: String(form.get("name") ?? ""),
    language: z.enum(LOCALES).parse(form.get("language")),
    leadChannel: z.enum(["whatsapp", "sms"]).parse(form.get("leadChannel")),
    qrSender: String(form.get("qrSender") ?? "").trim(),
    qrText: String(form.get("qrText") ?? "").trim(),
    styles: list("styles", STYLE_IDS),
    backgrounds: kingsBackgrounds(list("backgrounds", BACKGROUND_IDS), laKings),
    uploadedBackgroundName: String(form.get("uploadedBackgroundName") ?? ""),
    frame: z.enum(FRAME_IDS).parse(form.get("frame")),
    laKings,
    leadCollection,
    emailPromoCode: leadCollection ? String(form.get("emailPromoCode") ?? "").trim() : "",
    emailShowSnippet: leadCollection && bool("emailShowSnippet"),
    maxImagesPerPerson: num("maxImagesPerPerson"),
    printingEnabled,
    maxPrintsPerPerson: num("maxPrintsPerPerson"),
    promo: { enabled: printingEnabled && bool("promoEnabled"), text: String(form.get("promoText") ?? "") },
    shareText: String(form.get("shareText") ?? ""),
    ctaText: {
      headline: String(form.get("ctaHeadline") ?? ""),
      steps: form.getAll("ctaStep").map(String).map((s) => s.trim()).filter(Boolean),
    },
  });
}
