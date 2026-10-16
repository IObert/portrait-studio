import { describe, expect, it, vi } from "vitest";
import { csvCell, leadsCsv } from "@/lib/leads/csv";
import { printerStatus } from "@/lib/admin/printer-status";
import { bump, readLastReset, readStats, resetStats } from "@/lib/stats";
import { eventObjects } from "@/lib/sync/names";
import { SyncStore } from "@/lib/sync/store";
import type { MemoryClient } from "@/lib/twilio/memory";
import { FakeSync } from "../support/fake-sync";

const NOW = new Date("2026-10-14T12:00:00Z");

function store() {
  const fake = new FakeSync();
  return { fake, sync: new SyncStore(fake, { warn: vi.fn() }, { baseDelayMs: 1, maxDelayMs: 2 }) };
}

describe("stats (SPEC §10.5)", () => {
  it("reset zeroes every counter and records lastResetAt; the page reads keep working", async () => {
    const { sync } = store();
    await bump(sync, "ev", "interactions", 5);
    await bump(sync, "ev", "style:anime", 2);
    expect(await readLastReset(sync, "ev")).toBeNull();
    expect(await resetStats(sync, "ev", NOW)).toBe(2);
    expect(await readStats(sync, "ev")).toEqual({});
    expect(await readLastReset(sync, "ev")).toBe(NOW.toISOString());
    await bump(sync, "ev", "interactions");
    expect(await readStats(sync, "ev")).toEqual({ interactions: 1 });
  });

  it("the reset record is deleted with the event", () => {
    expect(eventObjects("ev").allMaps()).toContain(eventObjects("ev").statsMeta);
  });

  it("printer status: none, online, and offline after 45 s without a heartbeat", async () => {
    const { fake, sync } = store();
    expect(await printerStatus(sync, "ev", NOW)).toEqual({ kind: "none" });
    const doc = { agentVersion: "0.1.0", mode: "cups", queue: "DS620", status: "idle", detail: "", heartbeatAt: "2026-10-14T11:59:50.000Z" };
    await fake.putDocument(eventObjects("ev").printer, doc);
    expect(await printerStatus(sync, "ev", NOW)).toMatchObject({ kind: "online", status: "idle" });
    expect(await printerStatus(sync, "ev", new Date(NOW.getTime() + 60_000))).toEqual({ kind: "offline", lastSeen: doc.heartbeatAt });
  });
});

describe("leads CSV (SPEC §10.5)", () => {
  it("joins leads with Memory; agree-only and deleted profiles give empty contact", async () => {
    const { fake, sync } = store();
    const leads = eventObjects("ev").leads;
    await sync.ensureMap(leads);
    await fake.createItem(leads, "whatsapp:+447700900123", { memoryProfileId: "mem_profile_ana", optedInAt: "2026-10-14T10:00:00.000Z", method: "verified_email" });
    await fake.createItem(leads, "sms:+447700900456", { memoryProfileId: null, optedInAt: "2026-10-14T11:00:00.000Z", method: "agree_only" });
    await fake.createItem(leads, "whatsapp:+447700900789", { memoryProfileId: "mem_profile_gone", optedInAt: "2026-10-14T09:00:00.000Z", method: "returning" });
    const memory = {
      get: vi.fn(async (id: string) => (id === "mem_profile_ana" ? { id, contact: { firstName: "Ana", lastName: "Souza, Jr.", email: "ana@example.com", whatsapp: "+447700900123" } } : null)),
    } as unknown as MemoryClient;
    const csv = await leadsCsv({ sync, memory }, "ev");
    expect(csv.split("\r\n")).toEqual([
      "first_name,last_name,email,phone,whatsapp,opted_in_at,method",
      ",,,,,2026-10-14T09:00:00.000Z,returning",
      'Ana,"Souza, Jr.",ana@example.com,,+447700900123,2026-10-14T10:00:00.000Z,verified_email',
      ",,,,,2026-10-14T11:00:00.000Z,agree_only",
      "",
    ]);
  });

  it("neutralises spreadsheet formulas but keeps phone numbers", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("+4915161873292")).toBe("+4915161873292");
    expect(csvCell("plain")).toBe("plain");
  });
});
