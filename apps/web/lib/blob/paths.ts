import { randomUUID } from "node:crypto";
import { SlugSchema } from "../sync/names";

/** Blob layout (SPEC §7). Everything under events/<slug>/ expires after 7 days. */
export const BlobPaths = {
  eventPrefix: (slug: string) => `events/${SlugSchema.parse(slug)}/`,
  /** Pending or normalized selfie. A fresh id per upload, so paths never collide. */
  selfie: (slug: string) => `events/${SlugSchema.parse(slug)}/selfies/${randomUUID()}.jpg`,
  printPng: (slug: string, jobId: string) => `events/${SlugSchema.parse(slug)}/generated/${safeId(jobId)}.print.png`,
  deliveryJpeg: (slug: string, jobId: string) => `events/${SlugSchema.parse(slug)}/generated/${safeId(jobId)}.jpg`,
  /** Uploaded frame/background: never expire, deleted with the event. */
  assetPrefix: (slug: string) => `assets/events/${SlugSchema.parse(slug)}/`,
  frame: (slug: string) => `assets/events/${SlugSchema.parse(slug)}/frame.png`,
  background: (slug: string, ext: "png" | "jpg") => `assets/events/${SlugSchema.parse(slug)}/background.${ext}`,
} as const;

function safeId(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error("Invalid job id");
  return id;
}
