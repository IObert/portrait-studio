import { describe, expect, it } from "vitest";
import { getEnv } from "@/lib/env";

describe("getEnv", () => {
  it("applies defaults", () => {
    expect(getEnv({})).toMatchObject({ NODE_ENV: "development", LOG_LEVEL: "info" });
  });

  it("rejects invalid values without echoing them", () => {
    expect(() => getEnv({ LOG_LEVEL: "loud" })).toThrow(/LOG_LEVEL/);
    expect(() => getEnv({ LOG_LEVEL: "loud" })).not.toThrow(/loud/);
  });
});
