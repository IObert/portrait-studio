import { z } from "zod";
import { eventObjects, Global } from "../sync/names";
import { SKIP, type SyncStore } from "../sync/store";
import type { MemoryClient } from "../twilio/memory";
import type { DeleteHooks } from "./delete";

const BindingSchema = z.object({ eventSlug: z.string(), boundAt: z.string() });
const LeadSchema = z.object({ memoryProfileId: z.string().nullable() }).passthrough();
const ProfileLinksSchema = z.object({ events: z.array(z.string()) });

/** Removes every binding that points at the event (SPEC §4.1 ended, §4.4 deleted). Returns the count. */
export async function removeBindings(sync: SyncStore, slug: string): Promise<number> {
  const bindings = sync.map(Global.bindings, BindingSchema);
  const stale: string[] = [];
  for await (const [key, b] of bindings.entries()) if (b.eventSlug === slug) stale.push(key);
  // Guarded delete: skip a binding that was re-bound to another event meanwhile.
  for (const key of stale) {
    const cur = await bindings.getVersioned(key);
    if (cur?.data.eventSlug === slug) await bindings.delete(key, cur.revision).catch(() => {});
  }
  return stale.length;
}

/**
 * Unlinks the event from every Memory profile it touched (SPEC §4.4). A profile
 * linked to no other Portrait Studio event is deleted entirely (D-12).
 */
export async function unlinkProfiles(sync: SyncStore, memory: MemoryClient, slug: string): Promise<{ unlinked: number; deleted: number }> {
  const leads = sync.map(eventObjects(slug).leads, LeadSchema);
  const links = sync.map(Global.profileLinks, ProfileLinksSchema);
  const profiles = new Set<string>();
  // A missing leads map (no traffic yet) is just empty.
  for await (const [, lead] of leads.entries()) if (lead.memoryProfileId) profiles.add(lead.memoryProfileId);

  let deleted = 0;
  for (const profileId of profiles) {
    let orphaned = false;
    await links.update(profileId, (cur) => {
      if (!cur) {
        orphaned = true;
        return SKIP;
      }
      const events = cur.events.filter((e) => e !== slug);
      orphaned = events.length === 0;
      return { events };
    });
    if (orphaned) {
      await memory.deleteProfile(profileId);
      await links.delete(profileId);
      deleted++;
    }
  }
  return { unlinked: profiles.size, deleted };
}

export function cleanupHooks(sync: SyncStore, memory: MemoryClient): DeleteHooks {
  return {
    removeBindings: async (slug) => {
      await removeBindings(sync, slug);
    },
    unlinkProfiles: async (slug) => {
      await unlinkProfiles(sync, memory, slug);
    },
  };
}
