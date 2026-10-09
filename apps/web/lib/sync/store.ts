import type { z } from "zod";
import { backoffDelay, sleep } from "../retry";
import type { SyncBackend, Versioned, WriteOptions } from "./backend";
import { ConflictRetriesExhausted, SyncError } from "./errors";

/** Sync payload limit is 16 KiB of JSON; stay below it to absorb serialization differences. */
export const MAX_ITEM_BYTES = 15 * 1024;

export interface Logger {
  warn(obj: object, msg: string): void;
}

export interface StoreOptions {
  /** Retries for 429/5xx/network per call (SPEC §3.4, §9.1). */
  transientAttempts?: number;
  /** Read-modify-write attempts on revision conflicts. */
  conflictAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export class PayloadTooLarge extends Error {
  constructor(readonly object: string, readonly bytes: number) {
    super(`Payload for ${object} is ${bytes} bytes, over the ${MAX_ITEM_BYTES}-byte limit`);
    this.name = "PayloadTooLarge";
  }
}

export class InvalidSyncData extends Error {
  constructor(readonly object: string, readonly issues: string) {
    super(`Invalid data in ${object}: ${issues}`);
    this.name = "InvalidSyncData";
  }
}

/** Returning SKIP from an update function leaves the item unchanged. */
export const SKIP = Symbol("skip");
export type Updater<T> = (current: T | null) => T | typeof SKIP | Promise<T | typeof SKIP>;

/**
 * Typed access to Sync on top of a SyncBackend:
 * - every read and write is validated with the object's zod schema;
 * - payloads are size-checked before they are sent;
 * - transient errors are retried with backoff, and every rate limit (54009/429)
 *   is logged as a WARN with the object name, so bottlenecks show up (SPEC §3.4);
 * - read-modify-write uses the item revision with If-Match and retries on conflict.
 */
export class SyncStore {
  private readonly transientAttempts: number;
  private readonly conflictAttempts: number;
  private readonly delay: { baseMs: number; maxMs: number };

  constructor(
    private readonly backend: SyncBackend,
    private readonly log: Logger,
    opts: StoreOptions = {},
  ) {
    this.transientAttempts = opts.transientAttempts ?? 4;
    this.conflictAttempts = opts.conflictAttempts ?? 8;
    this.delay = { baseMs: opts.baseDelayMs ?? 100, maxMs: opts.maxDelayMs ?? 4_000 };
  }

  /** A typed handle for one map. */
  map<T>(name: string, schema: z.ZodType<T>, defaults: WriteOptions = {}): TypedMap<T> {
    return new TypedMap<T>(this, name, schema, defaults);
  }

  /** A typed handle for one document. */
  document<T>(name: string, schema: z.ZodType<T>): TypedDocument<T> {
    return new TypedDocument<T>(this, name, schema);
  }

  ensureMap(name: string) {
    return this.run(name, () => this.backend.ensureMap(name));
  }
  deleteMap(name: string) {
    return this.run(name, () => this.backend.deleteMap(name));
  }
  deleteDocument(name: string) {
    return this.run(name, () => this.backend.deleteDocument(name));
  }
  ping() {
    return this.backend.ping();
  }

  /** @internal Raw access for TypedMap / TypedDocument. */
  get raw() {
    return this.backend;
  }

  /** @internal Runs `fn`, retrying transient errors with backoff. */
  async run<T>(object: string, fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (!(err instanceof SyncError) || !err.isTransient) throw err;
        if (err.isRateLimited) {
          this.log.warn(
            { event: "sync_rate_limited", object, code: err.code, status: err.status, attempt },
            "Sync rate limit hit",
          );
        }
        if (attempt + 1 >= this.transientAttempts) throw err;
        await sleep(backoffDelay(attempt, this.delay, err.retryAfterMs));
      }
    }
  }

  /** @internal */
  conflictBackoff(attempt: number) {
    return sleep(backoffDelay(attempt, { baseMs: 20, maxMs: 500 }));
  }

  /** @internal */
  get maxConflictAttempts() {
    return this.conflictAttempts;
  }
}

function checkSize(object: string, data: unknown) {
  const bytes = Buffer.byteLength(JSON.stringify(data), "utf8");
  if (bytes > MAX_ITEM_BYTES) throw new PayloadTooLarge(object, bytes);
}

function parseWith<T>(schema: z.ZodType<T>, object: string, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    // Only field paths, never values: items may contain personal data.
    throw new InvalidSyncData(object, r.error.issues.map((i) => i.path.join(".") || "(root)").join(", "));
  }
  return r.data;
}

