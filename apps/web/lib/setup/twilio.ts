import { createHash } from "node:crypto";

/**
 * `setup:twilio` (SPEC §15): finds or creates the Twilio resources the app
 * needs and prints the environment values. Safe to run again:
 *
 * - A resource named in the environment is only checked, never replaced.
 * - Otherwise it is found by its exact name and only created when none exists.
 *   Two with the same name stop the run: pick one in the environment.
 * - Shared resources are never changed: a Memory store not created by this
 *   script is only checked (D-09, D-10), and the Messaging Service's inbound
 *   URL is only taken over from another app with `takeOverInbound` (the
 *   cut-over, D-10).
 * - Delivery templates are keyed by the public host, because WhatsApp fixes
 *   the URLs at approval. A new host gets new templates; old ones stay.
 */

export interface SyncServiceInfo {
  sid: string;
  friendlyName: string;
  aclEnabled: boolean;
}
export interface VerifyServiceInfo {
  sid: string;
  friendlyName: string;
  codeLength: number;
  lookupEnabled: boolean;
  mailerSid: string | null;
}
export interface MessagingServiceInfo {
  sid: string;
  friendlyName: string;
  inboundRequestUrl: string | null;
  inboundMethod: string;
  useInboundWebhookOnNumber: boolean;
}
export interface ContentInfo {
  sid: string;
  friendlyName: string;
  language: string;
  /** WhatsApp approval: unsubmitted, received, pending, approved, rejected, paused, disabled. */
  approval: { status: string; rejectionReason: string };
}
export interface MemoryStoreInfo {
  id: string;
  displayName: string;
  status: string;
}
export interface TraitDef {
  dataType: string;
  idTypePromotion?: string | null;
}

/** The Twilio calls setup makes. `createTwilioSetupApi` is the real one. */
export interface SetupApi {
  listSyncServices(): Promise<SyncServiceInfo[]>;
  fetchSyncService(sid: string): Promise<SyncServiceInfo | null>;
  createSyncService(p: { friendlyName: string; aclEnabled: true }): Promise<SyncServiceInfo>;
  enableSyncAcl(sid: string): Promise<void>;
  listVerifyServices(): Promise<VerifyServiceInfo[]>;
  fetchVerifyService(sid: string): Promise<VerifyServiceInfo | null>;
  createVerifyService(p: { friendlyName: string; codeLength: number; lookupEnabled: boolean }): Promise<VerifyServiceInfo>;
  fetchMessagingService(sid: string): Promise<MessagingServiceInfo | null>;
  setInboundUrl(sid: string, url: string): Promise<void>;
  listContents(namePattern: string): Promise<ContentInfo[]>;
  createContent(body: unknown): Promise<{ sid: string }>;
  submitWhatsAppApproval(sid: string, p: { name: string; category: "UTILITY" }): Promise<{ status: string }>;
  listMemoryStores(): Promise<MemoryStoreInfo[]>;
  fetchMemoryStore(id: string): Promise<MemoryStoreInfo | null>;
  createMemoryStore(p: { displayName: string; description: string }): Promise<void>;
  fetchTraitGroup(storeId: string, group: string): Promise<Record<string, TraitDef> | null>;
  addTraits(storeId: string, group: string, traits: Record<string, TraitDef>): Promise<void>;
  listIdentifierTypes(storeId: string): Promise<string[]>;
  /** True when the URL answers 200 with an image (WhatsApp fetches the template's sample). */
  isPublicImage(url: string): Promise<boolean>;
}

