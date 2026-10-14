/**
 * Raw Sync operations, independent of the SDK. Implementations throw SyncError.
 * `data` is plain JSON; validation happens one layer up in SyncStore.
 */
export interface Versioned<T = unknown> {
  data: T;
  revision: string;
}

export interface WriteOptions {
  /** Seconds until the item expires; 0 or undefined = never. */
  ttlSeconds?: number;
}

export interface SyncBackend {
  /** Creates the map if missing. Idempotent. */
  ensureMap(name: string): Promise<void>;
  /** Deletes the map and all its items. No-op if it does not exist. */
  deleteMap(name: string): Promise<void>;

  getItem(map: string, key: string): Promise<Versioned | null>;
  /** Fails with code 54208 if the key already exists. */
  createItem(map: string, key: string, data: unknown, opts?: WriteOptions): Promise<Versioned>;
  /** With `ifMatch`, fails with 54205 unless the revision matches. */
  updateItem(map: string, key: string, data: unknown, opts?: WriteOptions & { ifMatch?: string }): Promise<Versioned>;
  /** No-op if missing. With `ifMatch`, fails with 54205 on mismatch. */
  deleteItem(map: string, key: string, opts?: { ifMatch?: string }): Promise<void>;
  /** All items, ordered by key. */
  listItems(map: string): AsyncIterable<{ key: string } & Versioned>;

  getDocument(name: string): Promise<Versioned | null>;
  /** Creates or replaces. With `ifMatch`, fails with 54103 on mismatch. */
  putDocument(name: string, data: unknown, opts?: WriteOptions & { ifMatch?: string }): Promise<Versioned>;
  deleteDocument(name: string): Promise<void>;

  /** Cheap reachability check for /healthz/ready. */
  ping(): Promise<void>;

  /**
   * Grants an SDK identity read-only access to one object (Sync ACLs, which
   * this service enforces). Idempotent. Used for the booth screen (D-17).
   */
  grantRead(kind: "map" | "document", name: string, identity: string): Promise<void>;
  /** Read + write (no manage) for one identity on one object: the print agent (PROTOCOL.md §2). */
  grantReadWrite(kind: "map" | "document", name: string, identity: string): Promise<void>;
}
