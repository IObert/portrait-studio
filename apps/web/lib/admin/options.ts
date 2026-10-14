import "server-only";
import { getEnv } from "../env";
import { log } from "../log";
import { listSenders, type Sender } from "../twilio/senders";
import { en } from "@/i18n/en";
import { BACKGROUND_IDS, FRAME_IDS, type PortraitEvent } from "../events/schema";
import { STYLE_IDS } from "../prompts/styles";
import type { Option } from "@/app/admin/_components/event-form";

const FRAME_LABELS: Record<(typeof FRAME_IDS)[number], string> = {
  none: "No frame",
  "placeholder-border": "Placeholder border",
  "twilio-tab-bottom": "Twilio tab, bottom",
  "twilio-tab-bottom-left": "Twilio tab, bottom left",
  "twilio-tab-top": "Twilio tab, top",
  "twilio-border-left": "Twilio red border, logo left",
  "twilio-border-right": "Twilio red border, logo right",
  uploaded: "Uploaded frame",
};

/** Form options; the admin UI is English-only (SPEC §12). */
export function formOptions(uploads: PortraitEvent["uploads"] = { frame: null, background: null }) {
  const styles: Option[] = STYLE_IDS.map((id) => ({ id, label: en.styles[id].name }));
  const backgrounds: Option[] = BACKGROUND_IDS.map((id) =>
    id === "uploaded"
      ? { id, label: "Uploaded background", disabled: !uploads.background, hint: uploads.background ? undefined : "upload first" }
      : { id, label: en.backgrounds[id].name },
  );
  const frames: Option[] = FRAME_IDS.map((id) => ({
    id,
    label: FRAME_LABELS[id],
    disabled: id === "uploaded" && !uploads.frame,
    hint: id === "uploaded" && !uploads.frame ? "upload first" : undefined,
  }));
  return { styles, backgrounds, frames };
}

/** QR sender options (SPEC §4.2). Never throws: an empty list means free entry. */
export async function senderOptions(): Promise<Sender[]> {
  const env = getEnv();
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_API_KEY_SID || !env.TWILIO_API_KEY_SECRET || !env.TWILIO_MESSAGING_SERVICE_SID) return [];
  try {
    return await listSenders({
      accountSid: env.TWILIO_ACCOUNT_SID,
      apiKeySid: env.TWILIO_API_KEY_SID,
      apiKeySecret: env.TWILIO_API_KEY_SECRET,
      messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID,
    });
  } catch (err) {
    log.warn({ event: "senders_lookup_failed", err: (err as Error).message }, "could not list senders");
    return [];
  }
}
