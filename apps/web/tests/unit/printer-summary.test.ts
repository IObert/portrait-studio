import { describe, expect, it } from "vitest";
import { describePrinting } from "@/app/admin/_components/printer-summary";

const online = (over: Partial<{ mode: "cups" | "simulate"; status: string; queue: string; detail: string }> = {}) => ({
  kind: "online" as const, agentVersion: "0.1.0", mode: "cups" as const, queue: "DNP_DS620", status: "idle", detail: "", heartbeatAt: new Date().toISOString(), ...over,
});

describe("describePrinting", () => {
  it("tells a real printer from the simulator", () => {
    expect(describePrinting(true, online())).toEqual({ tone: "ok", text: "Ready: printer DNP_DS620" });
    expect(describePrinting(true, online({ mode: "simulate" }))).toEqual({ tone: "warn", text: "Ready: simulator, no printer" });
  });
  it("flags missing, offline and unhappy agents", () => {
    expect(describePrinting(true, { kind: "none" }).text).toBe("Printing on, no print agent connected yet");
    expect(describePrinting(true, { kind: "offline", lastSeen: new Date().toISOString() }).text).toBe("Print agent offline, last seen just now");
    expect(describePrinting(true, online({ status: "out_of_paper" }))).toEqual({ tone: "warn", text: "Out of paper: printer DNP_DS620" });
  });
  it("is quiet when printing is off", () => {
    expect(describePrinting(false, { kind: "none" })).toEqual({ tone: "off", text: "Printing off" });
    expect(describePrinting(false, online()).text).toBe("Printing off (agent connected)");
  });
});
