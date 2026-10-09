import { describe, expect, it } from "vitest";
import { parseAgentArgs } from "../src/args.js";

const token = "a".repeat(32);

describe("parseAgentArgs", () => {
  it("accepts simulator mode without a printer", () => {
    const r = parseAgentArgs(["--url", "https://booth.example.com", "--token", token, "--simulate"]);
    expect(r).toEqual({
      ok: true,
      args: { url: "https://booth.example.com", token, simulate: true, out: "./prints" },
    });
  });

  it("requires --printer when not simulating", () => {
    const r = parseAgentArgs(["--url", "https://booth.example.com", "--token", token]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/--printer/);
  });

  it("rejects unknown flags and bad URLs", () => {
    expect(parseAgentArgs(["--nope"]).ok).toBe(false);
    expect(parseAgentArgs(["--url", "ftp://x", "--token", token, "--simulate"]).ok).toBe(false);
  });
});