export interface SetupOptions {
  /** Name used for resources this script creates. */
  name: string;
  /** Current values from the environment; each one pins its resource. */
  env: Partial<Record<EnvKey, string>>;
  publicBaseUrl: string | undefined;
  dryRun: boolean;
  takeOverInbound: boolean;
  /** Waits between Memory store status checks (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
}

export type EnvKey =
  | "TWILIO_SYNC_SERVICE_SID"
  | "TWILIO_VERIFY_SERVICE_SID"
  | "TWILIO_MEMORY_STORE_ID"
  | "TWILIO_MESSAGING_SERVICE_SID"
  | "TWILIO_TEMPLATE_DELIVERY_EN"
  | "TWILIO_TEMPLATE_DELIVERY_PT_BR";

export interface SetupReport {
  /** Values to put in the environment. Templates only once approved. */
  env: Partial<Record<EnvKey, string>>;
  /** What this run changed (or, with dryRun, would change). */
  changes: string[];
  /** Fine as is. */
  ok: string[];
  /** Left for a person: Console-only steps, waiting approvals, conflicts. */
  manual: string[];
}

export class SetupError extends Error {}

/** Traits and identifiers the app reads and writes (lib/twilio/memory.ts, SPEC §15). */
export const MEMORY_TRAITS: Record<string, TraitDef> = {
  firstName: { dataType: "STRING" },
  lastName: { dataType: "STRING" },
  email: { dataType: "STRING", idTypePromotion: "email" },
  phone: { dataType: "STRING", idTypePromotion: "phone" },
  whatsapp: { dataType: "STRING", idTypePromotion: "whatsapp" },
};
const MEMORY_IDENTIFIERS = ["phone", "whatsapp", "email"];

/** Memory store names allow only letters, digits and dashes. */
export const memoryStoreName = (name: string) => name.trim().replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);

/** `portrait_studio_delivery_<host hash>_<lang>`: unique per public host (see the module comment). */
export function deliveryTemplateName(publicBaseUrl: string, language: "en" | "pt_BR"): string {
  const host = new URL(publicBaseUrl).host.toLowerCase();
  return `portrait_studio_delivery_${createHash("sha256").update(host).digest("hex").slice(0, 8)}_${language.toLowerCase()}`;
}

/** Sample image for the approval (public/samples), so the media URL resolves. */
export const DELIVERY_SAMPLE_MEDIA = "samples/delivery.jpg";

const DELIVERY_COPY = {
  en: { title: "Your Portrait Studio artwork is ready! Tap below to see, download and share it.", button: "See and share" },
  pt_BR: { title: "Sua arte do Portrait Studio está pronta! Toque abaixo para ver, baixar e compartilhar.", button: "Ver e compartilhar" },
} as const;

/**
 * The `delivery` template (SPEC §6.3): image header and a URL button to the
 * share page. `{{1}}` = `m/<token>.jpg`, `{{2}}` = share id (lib/delivery/deliver.ts).
 */
export function deliveryTemplate(publicBaseUrl: string, language: "en" | "pt_BR") {
  const origin = new URL(publicBaseUrl).origin;
  const copy = DELIVERY_COPY[language];
  return {
    friendly_name: deliveryTemplateName(publicBaseUrl, language),
    language,
    variables: { "1": DELIVERY_SAMPLE_MEDIA, "2": "sample" },
    types: {
      "twilio/card": {
        title: copy.title,
        media: [`${origin}/{{1}}`],
        actions: [{ type: "URL", title: copy.button, url: `${origin}/s/{{2}}` }],
      },
    },
  };
}

export async function runSetup(api: SetupApi, opts: SetupOptions): Promise<SetupReport> {
  const report: SetupReport = { env: {}, changes: [], ok: [], manual: [] };
  const act = async (what: string, fn: () => Promise<unknown>) => {
    report.changes.push(opts.dryRun ? `Would ${what}` : what[0]!.toUpperCase() + what.slice(1));
    if (!opts.dryRun) await fn();
  };

  await setupSync(api, opts, report, act);
  await setupVerify(api, opts, report, act);
  await setupMemory(api, opts, report, act);
  await setupMessaging(api, opts, report, act);
  await setupTemplates(api, opts, report, act);
  return report;
}

type Act = (what: string, fn: () => Promise<unknown>) => Promise<void>;

