import { z } from "zod";
import { eventObjects } from "../sync/names";
import type { SyncStore } from "../sync/store";
import type { MemoryClient } from "../twilio/memory";

const LeadSchema = z.object({
  memoryProfileId: z.string().nullable(),
  optedInAt: z.iso.datetime(),
  method: z.enum(["verified_email", "returning", "agree_only"]),
});

const HEADER = ["first_name", "last_name", "email", "phone", "whatsapp", "opted_in_at", "method"] as const;

/**
 * Leads CSV (SPEC §10.5): profile ids from `ev_<slug>_leads`, contact details
 * from Conversation Memory. Agree-only leads have no profile, so only their
 * opt-in time and method. A profile that is gone (deleted, D-12) gives an
 * empty contact rather than an error. Admin only: it holds personal data.
 */
export async function leadsCsv(deps: { sync: SyncStore; memory: MemoryClient }, slug: string): Promise<string> {
  const rows: string[][] = [];
  for await (const [, lead] of deps.sync.map(eventObjects(slug).leads, LeadSchema).entries()) {
    const p = lead.memoryProfileId ? await deps.memory.get(lead.memoryProfileId) : null;
    const c = p?.contact ?? {};
    rows.push([c.firstName ?? "", c.lastName ?? "", c.email ?? "", c.phone ?? "", c.whatsapp ?? "", lead.optedInAt, lead.method]);
  }
  rows.sort((a, b) => a[5]!.localeCompare(b[5]!));
  return [HEADER as readonly string[], ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/**
 * RFC 4180 quoting, and a leading quote mark for cells that a spreadsheet
 * would run as a formula (=, +, -, @): attendee-typed names must not execute.
 * Phone numbers (E.164) are exempt.
 */
export function csvCell(v: string): string {
  // E.164 numbers start with "+" but are plain digits: left as they are.
  const safe = /^[=+\-@\t\r]/.test(v) && !/^\+\d{6,15}$/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Number of data rows (header excluded) in a CSV made by `leadsCsv`. Quoted cells may contain line breaks and `""`. */
export function csvDataRows(csv: string): number {
  let inQuotes = false;
  let lines = 0;
  for (let i = 0; i < csv.length; i++) {
    if (csv[i] === '"') inQuotes = !inQuotes; // an escaped "" toggles twice, so it cancels out
    else if (!inQuotes && csv[i] === "\r" && csv[i + 1] === "\n") lines++;
  }
  return Math.max(0, lines - 1);
}
