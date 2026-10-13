// TEST ONLY. In-memory backend for unit tests and the e2e suite (PORTRAIT_E2E_FAKE_SYNC=1).
// Never used in a real deployment: lib/services.ts refuses it unless explicitly enabled.

import type { SyncBackend, Versioned } from "@/lib/sync/backend";
import { SyncError, SyncErrorCode } from "@/lib/sync/errors";

/**
 * In-memory SyncBackend for tests only. Mirrors Sync's semantics: integer
 * revisions as strings, 54205/54103 on If-Match mismatch, 54208 on duplicate
 * create, 54200/54201 on missing objects. `failNext` injects errors.
 */
export class FakeSync implements SyncBackend {
  maps = new Map<string, Map<string, { data: unknown; rev: number }>>();
  docs = new Map<string, { data: unknown; rev: number }>();
  writes = 0;
  private injected: SyncError[] = [];
  /** Runs before each write, after the injected-error check (to simulate races). */
  beforeWrite?: (map: string, key: string) => void | Promise<void>;

  failNext(...errors: SyncError[]) {
    this.injected.push(...errors);
  }
  static rateLimit() {
    return new SyncError(SyncErrorCode.rateLimited, 429, "Too many requests");
  }
  static serverError() {
    return new SyncError(undefined, 503, "Service unavailable");
  }

  private async gate(map: string, key: string) {
    const e = this.injected.shift();
    if (e) throw e;
    await this.beforeWrite?.(map, key);
  }
  private requireMap(name: string) {
    const m = this.maps.get(name);
    if (!m) throw new SyncError(SyncErrorCode.mapNotFound, 404, `Map ${name} not found`);
    return m;
  }
  private v(e: { data: unknown; rev: number }): Versioned {
    return { data: structuredClone(e.data), revision: String(e.rev) };
  }

  async ensureMap(name: string) {
    if (!this.maps.has(name)) this.maps.set(name, new Map());
  }
  async deleteMap(name: string) {
    this.maps.delete(name);
  }
  async getItem(map: string, key: string) {
    const e = this.maps.get(map)?.get(key);
    return e ? this.v(e) : null;
  }
  async createItem(map: string, key: string, data: unknown) {
    await this.gate(map, key);
    const m = this.requireMap(map);
    if (m.has(key)) throw new SyncError(SyncErrorCode.mapItemAlreadyExists, 409, "Map Item already exists");
    const e = { data: structuredClone(data), rev: 0 };
    m.set(key, e);
    this.writes++;
    return this.v(e);
  }
  async updateItem(map: string, key: string, data: unknown, opts?: { ifMatch?: string }) {
    await this.gate(map, key);
    const e = this.requireMap(map).get(key);
    if (!e) throw new SyncError(SyncErrorCode.mapItemNotFound, 404, "Map Item not found");
    if (opts?.ifMatch !== undefined && opts.ifMatch !== String(e.rev))
      throw new SyncError(SyncErrorCode.mapItemRevisionMismatch, 412, "Map Item revision mismatch");
    e.data = structuredClone(data);
    e.rev++;
    this.writes++;
    return this.v(e);
  }
  async deleteItem(map: string, key: string, opts?: { ifMatch?: string }) {
    await this.gate(map, key);
    const m = this.maps.get(map);
    const e = m?.get(key);
    if (!e) return;
    if (opts?.ifMatch !== undefined && opts.ifMatch !== String(e.rev))
      throw new SyncError(SyncErrorCode.mapItemRevisionMismatch, 412, "Map Item revision mismatch");
    m!.delete(key);
  }
  async *listItems(map: string) {
    const m = this.requireMap(map);
    for (const key of [...m.keys()].sort()) yield { key, ...this.v(m.get(key)!) };
  }
  async getDocument(name: string) {
    const d = this.docs.get(name);
    return d ? this.v(d) : null;
  }
  async putDocument(name: string, data: unknown, opts?: { ifMatch?: string }) {
    await this.gate(name, "");
    const d = this.docs.get(name);
    if (opts?.ifMatch !== undefined && (!d || opts.ifMatch !== String(d.rev)))
      throw new SyncError(SyncErrorCode.documentRevisionMismatch, 412, "Document revision mismatch");
    const e = { data: structuredClone(data), rev: d ? d.rev + 1 : 0 };
    this.docs.set(name, e);
    return this.v(e);
  }
  async deleteDocument(name: string) {
    this.docs.delete(name);
  }
  async ping() {}
  grants: string[] = [];
  async grantRead(kind: "map" | "document", name: string, identity: string) {
    if (kind === "map" ? !this.maps.has(name) : !this.docs.has(name)) throw new SyncError(kind === "map" ? SyncErrorCode.mapNotFound : SyncErrorCode.documentNotFound, 404, `${name} not found`);
    if (!this.grants.includes(`${kind}:${name}:${identity}`)) this.grants.push(`${kind}:${name}:${identity}`);
  }
}