function onlyOne<T extends { friendlyName?: string; displayName?: string }>(found: T[], kind: string, name: string, key: EnvKey): T | undefined {
  if (found.length > 1) throw new SetupError(`${found.length} ${kind}s are named "${name}". Set ${key} to the one to use and run again.`);
  return found[0];
}

async function setupSync(api: SetupApi, opts: SetupOptions, report: SetupReport, act: Act) {
  const pinned = opts.env.TWILIO_SYNC_SERVICE_SID;
  let svc = pinned ? await api.fetchSyncService(pinned) : undefined;
  if (pinned && !svc) throw new SetupError(`TWILIO_SYNC_SERVICE_SID ${pinned} does not exist in this account.`);
  svc ??= onlyOne((await api.listSyncServices()).filter((s) => s.friendlyName === opts.name), "Sync Service", opts.name, "TWILIO_SYNC_SERVICE_SID");
  if (!svc) {
    let created: SyncServiceInfo | undefined;
    await act(`create Sync Service "${opts.name}" (ACLs on)`, async () => (created = await api.createSyncService({ friendlyName: opts.name, aclEnabled: true })));
    if (created) report.env.TWILIO_SYNC_SERVICE_SID = created.sid;
    return;
  }
  report.env.TWILIO_SYNC_SERVICE_SID = svc.sid;
  // Booth and agent tokens rely on ACLs to see only their own objects (D-17, D-23).
  if (!svc.aclEnabled) await act(`turn on ACLs for Sync Service ${svc.sid}`, () => api.enableSyncAcl(svc.sid));
  else report.ok.push(`Sync Service "${svc.friendlyName}" (${svc.sid}), ACLs on`);
}

async function setupVerify(api: SetupApi, opts: SetupOptions, report: SetupReport, act: Act) {
  const pinned = opts.env.TWILIO_VERIFY_SERVICE_SID;
  let svc = pinned ? await api.fetchVerifyService(pinned) : undefined;
  if (pinned && !svc) throw new SetupError(`TWILIO_VERIFY_SERVICE_SID ${pinned} does not exist in this account.`);
  svc ??= onlyOne((await api.listVerifyServices()).filter((s) => s.friendlyName === opts.name), "Verify Service", opts.name, "TWILIO_VERIFY_SERVICE_SID");
  if (!svc) {
    let created: VerifyServiceInfo | undefined;
    // Same settings as the other activations (D-10): 6-digit codes, no lookup.
    await act(`create Verify Service "${opts.name}"`, async () => (created = await api.createVerifyService({ friendlyName: opts.name, codeLength: 6, lookupEnabled: false })));
    if (created) report.env.TWILIO_VERIFY_SERVICE_SID = created.sid;
  } else {
    report.env.TWILIO_VERIFY_SERVICE_SID = svc.sid;
    report.ok.push(`Verify Service "${svc.friendlyName}" (${svc.sid})`);
  }
  if (!svc?.mailerSid)
    report.manual.push(
      "Verify email: link a SendGrid email integration to the Verify Service (Console → Verify → Services → the service → Email), and set the integration's template to apps/web/assets/email/verification-email.html (D-10, D-20). The API cannot do this.",
    );
}