export class TypedMap<T> {
  constructor(
    private readonly store: SyncStore,
    readonly name: string,
    private readonly schema: z.ZodType<T>,
    private readonly defaults: WriteOptions,
  ) {}

  private validate(value: T): T {
    const parsed = parseWith(this.schema, this.name, value);
    checkSize(this.name, parsed);
    return parsed;
  }

  async getVersioned(key: string): Promise<Versioned<T> | null> {
    const it = await this.store.run(this.name, () => this.store.raw.getItem(this.name, key));
    return it && { data: parseWith(this.schema, this.name, it.data), revision: it.revision };
  }

  async get(key: string): Promise<T | null> {
    return (await this.getVersioned(key))?.data ?? null;
  }

  /** Creates the item only if the key is free. Returns false if it already exists. */
  async create(key: string, value: T, opts: WriteOptions = {}): Promise<boolean> {
    const data = this.validate(value);
    try {
      await this.store.run(this.name, () => this.store.raw.createItem(this.name, key, data, { ...this.defaults, ...opts }));
      return true;
    } catch (err) {
      if (err instanceof SyncError && err.isAlreadyExists) return false;
      throw err;
    }
  }

  /** Unconditional write (create or replace). Use only when last-write-wins is correct. */
  async put(key: string, value: T, opts: WriteOptions = {}): Promise<void> {
    const data = this.validate(value);
    const o = { ...this.defaults, ...opts };
    await this.store.run(this.name, async () => {
      try {
        await this.store.raw.updateItem(this.name, key, data, o);
      } catch (err) {
        if (!(err instanceof SyncError) || !err.isNotFound) throw err;
        try {
          await this.store.raw.createItem(this.name, key, data, o);
        } catch (createErr) {
          // Lost a race with a concurrent create: overwrite, as put promises.
          if (!(createErr instanceof SyncError) || !createErr.isAlreadyExists) throw createErr;
          await this.store.raw.updateItem(this.name, key, data, o);
        }
      }
    });
  }

  /**
   * Read-modify-write with If-Match (SPEC §3.4). `fn` receives the current value
   * (or null) and returns the new value, or SKIP to leave it unchanged. On a
   * revision conflict the item is re-read and `fn` runs again, so `fn` must be
   * free of side effects. Returns the value written (or current value on SKIP).
   */
  async update(key: string, fn: Updater<T>, opts: WriteOptions = {}): Promise<T | null> {
    const o = { ...this.defaults, ...opts };
    for (let attempt = 0; attempt < this.store.maxConflictAttempts; attempt++) {
      const current = await this.getVersioned(key);
      const next = await fn(current?.data ?? null);
      if (next === SKIP) return current?.data ?? null;
      const data = this.validate(next);
      try {
        if (current) {
          await this.store.run(this.name, () =>
            this.store.raw.updateItem(this.name, key, data, { ...o, ifMatch: current.revision }),
          );
        } else {
          await this.store.run(this.name, () => this.store.raw.createItem(this.name, key, data, o));
        }
        return data;
      } catch (err) {
        // Conflict, or the item vanished between read and write: re-read and retry.
        if (err instanceof SyncError && (err.isConflict || (current && err.isNotFound))) {
          await this.store.conflictBackoff(attempt);
          continue;
        }
        throw err;
      }
    }
    throw new ConflictRetriesExhausted(this.name, key, this.store.maxConflictAttempts);
  }

  async delete(key: string, ifMatch?: string): Promise<void> {
    await this.store.run(this.name, () => this.store.raw.deleteItem(this.name, key, ifMatch ? { ifMatch } : undefined));
  }

  /** All valid entries. Invalid items are reported through `onInvalid` and skipped. */
  async *entries(onInvalid?: (key: string, err: InvalidSyncData) => void): AsyncIterable<[string, T]> {
    for await (const it of this.store.raw.listItems(this.name)) {
      try {
        yield [it.key, parseWith(this.schema, this.name, it.data)];
      } catch (err) {
        if (err instanceof InvalidSyncData && onInvalid) onInvalid(it.key, err);
        else throw err;
      }
    }
  }
}

export class TypedDocument<T> {
  constructor(
    private readonly store: SyncStore,
    readonly name: string,
    private readonly schema: z.ZodType<T>,
  ) {}

  async get(): Promise<T | null> {
    const d = await this.store.run(this.name, () => this.store.raw.getDocument(this.name));
    return d && parseWith(this.schema, this.name, d.data);
  }

  async put(value: T, opts: WriteOptions = {}): Promise<void> {
    const data = parseWith(this.schema, this.name, value);
    checkSize(this.name, data);
    await this.store.run(this.name, () => this.store.raw.putDocument(this.name, data, opts));
  }
}
