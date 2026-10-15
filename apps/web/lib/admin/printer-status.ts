import { z } from "zod";
import { eventObjects } from "../sync/names";
import type { SyncStore } from "../sync/store";

/** The agent's heartbeat document (PROTOCOL.md §4). */
const PrinterDocSchema = z.object({
  agentVersion: z.string(),
  mode: z.enum(["cups", "simulate"]),
  queue: z.string(),
  status: z.string(),
  detail: z.string().default(""),
  heartbeatAt: z.iso.datetime(),
});

/** Older than this, the agent counts as offline (PROTOCOL.md §4). */
export const AGENT_OFFLINE_MS = 45_000;

export type PrinterView = { kind: "none" } | { kind: "offline"; lastSeen: string } | ({ kind: "online" } & z.infer<typeof PrinterDocSchema>);

export async function printerStatus(sync: SyncStore, slug: string, now = new Date()): Promise<PrinterView> {
  const doc = await sync.document(eventObjects(slug).printer, PrinterDocSchema).get().catch(() => null);
  if (!doc) return { kind: "none" };
  if (now.getTime() - Date.parse(doc.heartbeatAt) > AGENT_OFFLINE_MS) return { kind: "offline", lastSeen: doc.heartbeatAt };
  return { kind: "online", ...doc };
}