async function setupMemory(api: SetupApi, opts: SetupOptions, report: SetupReport, act: Act) {
  const ours = memoryStoreName(opts.name);
  const pinned = opts.env.TWILIO_MEMORY_STORE_ID;
  let store: MemoryStoreInfo | null | undefined = pinned ? await api.fetchMemoryStore(pinned) : undefined;
  if (pinned && !store) throw new SetupError(`TWILIO_MEMORY_STORE_ID ${pinned} does not exist in this account.`);
  store ??= onlyOne((await api.listMemoryStores()).filter((s) => s.displayName === ours), "Memory store", ours, "TWILIO_MEMORY_STORE_ID");
  if (!store) {
    await act(`create Memory store "${ours}"`, async () => {
      await api.createMemoryStore({ displayName: ours, description: `${opts.name}: attendee profiles` });
      store = await waitForStore(api, ours, opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))));
    });
    if (!store) return;
  }
  const s = store as MemoryStoreInfo;
  report.env.TWILIO_MEMORY_STORE_ID = s.id;
  if (s.status !== "ACTIVE") {
    report.manual.push(`Memory store ${s.id} is ${s.status}. Run again once it is ACTIVE to check its traits.`);
    return;
  }

  // Only a store this script created may be changed; a shared one is only checked (D-09).
  const owned = s.displayName === ours;
  const traits = (await api.fetchTraitGroup(s.id, "Contact")) ?? {};
  const missing = Object.fromEntries(Object.entries(MEMORY_TRAITS).filter(([k]) => !traits[k]));
  const names = Object.keys(missing);
  if (names.length && owned) await act(`add Contact traits ${names.join(", ")} to Memory store ${s.id}`, () => api.addTraits(s.id, "Contact", missing));
  else if (names.length) report.manual.push(`Memory store "${s.displayName}" (${s.id}) is shared, so it is not changed. Its Contact trait group lacks: ${names.join(", ")}. Add them in the Console (Data → Conversation Memory → Settings → Traits).`);

  const ids = await api.listIdentifierTypes(s.id);
  const lacking = MEMORY_IDENTIFIERS.filter((t) => !ids.includes(t));
  if (lacking.length)
    report.manual.push(`Memory store ${s.id} has no identifier rule for: ${lacking.join(", ")}. Add them in the Console (Data → Conversation Memory → Settings → Identifiers).`);
  if (!names.length && !lacking.length) report.ok.push(`Memory store "${s.displayName}" (${s.id}): traits and identifiers present`);
}

async function waitForStore(api: SetupApi, displayName: string, sleep: (ms: number) => Promise<void>): Promise<MemoryStoreInfo | undefined> {
  let found: MemoryStoreInfo | undefined;
  for (let i = 0; i < 40; i++) {
    found = (await api.listMemoryStores()).find((s) => s.displayName === displayName);
    if (found && (found.status === "ACTIVE" || found.status === "FAILED")) break;
    await sleep(3_000);
  }
  if (found?.status === "FAILED") throw new SetupError(`Memory store "${displayName}" failed to provision. Delete it in the Console and run again.`);
  return found;
}

async function setupMessaging(api: SetupApi, opts: SetupOptions, report: SetupReport, act: Act) {
  const sid = opts.env.TWILIO_MESSAGING_SERVICE_SID;
  if (!sid) {
    report.manual.push(
      "Messaging Service: set TWILIO_MESSAGING_SERVICE_SID to the service that holds the booth's SMS numbers and WhatsApp senders, then run again. Senders are registered in the Console (WhatsApp self sign-up), so the script does not create the service.",
    );
    return;
  }
  const svc = await api.fetchMessagingService(sid);
  if (!svc) throw new SetupError(`TWILIO_MESSAGING_SERVICE_SID ${sid} does not exist in this account.`);
  report.env.TWILIO_MESSAGING_SERVICE_SID = sid;

  const base = publicHttpsBase(opts.publicBaseUrl);
  if (!base) {
    report.manual.push("Inbound URL not set: PUBLIC_BASE_URL must be the app's public https:// address (a tunnel when developing locally).");
    return;
  }
  const target = `${base}/api/twilio/inbound`;
  const current = svc.inboundRequestUrl ?? "";
  if (current === target && svc.inboundMethod === "POST" && !svc.useInboundWebhookOnNumber) {
    report.ok.push(`Messaging Service "${svc.friendlyName}" sends inbound messages to ${target}`);
    return;
  }
  // Another app's URL, or numbers that use their own webhooks, means that app still gets the traffic (D-10).
  const otherApp = (current !== "" && current !== target) || svc.useInboundWebhookOnNumber;
  if (otherApp && !opts.takeOverInbound) {
    const where = svc.useInboundWebhookOnNumber ? "each number's own webhook" : current;
    report.manual.push(
      `Messaging Service "${svc.friendlyName}" sends inbound messages to ${where}, not ${target}. Run again with --take-over-inbound to switch it; the app that receives them now stops getting messages.`,
    );
    return;
  }
  await act(`point Messaging Service "${svc.friendlyName}" inbound messages at ${target}`, () => api.setInboundUrl(sid, target));
}

