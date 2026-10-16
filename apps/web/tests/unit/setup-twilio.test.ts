import { describe, expect, it } from "vitest";
import {
  type ContentInfo,
  deliveryTemplate,
  deliveryTemplateName,
  MEMORY_TRAITS,
  type MemoryStoreInfo,
  type MessagingServiceInfo,
  runSetup,
  type SetupApi,
  SetupError,
  type SetupOptions,
  type SyncServiceInfo,
  type TraitDef,
  type VerifyServiceInfo,
} from "@/lib/setup/twilio";

const BASE = "https://booth.example.com";
const MG = "MG" + "a".repeat(32);

/** In-memory Twilio account. Counts every write so tests can assert "nothing created twice". */
function fakeAccount() {
  let n = 0;
  const id = (p: string) => p + String(++n).padStart(32, "0");
  const state = {
    sync: [] as SyncServiceInfo[],
    verify: [] as VerifyServiceInfo[],
    messaging: [{ sid: MG, friendlyName: "Portrait Studio", inboundRequestUrl: null, inboundMethod: "POST", useInboundWebhookOnNumber: false }] as MessagingServiceInfo[],
    contents: [] as ContentInfo[],
    stores: [] as MemoryStoreInfo[],
    traits: {} as Record<string, Record<string, TraitDef>>,
    identifiers: {} as Record<string, string[]>,
    writes: [] as string[],
  };
  const api: SetupApi = {
    listSyncServices: async () => state.sync,
    fetchSyncService: async (sid) => state.sync.find((s) => s.sid === sid) ?? null,
    createSyncService: async (p) => {
      state.writes.push("sync");
      const s = { sid: id("IS"), ...p };
      state.sync.push(s);
      return s;
    },
    enableSyncAcl: async (sid) => {
      state.writes.push("acl");
      state.sync.find((s) => s.sid === sid)!.aclEnabled = true;
    },
    listVerifyServices: async () => state.verify,
    fetchVerifyService: async (sid) => state.verify.find((s) => s.sid === sid) ?? null,
    createVerifyService: async (p) => {
      state.writes.push("verify");
      const s = { sid: id("VA"), mailerSid: null, ...p };
      state.verify.push(s);
      return s;
    },
    fetchMessagingService: async (sid) => state.messaging.find((s) => s.sid === sid) ?? null,
    setInboundUrl: async (sid, url) => {
      state.writes.push("inbound");
      Object.assign(state.messaging.find((s) => s.sid === sid)!, { inboundRequestUrl: url, inboundMethod: "POST", useInboundWebhookOnNumber: false });
    },
    listContents: async (pattern) => state.contents.filter((c) => new RegExp(pattern).test(c.friendlyName)),
    createContent: async (body) => {
      state.writes.push("content");
      const b = body as { friendly_name: string; language: string };
      const c = { sid: id("HX"), friendlyName: b.friendly_name, language: b.language, approval: { status: "unsubmitted", rejectionReason: "" } };
      state.contents.push(c);
      return { sid: c.sid };
    },
    submitWhatsAppApproval: async (sid) => {
      state.writes.push("submit");
      state.contents.find((c) => c.sid === sid)!.approval.status = "received";
      return { status: "received" };
    },
    listMemoryStores: async () => state.stores,
    fetchMemoryStore: async (sid) => state.stores.find((s) => s.id === sid) ?? null,
    createMemoryStore: async (p) => {
      state.writes.push("store");
      const s = { id: `mem_store_${String(++n).padStart(26, "0")}`, displayName: p.displayName, status: "ACTIVE" };
      state.stores.push(s);
      state.traits[s.id] = {};
      state.identifiers[s.id] = ["phone", "whatsapp", "email"];
    },
    fetchTraitGroup: async (storeId) => state.traits[storeId] ?? null,
    addTraits: async (storeId, _g, traits) => {
      state.writes.push("traits");
      Object.assign(state.traits[storeId]!, traits);
    },
    listIdentifierTypes: async (storeId) => state.identifiers[storeId] ?? [],
  };
  return { api, state };
}

const opts = (over: Partial<SetupOptions> = {}): SetupOptions => ({
  name: "Portrait Studio",
  env: { TWILIO_MESSAGING_SERVICE_SID: MG },
  publicBaseUrl: BASE,
  dryRun: false,
  takeOverInbound: false,
  sleep: async () => {},
  ...over,
});

