export interface BlobStore {
  put(path: string, data: Buffer, contentType: string): Promise<void>;
  /** Returns null if the blob does not exist. */
  get(path: string): Promise<Buffer | null>;
  delete(path: string): Promise<void>;
  /** Deletes every blob under the prefix; returns how many were deleted. */
  deletePrefix(prefix: string): Promise<number>;
  /** Short-lived read-only HTTPS URL (Twilio media, print agent). */
  readUrl(path: string, ttlSeconds: number): Promise<string>;
  /** Cheap reachability check for /healthz/ready. */
  ping(): Promise<void>;
}

/** Default lifetime of SAS URLs handed to Twilio and the print agent. */
export const SAS_TTL_SECONDS = 15 * 60;
