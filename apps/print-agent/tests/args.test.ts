import { describe, expect, it } from "vitest";
import { parseAgentArgs, parseDoctorArgs } from "../src/args.js";

const token = "a".repeat(32);

describe("parseAgentArgs", () => {
  it("accepts simulator mode without a printer", () => {
    const r = parseAgentArgs(["--url", "https://booth.example.com", "--token", token, "--simulate"]);
    expect(r).toEqual({
      ok: true,
      args: { url: "https://booth.example.com", token, simulate: true, out: "./prints" },
    });
  });

  it("leaves the printer open when neither --printer nor --simulate is given: the agent asks", () => {
    const r = parseAgentArgs(["--url", "https://booth.example.com", "--token", token]);
    expect(r).toEqual({ ok: true, args: { url: "https://booth.example.com", token, simulate: false, out: "./prints" } });
  });

  it("rejects --printer together with --simulate", () => {
    const r = parseAgentArgs(["--url", "https://booth.example.com", "--token", token, "--printer", "Q", "--simulate"]);
    expect(r.ok).toBe(false);
  });

  it("rejects unknown flags and bad URLs", () => {
    expect(parseAgentArgs(["--nope"]).ok).toBe(false);
    expect(parseAgentArgs(["--url", "ftp://x", "--token", token, "--simulate"]).ok).toBe(false);
  });
});

describe("parseDoctorArgs", () => {
  it("takes a queue, a printer model and --fix", () => {
    expect(parseDoctorArgs([])).toEqual({ ok: true, args: { fix: false } });
    const r = parseDoctorArgs(["--printer", "Q", "--model", "cp70", "--fix"]);
    expect(r.ok && r.args).toMatchObject({ queue: "Q", fix: true, profile: { driver: "cp70" } });
  });
  it("rejects an unknown model", () => {
    const r = parseDoctorArgs(["--model", "hp"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ds620 or cp70/);
  });
});
