/** Twilio Sync error codes we act on. https://www.twilio.com/docs/api/errors */
export const SyncErrorCode = {
  rateLimited: 54009,
  documentNotFound: 54100,
  documentRevisionMismatch: 54103,
  mapNotFound: 54200,
  mapItemNotFound: 54201,
  mapItemRevisionMismatch: 54205,
  mapItemAlreadyExists: 54208,
  uniqueNameExists: 54301,
} as const;

/** Error shape every SyncBackend throws, independent of the SDK. */
export class SyncError extends Error {
  constructor(
    readonly code: number | undefined,
    readonly status: number | undefined,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "SyncError";
  }

  get isNotFound() {
    return (
      this.code === SyncErrorCode.mapItemNotFound ||
      this.code === SyncErrorCode.mapNotFound ||
      this.code === SyncErrorCode.documentNotFound ||
      this.status === 404
    );
  }
  get isConflict() {
    return (
      this.code === SyncErrorCode.mapItemRevisionMismatch ||
      this.code === SyncErrorCode.documentRevisionMismatch ||
      this.code === SyncErrorCode.mapItemAlreadyExists
    );
  }
  get isAlreadyExists() {
    return this.code === SyncErrorCode.mapItemAlreadyExists || this.code === SyncErrorCode.uniqueNameExists;
  }
  get isRateLimited() {
    return this.code === SyncErrorCode.rateLimited || this.status === 429;
  }
  get isTransient() {
    return this.isRateLimited || (this.status !== undefined && this.status >= 500) || this.status === undefined;
  }
}

/** A read-modify-write gave up after too many revision conflicts. */
export class ConflictRetriesExhausted extends Error {
  constructor(readonly object: string, readonly key: string, attempts: number) {
    super(`Gave up after ${attempts} conflicting writes to ${object}`);
    this.name = "ConflictRetriesExhausted";
  }
}
