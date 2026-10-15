import { z } from "zod";
import type { BlobStore } from "../blob/store";
import { PrintJobSchema } from "../delivery/print-schema";
import type { EventRepo } from "../events/repo";
import { JobSchema } from "../jobs/schema";
import { bump } from "../stats";
import { eventObjects, Global } from "../sync/names";
import type { SyncStore } from "../sync/store";
import type { MemoryClient } from "../twilio/memory";

const LeadSchema = z.object({ memoryProfileId: z.string().nullable() }).passthrough();
const ShareSchema = z.object({ eventSlug: z.string(), jobId: z.string() }).passthrough();

export interface DeletionDeps {
  sync: SyncStore;
  blob: BlobStore;
  events: EventRepo;
  memory: MemoryClient;
  log: { info(o: object, m: string): void; warn(o: object, m: string): void };
}

export interface DeletionResult {
  events: number;
  jobs: number;
  files: number;
  /** Prints already at the printer: physically there, so their queue items stay until they finish. */
  printing: number;
  profileDeleted: boolean;
}

/**
 * "Yes, delete" (SPEC §5.10): removes everything belonging to one address
 * across all events. Anonymous stats stay. Data first, the Memory profile
 * last, and every step is safe to repeat: if anything fails, confirming
 * again finishes the job. Never logs the address in full.
 */
export async function deleteAddressData(deps: DeletionDeps, key: string, countSlug: string): Promise<DeletionResult> {
  const { sync } = deps;
  const result: DeletionResult = { events: 0, jobs: 0, files: 0, printing: 0, profileDeleted: false };
  const profiles = new Set<string>();

  for (const event of await deps.events.list()) {
    const ev = eventObjects(event.slug);
    let touched = false;

    // Jobs, their files, their print items and share links. A missing map (no traffic) is simply empty.
    const jobs = sync.map(ev.jobs, JobSchema);
    const mine: z.infer<typeof JobSchema>[] = [];
    for await (const [, job] of jobs.entries(() => {})) if (job.address === key) mine.push(job);
    for (const job of mine) {
      touched = true;
      await sync.map(ev.slideshow, z.unknown()).delete(job.jobId);
      const print = await sync.map(ev.print, PrintJobSchema).getVersioned(job.jobId);
      if (print && (print.data.state === "claimed" || print.data.state === "printing")) result.printing++;
      else if (print) await sync.map(ev.print, PrintJobSchema).delete(job.jobId, print.revision);
      await sync.map(Global.shares, ShareSchema).delete(job.shareId);
      const paths = [job.selfieBlob, job.outputBlobs?.printPng, job.outputBlobs?.deliveryJpeg].filter((p): p is string => !!p);
      for (const p of paths) {
        await deps.blob.delete(p);
        result.files++;
      }
      await jobs.delete(job.jobId);
      result.jobs++;
    }

    // Lead (keeps the profile id for step 3), then the session.
    const lead = await sync.map(ev.leads, LeadSchema).get(key);
    if (lead) {
      touched = true;
      if (lead.memoryProfileId) profiles.add(lead.memoryProfileId);
      await sync.map(ev.leads, LeadSchema).delete(key);
    }
    const session = await sync.map(ev.sessions, z.object({ pendingSelfie: z.string().nullable().optional(), memoryProfileId: z.string().nullable().optional() }).passthrough()).get(key);
    if (session) {
      touched = true;
      if (session.memoryProfileId) profiles.add(session.memoryProfileId);
      if (session.pendingSelfie) {
        await deps.blob.delete(session.pendingSelfie);
        result.files++;
      }
      await sync.map(ev.sessions, z.unknown()).delete(key);
    }
    if (touched) result.events++;
  }

  // 2. Routing state.
  await sync.map(Global.bindings, z.unknown()).delete(key);
  await sync.map("picks", z.unknown()).delete(key);

  // 3. The Memory profile, whole (D-12), and its links. Last, so a failure here can be retried.
  for (const profileId of profiles) {
    // TODO(profile-deletion): deletion request wipes the shared profile for every activation (D-12).
    await deps.memory.deleteProfile(profileId);
    await sync.map(Global.profileLinks, z.unknown()).delete(profileId);
    result.profileDeleted = true;
  }

  // 4. Anonymous count only (SPEC §5.10, §10.5).
  await bump(sync, countSlug, "deletionRequests");
  deps.log.info({ event: "data_deleted", slug: countSlug, ...result }, "attendee data deleted");
  return result;
}
