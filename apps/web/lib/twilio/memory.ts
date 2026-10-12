import { z } from "zod";
import { backoffDelay, sleep } from "../retry";

/**
 * Conversation Memory (SPEC §3.3, §5.4), raw REST (no SDK exists).
 * The store is shared with other activations (docs/decisions.md D-10, D-12).
 * Deleting a profile removes it for every app; all apps (this one included)
 * must treat a missing profile as normal.
 */
export interface ContactTraits {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
}

export interface MemoryProfile {
  id: string;
  contact: ContactTraits;
}

export interface MemoryClient {
  /** Finds a profile by phone or WhatsApp number (bare E.164 for both). */
  lookup(idType: "phone" | "whatsapp" | "email", value: string): Promise<MemoryProfile | null>;
  /** Identity-resolving upsert: creates or merges into the matching profile. Returns its id. */
  upsert(contact: ContactTraits): Promise<string>;
  /**
   * Deletes the whole profile: traits, identifiers, observations (SPEC §4.4,
   * §5.10; D-12). Irreversible. A profile that is already gone is not an error.
   */
  deleteProfile(profileId: string): Promise<void>;
}

export class MemoryError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "MemoryError";
  }
  get isTransient() {
    return this.status === 429 || this.status >= 500;
  }
}

const ProfileSchema = z.object({
  id: z.string(),
  traits: z.object({ Contact: z.record(z.string(), z.unknown()).optional() }).partial().default({}),
});
const LookupSchema = z.object({ profiles: z.array(z.string()) });
const UpsertSchema = z.object({ id: z.string() });

const ContactOut = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
});

export function createMemoryClient(cfg: { storeId: string; username: string; password: string; baseUrl?: string; fetch?: typeof fetch }): MemoryClient {
  const base = cfg.baseUrl ?? "https://memory.twilio.com";
  const doFetch = cfg.fetch ?? fetch;
  const auth = "Basic " + Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64");
  const store = encodeURIComponent(cfg.storeId);

  async function call(method: string, path: string, body?: unknown): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      const res = await doFetch(`${base}${path}`, {
        method,
        headers: { authorization: auth, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return res.status === 204 ? null : res.json().catch(() => null);
      const err = new MemoryError(res.status, `Memory ${method} ${path.split("?")[0]} → ${res.status}`);
      if (!err.isTransient || attempt >= 2) throw err;
      await sleep(backoffDelay(attempt, { baseMs: 200, maxMs: 2_000 }, Number(res.headers.get("retry-after")) * 1000 || undefined));
    }
  }

  async function get(id: string): Promise<MemoryProfile | null> {
    try {
      const p = ProfileSchema.parse(await call("GET", `/v1/Stores/${store}/Profiles/${encodeURIComponent(id)}`));
      return { id: p.id, contact: ContactOut.parse(p.traits.Contact ?? {}) };
    } catch (err) {
      if (err instanceof MemoryError && err.status === 404) return null;
      throw err;
    }
  }

  return {
    async lookup(idType, value) {
      const r = LookupSchema.parse(await call("POST", `/v1/Stores/${store}/Profiles/Lookup`, { idType, value }));
      const id = r.profiles[0];
      return id ? get(id) : null;
    },
    async upsert(contact) {
      const traits = Object.fromEntries(Object.entries(contact).filter(([, v]) => v));
      return UpsertSchema.parse(await call("POST", `/v1/Stores/${store}/Profiles`, { traits: { Contact: traits } })).id;
    },
    async deleteProfile(profileId) {
      try {
        await call("DELETE", `/v1/Stores/${store}/Profiles/${encodeURIComponent(profileId)}`);
      } catch (err) {
        if (!(err instanceof MemoryError && err.status === 404)) throw err;
      }
    },
  };
}
