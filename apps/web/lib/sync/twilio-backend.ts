import "server-only";
import { twilioClient } from "../twilio/client";
import type { SyncBackend, Versioned, WriteOptions } from "./backend";
import { SyncError } from "./errors";

type ServiceContext = ReturnType<ReturnType<typeof twilioClient>["sync"]["v1"]["services"]>;

export interface TwilioSyncConfig {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  serviceSid: string;
}

/** Converts any SDK error into SyncError (code, status, retry-after). */
function toSyncError(err: unknown): SyncError {
  if (err instanceof SyncError) return err;
  const e = err as { code?: number; status?: number; message?: string; headers?: Record<string, string> };
  const retryAfter = Number(e.headers?.["retry-after"]);
  return new SyncError(
    typeof e.code === "number" ? e.code : undefined,
    typeof e.status === "number" ? e.status : undefined,
    e.message ?? String(err),
    Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined,
  );
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw toSyncError(err);
  }
}

const ttl = (o?: WriteOptions) => (o?.ttlSeconds ? { itemTtl: o.ttlSeconds } : {});

/** Sync over the REST API (twilio-node). Objects are addressed by unique name. */
export function createTwilioSyncBackend(cfg: TwilioSyncConfig): SyncBackend {
  // Our own retry handles 429/5xx/timeouts (SyncStore.run), so the SDK must not retry.
  const client = twilioClient(cfg);
  const svc: ServiceContext = client.sync.v1.services(cfg.serviceSid);

  return {
    async ensureMap(name) {
      try {
        await call(() => svc.syncMaps.create({ uniqueName: name }));
      } catch (err) {
        if (!(err as SyncError).isAlreadyExists) throw err;
      }
    },
    async deleteMap(name) {
      try {
        await call(() => svc.syncMaps(name).remove());
      } catch (err) {
        if (!(err as SyncError).isNotFound) throw err;
      }
    },
    async getItem(map, key) {
      try {
        const it = await call(() => svc.syncMaps(map).syncMapItems(key).fetch());
        return { data: it.data, revision: it.revision };
      } catch (err) {
        if ((err as SyncError).isNotFound) return null;
        throw err;
      }
    },
    async createItem(map, key, data, opts) {
      const it = await call(() => svc.syncMaps(map).syncMapItems.create({ key, data, ...ttl(opts) }));
      return { data: it.data, revision: it.revision };
    },
    async updateItem(map, key, data, opts) {
      const it = await call(() =>
        svc.syncMaps(map).syncMapItems(key).update({ data, ...ttl(opts), ...(opts?.ifMatch ? { ifMatch: opts.ifMatch } : {}) }),
      );
      return { data: it.data, revision: it.revision };
    },
    async deleteItem(map, key, opts) {
      try {
        await call(() => svc.syncMaps(map).syncMapItems(key).remove(opts?.ifMatch ? { ifMatch: opts.ifMatch } : {}));
      } catch (err) {
        if (!(err as SyncError).isNotFound) throw err;
      }
    },
    async *listItems(map) {
      type ItemPage = {
        instances: { key: string; data: unknown; revision: string }[];
        nextPage(): Promise<ItemPage> | undefined;
      };
      let page: ItemPage | undefined = await call(() => svc.syncMaps(map).syncMapItems.page({ pageSize: 100, order: "asc" }));
      while (page) {
        for (const it of page.instances) yield { key: it.key, data: it.data, revision: it.revision };
        const next: Promise<ItemPage> | undefined = page.nextPage();
        page = next ? await call(() => next) : undefined;
      }
    },
    async getDocument(name) {
      try {
        const d = await call(() => svc.documents(name).fetch());
        return { data: d.data, revision: d.revision };
      } catch (err) {
        if ((err as SyncError).isNotFound) return null;
        throw err;
      }
    },
    async putDocument(name, data, opts) {
      const t = opts?.ttlSeconds ? { ttl: opts.ttlSeconds } : {};
      try {
        const d = await call(() =>
          svc.documents(name).update({ data, ...t, ...(opts?.ifMatch ? { ifMatch: opts.ifMatch } : {}) }),
        );
        return { data: d.data, revision: d.revision } satisfies Versioned;
      } catch (err) {
        if (!(err as SyncError).isNotFound || opts?.ifMatch) throw err;
        const d = await call(() => svc.documents.create({ uniqueName: name, data, ...t }));
        return { data: d.data, revision: d.revision };
      }
    },
    async deleteDocument(name) {
      try {
        await call(() => svc.documents(name).remove());
      } catch (err) {
        if (!(err as SyncError).isNotFound) throw err;
      }
    },
    async ping() {
      await call(() => svc.fetch());
    },
    async grantRead(kind, name, identity) {
      const flags = { read: true, write: false, manage: false };
      if (kind === "map") await call(() => svc.syncMaps(name).syncMapPermissions(identity).update(flags));
      else await call(() => svc.documents(name).documentPermissions(identity).update(flags));
    },
  };
}