describe("setup:twilio (SPEC §15)", () => {
  it("creates everything on a fresh account and prints the values", async () => {
    const { api, state } = fakeAccount();
    const r = await runSetup(api, opts());
    expect(state.writes.sort()).toEqual(["content", "content", "inbound", "store", "submit", "submit", "sync", "traits", "verify"]);
    expect(state.sync[0]).toMatchObject({ friendlyName: "Portrait Studio", aclEnabled: true });
    expect(state.verify[0]).toMatchObject({ codeLength: 6, lookupEnabled: false });
    expect(state.stores[0]!.displayName).toBe("Portrait-Studio");
    expect(Object.keys(state.traits[state.stores[0]!.id]!)).toEqual(Object.keys(MEMORY_TRAITS));
    expect(state.messaging[0]!.inboundRequestUrl).toBe(`${BASE}/api/twilio/inbound`);
    expect(r.env).toMatchObject({ TWILIO_SYNC_SERVICE_SID: state.sync[0]!.sid, TWILIO_VERIFY_SERVICE_SID: state.verify[0]!.sid, TWILIO_MEMORY_STORE_ID: state.stores[0]!.id });
    // Templates are not usable until WhatsApp approves them.
    expect(r.env.TWILIO_TEMPLATE_DELIVERY_EN).toBeUndefined();
    expect(r.manual.join("\n")).toMatch(/SendGrid email integration/);
  });

  it("a second run with no environment changes nothing and finds the same resources", async () => {
    const { api, state } = fakeAccount();
    const first = await runSetup(api, opts());
    const writes = state.writes.length;
    const again = await runSetup(api, opts());
    expect(state.writes).toHaveLength(writes);
    expect(again.changes).toEqual([]);
    expect(again.env).toEqual(first.env);
    expect(state.sync).toHaveLength(1);
    expect(state.verify).toHaveLength(1);
    expect(state.stores).toHaveLength(1);
    expect(state.contents).toHaveLength(2);
  });

  it("hands out the template SIDs once WhatsApp has approved them", async () => {
    const { api, state } = fakeAccount();
    await runSetup(api, opts());
    for (const c of state.contents) c.approval.status = "approved";
    const r = await runSetup(api, opts());
    const en = state.contents.find((c) => c.language === "en")!.sid;
    const pt = state.contents.find((c) => c.language === "pt_BR")!.sid;
    expect(r.env).toMatchObject({ TWILIO_TEMPLATE_DELIVERY_EN: en, TWILIO_TEMPLATE_DELIVERY_PT_BR: pt });
    expect(r.changes).toEqual([]);
  });

  it("resubmits a template that was created but never submitted, and reports a rejection without recreating it", async () => {
    const { api, state } = fakeAccount();
    await runSetup(api, opts());
    state.contents[0]!.approval.status = "unsubmitted";
    state.contents[1]!.approval = { status: "rejected", rejectionReason: "INVALID_FORMAT" };
    state.writes.length = 0;
    const r = await runSetup(api, opts());
    expect(state.writes).toEqual(["submit"]);
    expect(r.manual.join("\n")).toMatch(/rejected by WhatsApp: "INVALID_FORMAT"/);
  });

  it("a dry run reports what it would do and writes nothing", async () => {
    const { api, state } = fakeAccount();
    const r = await runSetup(api, opts({ dryRun: true }));
    expect(state.writes).toEqual([]);
    expect(r.changes.every((c) => c.startsWith("Would "))).toBe(true);
    expect(r.changes.join("\n")).toMatch(/create Sync Service/);
  });

  it("uses the resources pinned in the environment, even with another name", async () => {
    const { api, state } = fakeAccount();
    state.sync.push({ sid: "IS" + "1".repeat(32), friendlyName: "Portrait Studio Dev", aclEnabled: true });
    state.verify.push({ sid: "VA" + "1".repeat(32), friendlyName: "Other", codeLength: 6, lookupEnabled: false, mailerSid: "MD1" });
    const r = await runSetup(api, opts({ env: { TWILIO_MESSAGING_SERVICE_SID: MG, TWILIO_SYNC_SERVICE_SID: "IS" + "1".repeat(32), TWILIO_VERIFY_SERVICE_SID: "VA" + "1".repeat(32) } }));
    expect(state.writes).not.toContain("sync");
    expect(state.writes).not.toContain("verify");
    expect(r.env.TWILIO_SYNC_SERVICE_SID).toBe("IS" + "1".repeat(32));
    expect(r.manual.join("\n")).not.toMatch(/SendGrid/);
  });

  it("stops on a pinned SID that does not exist, rather than creating a replacement", async () => {
    const { api, state } = fakeAccount();
    await expect(runSetup(api, opts({ env: { TWILIO_SYNC_SERVICE_SID: "IS" + "9".repeat(32) } }))).rejects.toBeInstanceOf(SetupError);
    expect(state.writes).toEqual([]);
  });

  it("stops when two services share the name, instead of guessing", async () => {
    const { api, state } = fakeAccount();
    state.sync.push({ sid: "IS" + "1".repeat(32), friendlyName: "Portrait Studio", aclEnabled: true }, { sid: "IS" + "2".repeat(32), friendlyName: "Portrait Studio", aclEnabled: true });
    await expect(runSetup(api, opts())).rejects.toThrow(/2 Sync Services are named "Portrait Studio". Set TWILIO_SYNC_SERVICE_SID/);
  });

  it("turns ACLs on for an existing Sync Service that has them off", async () => {
    const { api, state } = fakeAccount();
    state.sync.push({ sid: "IS" + "1".repeat(32), friendlyName: "Portrait Studio", aclEnabled: false });
    await runSetup(api, opts());
    expect(state.sync[0]!.aclEnabled).toBe(true);
    expect(state.sync).toHaveLength(1);
  });

  it("never changes a shared Memory store; it lists what is missing instead", async () => {
    const { api, state } = fakeAccount();
    const shared = { id: "mem_store_" + "s".repeat(26), displayName: "Cross-Activation-Memory", status: "ACTIVE" };
    state.stores.push(shared);
    state.traits[shared.id] = { firstName: { dataType: "STRING" } };
    state.identifiers[shared.id] = ["phone"];
    const r = await runSetup(api, opts({ env: { TWILIO_MESSAGING_SERVICE_SID: MG, TWILIO_MEMORY_STORE_ID: shared.id } }));
    expect(state.writes).not.toContain("traits");
    expect(state.writes).not.toContain("store");
    expect(r.manual.join("\n")).toMatch(/is shared, so it is not changed.*lastName, email, phone, whatsapp/);
    expect(r.manual.join("\n")).toMatch(/no identifier rule for: whatsapp, email/);
  });

  it("does not take inbound traffic from another app without --take-over-inbound", async () => {
    const { api, state } = fakeAccount();
    state.messaging[0]!.inboundRequestUrl = "https://other-app.example.com/sms";
    const r = await runSetup(api, opts());
    expect(state.writes).not.toContain("inbound");
    expect(r.manual.join("\n")).toMatch(/--take-over-inbound/);
    await runSetup(api, opts({ takeOverInbound: true }));
    expect(state.messaging[0]!.inboundRequestUrl).toBe(`${BASE}/api/twilio/inbound`);
  });

  it("treats numbers that use their own webhooks as another app's traffic", async () => {
    const { api, state } = fakeAccount();
    state.messaging[0]!.inboundRequestUrl = `${BASE}/api/twilio/inbound`;
    state.messaging[0]!.useInboundWebhookOnNumber = true;
    const r = await runSetup(api, opts());
    expect(state.writes).not.toContain("inbound");
    expect(r.manual.join("\n")).toMatch(/each number's own webhook/);
  });

  it("skips the inbound URL and templates without a public https base URL", async () => {
    const { api, state } = fakeAccount();
    const r = await runSetup(api, opts({ publicBaseUrl: "http://localhost:3000" }));
    expect(state.writes).not.toContain("inbound");
    expect(state.writes).not.toContain("content");
    expect(r.manual.join("\n")).toMatch(/PUBLIC_BASE_URL/);
  });

  it("a new public host gets its own templates, since WhatsApp fixes the URLs at approval", async () => {
    const { api, state } = fakeAccount();
    await runSetup(api, opts());
    await runSetup(api, opts({ publicBaseUrl: "https://new.example.com" }));
    expect(state.contents).toHaveLength(4);
    expect(new Set(state.contents.map((c) => c.friendlyName)).size).toBe(4);
  });
});

describe("delivery template (SPEC §6.3)", () => {
  it("has an image header and a share button, with URLs WhatsApp can approve", () => {
    const t = deliveryTemplate(BASE + "/", "pt_BR");
    const card = t.types["twilio/card"];
    expect(card.media).toEqual([`${BASE}/{{1}}`]);
    expect(card.actions).toEqual([{ type: "URL", title: "Ver e compartilhar", url: `${BASE}/s/{{2}}` }]);
    expect(card.actions[0]!.title.length).toBeLessThanOrEqual(20);
    // The sample must end in a file type and resolve on the app (public/samples).
    expect(t.variables["1"]).toMatch(/^samples\/.+\.jpg$/);
    expect(t.friendly_name).toBe(deliveryTemplateName(BASE, "pt_BR"));
    expect(t.friendly_name).toMatch(/^portrait_studio_delivery_[0-9a-f]{8}_pt_br$/);
  });
});
