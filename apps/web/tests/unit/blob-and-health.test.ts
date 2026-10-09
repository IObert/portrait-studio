import { describe, expect, it } from "vitest";
import { BlobPaths } from "@/lib/blob/paths";
import { getEnv, requireEnv } from "@/lib/env";
import { runReadiness } from "@/lib/health/ready";
import { FakeBlob } from "../support/fake-blob";

describe("BlobPaths", () => {
  it("keeps expiring data under events/<slug>/ and assets separately", () => {
    expect(BlobPaths.selfie("sp-london")).toMatch(/^events\/sp-london\/selfies\/[0-9a-f-]{36}\.jpg$/);
    expect(BlobPaths.printPng("sp-london", "job_1")).toBe("events/sp-london/generated/job_1.print.png");
    expect(BlobPaths.frame("sp-london")).toBe("assets/events/sp-london/frame.png");
    expect(BlobPaths.selfie("a")).not.toBe(BlobPaths.selfie("a"));
  });

  it("rejects path traversal", () => {
    expect(() => BlobPaths.eventPrefix("../x")).toThrow();
    expect(() => BlobPaths.printPng("ok", "../../x")).toThrow();
  });

  it("deleting an event prefix leaves other events alone", async () => {
    const blob = new FakeBlob();
    await blob.put("events/a/selfies/1.jpg", Buffer.from("x"), "image/jpeg");
    await blob.put("events/ab/selfies/1.jpg", Buffer.from("x"), "image/jpeg");
    expect(await blob.deletePrefix(BlobPaths.eventPrefix("a"))).toBe(1);
    expect(await blob.get("events/ab/selfies/1.jpg")).not.toBeNull();
  });
});

describe("runReadiness", () => {
  it("reports each dependency and fails if any fails or hangs", async () => {
    const r = await runReadiness(
      [
        { name: "sync", run: async () => {} },
        { name: "blob", run: () => new Promise(() => {}) },
      ],
      20,
    );
    expect(r).toEqual({ ok: false, checks: { sync: "ok", blob: "fail" } });
  });
});

describe("requireEnv", () => {
  it("names every missing variable, never values", () => {
    const env = getEnv({ TWILIO_API_KEY_SECRET: "s3cret", TWILIO_ACCOUNT_SID: "" });
    expect(() => requireEnv(env, ["TWILIO_ACCOUNT_SID", "TWILIO_API_KEY_SECRET", "TWILIO_SYNC_SERVICE_SID"])).toThrow(
      "Missing required environment variables: TWILIO_ACCOUNT_SID, TWILIO_SYNC_SERVICE_SID",
    );
  });

  it("validates SID formats", () => {
    expect(() => getEnv({ TWILIO_SYNC_SERVICE_SID: "nope" })).toThrow(/TWILIO_SYNC_SERVICE_SID/);
    expect(getEnv({ TWILIO_SYNC_SERVICE_SID: `IS${"a".repeat(32)}` }).TWILIO_SYNC_SERVICE_SID).toMatch(/^IS/);
  });
});
