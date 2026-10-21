import { z } from "zod";
import { eventObjects } from "../sync/names";
import type { SyncStore } from "../sync/store";

/** The agent's heartbeat document (PROTOCOL.md §4). */
const PrinterDocSchema = z.object({
  agentVersion: z.string(),
  mode: z.enum(["cups", "windows", "simulate"]),
  queue: z.string(),
  status: z.string(),
  detail: z.string().default(""),
  heartbeatAt: z.iso.datetime(),
});

/** Older than this, the agent counts as offline (PROTOCOL.md §4). */
export const AGENT_OFFLINE_MS = 45_000;

export type PrinterView = { kind: "none" } | { kind: "offline"; lastSeen: string } | ({ kind: "online" } & z.infer<typeof PrinterDocSchema>);

/** Printer states in which a queued print waits instead of coming out (the agent's own NOT_READY list, apps/print-agent/src/printer.ts). */
const PRINTER_BLOCKED = ["offline", "paused", "out_of_paper", "error"];

/**
 * Would a print come out right now? True only when an agent is connected and its printer is not
 * off, paused, out of paper or in error. The simulator counts: it prints, to a folder.
 * Used to tell an attendee whether a queued print will come out now (D-44).
 */
export function printerWillPrint(p: PrinterView): boolean {
  return p.kind === "online" && !PRINTER_BLOCKED.includes(p.status);
}

export async function printerStatus(sync: SyncStore, slug: string, now = new Date()): Promise<PrinterView> {
  const doc = await sync.document(eventObjects(slug).printer, PrinterDocSchema).get().catch(() => null);
  if (!doc) return { kind: "none" };
  if (now.getTime() - Date.parse(doc.heartbeatAt) > AGENT_OFFLINE_MS) return { kind: "offline", lastSeen: doc.heartbeatAt };
  return { kind: "online", ...doc };
}
