import "server-only";
import { notFound } from "next/navigation";
import { cache } from "react";
import { SlugSchema } from "../sync/names";
import { getEventRepo } from "./context";
import { requireAdmin } from "./guard";

/**
 * The event for an admin event route, or a 404. Deduplicated per request:
 * the event layout and the tab page below it both call it.
 */
export const loadAdminEvent = cache(async (rawSlug: string) => {
  await requireAdmin();
  const slug = SlugSchema.safeParse(rawSlug);
  if (!slug.success) notFound();
  const event = await (await getEventRepo()).get(slug.data);
  if (!event) notFound();
  return event;
});
