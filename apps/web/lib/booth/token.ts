import "server-only";
import { twilioClientJwt } from "../twilio/jwt";
import { eventObjects } from "../sync/names";
import type { SyncStore } from "../sync/store";

/** One Sync identity per event's booth screen; ACLs scope it to that event only (D-17). */
export const boothIdentity = (slug: string) => `booth:${slug}`;

export const BOOTH_TOKEN_TTL = 60 * 60;

/**
 * Read-only Sync token for one event's booth screen (SPEC §10.4, D-17). Grants
 * read on `ev_<slug>_booth` and `ev_<slug>_slideshow` only; the service has
 * ACLs on, so every other object is denied (error 54007). Grants are
 * idempotent and re-applied on each request, so they cannot drift.
 */
export async function boothToken(sync: SyncStore, slug: string): Promise<{ token: string; identity: string; ttl: number }> {
  const ev = eventObjects(slug);
  const identity = boothIdentity(slug);
  await Promise.all([sync.grantRead("document", ev.booth, identity), sync.grantRead("map", ev.slideshow, identity)]);
  return { token: twilioClientJwt(identity, BOOTH_TOKEN_TTL), identity, ttl: BOOTH_TOKEN_TTL };
}
