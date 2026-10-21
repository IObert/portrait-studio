import { describe, expect, it } from "vitest";
import { printerWillPrint, type PrinterView } from "@/lib/admin/printer-status";

const online = (over: Partial<Extract<PrinterView, { kind: "online" }>> = {}): PrinterView => ({
  kind: "online", agentVersion: "0.1.0", mode: "cups", queue: "DNP_DS620", status: "idle", detail: "", heartbeatAt: new Date().toISOString(), ...over,
});

describe("printerWillPrint: would a print come out right now?", () => {
  it("yes when the agent is online and the printer is idle or printing", () => {
    expect(printerWillPrint(online())).toBe(true);
    expect(printerWillPrint(online({ status: "printing" }))).toBe(true);
  });
  it("yes for the simulator: it does print, to a folder", () => {
    expect(printerWillPrint(online({ mode: "simulate" }))).toBe(true);
  });
  it("no when no agent has ever connected, or it went quiet", () => {
    expect(printerWillPrint({ kind: "none" })).toBe(false);
    expect(printerWillPrint({ kind: "offline", lastSeen: new Date().toISOString() })).toBe(false);
  });
  it("no when the agent is there but the printer is off, paused, out of paper or in error", () => {
    for (const status of ["offline", "paused", "out_of_paper", "error"]) expect(printerWillPrint(online({ status }))).toBe(false);
  });
});
