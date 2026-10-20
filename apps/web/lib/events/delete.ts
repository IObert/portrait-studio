import type { BlobStore } from "../blob/store";
import { BlobPaths } from "../blob/paths";
import { eventObjects } from "../sync/names";
import type { SyncStore } from "../sync/store";
import type { EventRepo } from "./repo";

export interface AuditLogger {
  info(obj: object, msg: string): void;
}

/**
 * Parts of the cascade owned by later modules (attendee bindings, Conversation
 * Memory). Each must be idempotent: a failed delete is simply run again.
 */
export interface DeleteHooks {
  /** Remove every `bindings` entry pointing at the event (SPEC §4.4). */
  removeBindings(slug: string): Promise<void>;
  /** Unlink the event from `profile_links`; delete Memory profiles left with no event. */
  unlinkProfiles(slug: string): Promise<void>;
}

/**
 * Deletes an event and all its data immediately (SPEC §4.4). Order matters:
 * the event item goes last, so a crash part-way leaves it visible in the admin
 * UI and the delete can be retried. Stats are deleted with the event.
 */
export async function deleteEvent(
  deps: { sync: SyncStore; blob: BlobStore; events: EventRepo; hooks: DeleteHooks; audit: AuditLogger },
  slug: string,
): Promise<void> {
  const { sync, blob, events, hooks, audit } = deps;
  await events.require(slug);
  const ev = eventObjects(slug);

  // Memory links are read from leads, so they go before the per-event maps.
  await hooks.unlinkProfiles(slug);
  await hooks.removeBindings(slug);
  await Promise.all(ev.allMaps().map((m) => sync.deleteMap(m)));
  await Promise.all([sync.deleteDocument(ev.printer), sync.deleteDocument(ev.booth)]);
  const [images, assets] = await Promise.all([
    blob.deletePrefix(BlobPaths.eventPrefix(slug)),
    blob.deletePrefix(BlobPaths.assetPrefix(slug)),
  ]);
  await events.remove(slug);

  // Audit line: slug, timestamp, counts. No personal data (SPEC §4.4).
  audit.info(
    { event: "event_deleted", slug, blobsDeleted: images + assets, at: new Date().toISOString() },
    "event deleted",
  );
}
