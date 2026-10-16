import { twilioClient } from "../twilio/client";
import type { ContentInfo, MemoryStoreInfo, SetupApi, TraitDef } from "./twilio";

/** The real Twilio calls for `runSetup`: SDK for Sync, Verify and Messaging; REST JSON for Content and Memory. */
export function createTwilioSetupApi(cfg: { accountSid: string; apiKeySid: string; apiKeySecret: string }): SetupApi {
  const client = twilioClient(cfg, { autoRetry: true, maxRetries: 3 });
  const auth = "Basic " + Buffer.from(`${cfg.apiKeySid}:${cfg.apiKeySecret}`).toString("base64");

  async function rest<T>(method: string, url: string, body?: unknown): Promise<T> {
    const res = await fetch(url, {
      method,
      headers: { authorization: auth, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => ({}))) as T & { message?: string; code?: number };
    if (!res.ok) throw new Error(`${method} ${new URL(url).pathname} → ${res.status} ${json.code ?? ""} ${json.message ?? ""}`.trim());
    return json;
  }
  const notFound = (err: unknown) => (err as { status?: number }).status === 404;
  const orNull = async <T>(p: Promise<T>): Promise<T | null> => p.catch((err) => (notFound(err) || /→ 404/.test(String(err)) ? null : Promise.reject(err)));

  const sync = (s: { sid: string; friendlyName: string; aclEnabled: boolean }) => ({ sid: s.sid, friendlyName: s.friendlyName, aclEnabled: s.aclEnabled });
  // REST, not the SDK: the SDK drops `mailer_sid` (the linked email integration).
  type VerifyJson = { sid: string; friendly_name: string; code_length: number; lookup_enabled: boolean; mailer_sid?: string | null };
  const verify = (s: VerifyJson) => ({ sid: s.sid, friendlyName: s.friendly_name, codeLength: s.code_length, lookupEnabled: s.lookup_enabled, mailerSid: s.mailer_sid ?? null });
  const verifyApi = "https://verify.twilio.com/v2/Services";
  const memory = "https://memory.twilio.com/v1/ControlPlane/Stores";

  return {
    listSyncServices: async () => (await client.sync.v1.services.list({ limit: 1000 })).map(sync),
    fetchSyncService: async (sid) => orNull(client.sync.v1.services(sid).fetch().then(sync)),
    createSyncService: async (p) => sync(await client.sync.v1.services.create(p)),
    enableSyncAcl: async (sid) => void (await client.sync.v1.services(sid).update({ aclEnabled: true })),

    async listVerifyServices() {
      const out = [];
      let url: string | null = `${verifyApi}?PageSize=1000`;
      while (url) {
        const page: { services: VerifyJson[]; meta: { next_page_url: string | null } } = await rest("GET", url);
        out.push(...page.services.map(verify));
        url = page.meta.next_page_url;
      }
      return out;
    },
    fetchVerifyService: (sid) => orNull(rest<VerifyJson>("GET", `${verifyApi}/${encodeURIComponent(sid)}`).then(verify)),
    createVerifyService: async (p) => {
      const s = await client.verify.v2.services.create(p);
      return { sid: s.sid, friendlyName: s.friendlyName, codeLength: s.codeLength, lookupEnabled: s.lookupEnabled, mailerSid: null };
    },

    fetchMessagingService: async (sid) =>
      orNull(
        client.messaging.v1
          .services(sid)
          .fetch()
          .then((s) => ({ sid: s.sid, friendlyName: s.friendlyName, inboundRequestUrl: s.inboundRequestUrl ?? null, inboundMethod: s.inboundMethod, useInboundWebhookOnNumber: s.useInboundWebhookOnNumber })),
      ),
    // POST, and the service URL wins over each number's own webhook (SPEC §15).
    setInboundUrl: async (sid, url) => void (await client.messaging.v1.services(sid).update({ inboundRequestUrl: url, inboundMethod: "POST", useInboundWebhookOnNumber: false })),

    async listContents(namePattern) {
      type Page = { contents: { sid: string; friendly_name: string; language: string; approval_requests?: { status?: string; rejection_reason?: string } | null }[]; meta: { next_page_url: string | null } };
      const out: ContentInfo[] = [];
      let url: string | null = `https://content.twilio.com/v2/ContentAndApprovals?PageSize=500&ContentName=${encodeURIComponent(namePattern)}`;
      while (url) {
        const page: Page = await rest<Page>("GET", url);
        for (const c of page.contents)
          out.push({ sid: c.sid, friendlyName: c.friendly_name, language: c.language, approval: { status: c.approval_requests?.status ?? "unsubmitted", rejectionReason: c.approval_requests?.rejection_reason ?? "" } });
        url = page.meta.next_page_url;
      }
      return out;
    },
    createContent: (body) => rest<{ sid: string }>("POST", "https://content.twilio.com/v1/Content", body),
    submitWhatsAppApproval: (sid, p) => rest<{ status: string }>("POST", `https://content.twilio.com/v1/Content/${sid}/ApprovalRequests/whatsapp`, p),

    async listMemoryStores() {
      const out: MemoryStoreInfo[] = [];
      let token: string | null = null;
      do {
        const q: string = token ? `&pageToken=${encodeURIComponent(token)}` : "";
        const page: { stores: string[]; meta: { nextToken: string | null } } = await rest("GET", `${memory}?pageSize=100${q}`);
        for (const id of page.stores) {
          const s = await this.fetchMemoryStore(id);
          if (s) out.push(s);
        }
        token = page.meta.nextToken;
      } while (token);
      return out;
    },
    fetchMemoryStore: (id) => orNull(rest<MemoryStoreInfo>("GET", `${memory}/${encodeURIComponent(id)}`).then((s) => ({ id: s.id, displayName: s.displayName, status: s.status }))),
    createMemoryStore: async (p) => void (await rest("POST", memory, p)),
    fetchTraitGroup: (storeId, group) =>
      orNull(rest<{ traitGroup: { traits: Record<string, TraitDef> } }>("GET", `${memory}/${encodeURIComponent(storeId)}/TraitGroups/${encodeURIComponent(group)}?includeTraits=true&pageSize=100`).then((r) => r.traitGroup.traits)),
    addTraits: async (storeId, group, traits) => void (await rest("PATCH", `${memory}/${encodeURIComponent(storeId)}/TraitGroups/${encodeURIComponent(group)}`, { traits })),
    listIdentifierTypes: async (storeId) =>
      (await rest<{ identifierConfigs: { idType: string }[] }>("GET", `${memory}/${encodeURIComponent(storeId)}/IdentityResolutionSettings`)).identifierConfigs.map((c) => c.idType),
  };
}
