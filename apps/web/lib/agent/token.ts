import "server-only";
import { slugFromToken, verifyPrinterToken } from "../auth/printer-token";
import type { EventRepo } from "../events/repo";
import { eventObjects } from "../sync/names";
import type { SyncStore } from "../sync/store";
import { twilioClientJwt } from "../twilio/jwt";

export const AGENT_TOKEN_TTL = 60 * 60;
export const printerIdentity = (slug: string) => `printer:${slug}`;

export type AgentTokenResult =
  | { ok: true; token: string; ttl: number; slug: string; objects: { print: string; printer: string } }
  | { ok: false; status: 401 };

/**
 * Exchanges a printer token for a Sync token (SPEC §11.2, PROTOCOL.md §2).
 * The printer token is checked in constant time against the stored hash. The
 * Sync identity gets read+write on the event's print map and printer
 * document only; ACLs deny everything else.
 */
export async function exchangePrinterToken(deps: { sync: SyncStore; events: EventRepo }, presented: string): Promise<AgentTokenResult> {
  const slug = slugFromToken(presented);
  if (!slug) return { ok: false, status: 401 };
  const event = await deps.events.get(slug);
  // Same response for unknown event, rotated token or printing off: no oracle.
  if (!event || !verifyPrinterToken(presented, event.printerTokenHash) || !event.config.printingEnabled) return { ok: false, status: 401 };

  const ev = eventObjects(slug);
  const identity = printerIdentity(slug);
  // Both objects must exist before the agent can open them (open_existing).
  await deps.sync.ensureMap(ev.print);
  if (!(await deps.sync.raw.getDocument(ev.printer))) await deps.sync.raw.putDocument(ev.printer, { status: "unknown", heartbeatAt: null });
  await Promise.all([deps.sync.grantReadWrite("map", ev.print, identity), deps.sync.grantReadWrite("document", ev.printer, identity)]);
  return { ok: true, token: twilioClientJwt(identity, AGENT_TOKEN_TTL), ttl: AGENT_TOKEN_TTL, slug, objects: { print: ev.print, printer: ev.printer } };
}
