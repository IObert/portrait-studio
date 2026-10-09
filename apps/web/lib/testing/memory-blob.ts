// TEST ONLY. In-memory backend for unit tests and the e2e suite (PORTRAIT_E2E_FAKE_SYNC=1).
// Never used in a real deployment: lib/services.ts refuses it unless explicitly enabled.

import type { BlobStore } from "@/lib/blob/store";

/** In-memory BlobStore for tests only. */
export class FakeBlob implements BlobStore {
  blobs = new Map<string, { data: Buffer; contentType: string }>();
  async put(path: string, data: Buffer, contentType: string) {
    this.blobs.set(path, { data: Buffer.from(data), contentType });
  }
  async get(path: string) {
    return this.blobs.get(path)?.data ?? null;
  }
  async delete(path: string) {
    this.blobs.delete(path);
  }
  async deletePrefix(prefix: string) {
    let n = 0;
    for (const k of [...this.blobs.keys()]) {
      if (!k.startsWith(prefix)) continue;
      this.blobs.delete(k);
      n++;
    }
    return n;
  }
  async readUrl(path: string, ttlSeconds: number) {
    return `https://blob.test/${path}?ttl=${ttlSeconds}`;
  }
  async ping() {}
}
