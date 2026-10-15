import "server-only";
import { revalidatePath } from "next/cache";

/** Every event action refreshes the whole event (layout + tabs): the shared header shows its name, state, printer and flagged count. */
export function revalidateEvent(slug: string) {
  revalidatePath(`/admin/events/${slug}`, "layout");
}