/** `https://host[:port]` without a trailing slash, or null for anything Twilio cannot reach. */
function publicHttpsBase(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || ["localhost", "127.0.0.1", "::1"].includes(u.hostname)) return null;
    return u.origin;
  } catch {
    return null;
  }
}

async function setupTemplates(api: SetupApi, opts: SetupOptions, report: SetupReport, act: Act) {
  const base = publicHttpsBase(opts.publicBaseUrl);
  if (!base) {
    report.manual.push("Delivery templates not created: their image and button URLs need the public https:// PUBLIC_BASE_URL.");
    return;
  }
  const existing = await api.listContents("^portrait_studio_delivery_");
  for (const [language, key] of [["en", "TWILIO_TEMPLATE_DELIVERY_EN"], ["pt_BR", "TWILIO_TEMPLATE_DELIVERY_PT_BR"]] as const) {
    const name = deliveryTemplateName(base, language);
    const matches = existing.filter((c) => c.friendlyName === name && c.language === language);
    if (matches.length > 1) {
      report.manual.push(`${matches.length} templates are named ${name} (${matches.map((m) => m.sid).join(", ")}). Delete the extra ones in the Console (Messaging → Content Template Builder).`);
      continue;
    }
    const tpl = matches[0];
    const needsSubmit = !tpl || ["unsubmitted", ""].includes(tpl.approval.status.toLowerCase());
    // WhatsApp fetches the sample image while reviewing; without it the template is rejected.
    if (needsSubmit && !(await api.isPublicImage(`${base}/${DELIVERY_SAMPLE_MEDIA}`))) {
      report.manual.push(`Delivery template ${name} not submitted: ${base}/${DELIVERY_SAMPLE_MEDIA} is not reachable. Deploy the app to that host first, then run again.`);
      continue;
    }
    if (!tpl) {
      let sid: string | undefined;
      await act(`create delivery template ${name} and submit it to WhatsApp (UTILITY)`, async () => {
        sid = (await api.createContent(deliveryTemplate(base, language))).sid;
        await api.submitWhatsAppApproval(sid, { name, category: "UTILITY" });
      });
      if (sid) report.manual.push(`Delivery template ${name} (${sid}) was submitted. WhatsApp usually approves within minutes to 24 hours; run again to get its SID for ${key}.`);
      continue;
    }
    const status = tpl.approval.status.toLowerCase();
    if (status === "approved") {
      report.env[key] = tpl.sid;
      if (opts.env[key] && opts.env[key] !== tpl.sid) report.manual.push(`${key} is ${opts.env[key]}, but the approved template for ${base} is ${tpl.sid}. Update it.`);
      else report.ok.push(`Delivery template ${name} (${tpl.sid}) approved`);
    } else if (status === "unsubmitted" || status === "") {
      await act(`submit delivery template ${name} (${tpl.sid}) to WhatsApp (UTILITY)`, () => api.submitWhatsAppApproval(tpl.sid, { name, category: "UTILITY" }));
    } else if (status === "rejected") {
      report.manual.push(
        `Delivery template ${name} (${tpl.sid}) was rejected by WhatsApp: "${tpl.approval.rejectionReason || "no reason given"}". Fix the copy in lib/setup/twilio.ts, delete the template in the Console, and run again (a deleted name cannot be reused for 30 days, so change the name too).`,
      );
    } else {
      report.manual.push(`Delivery template ${name} (${tpl.sid}) is ${status} at WhatsApp. Run again later for its SID (${key}).`);
    }
  }
}
