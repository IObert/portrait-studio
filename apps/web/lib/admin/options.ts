import "server-only";
import { en } from "@/i18n/en";
import { BACKGROUND_IDS, FRAME_IDS, type PortraitEvent } from "../events/schema";
import { STYLE_IDS } from "../prompts/styles";
import type { Option } from "@/app/admin/_components/event-form";

const FRAME_LABELS: Record<(typeof FRAME_IDS)[number], string> = {
  none: "No frame",
  "placeholder-border": "Placeholder border",
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
