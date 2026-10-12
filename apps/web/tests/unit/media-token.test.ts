import { describe, expect, it } from "vitest";
import { signMedia, verifyMedia } from "@/lib/media-token";

const secret = "test-secret-not-real";
const path = "events/ev/generated/job_1.jpg";

describe("signed media links", () => {
  it("round-trips a valid, unexpired token", () => {
    expect(verifyMedia(secret, signMedia(secret, path, 60))).toMatchObject({ p: path });
  });
  it("rejects expired, tampered and wrongly-signed tokens", () => {
    const now = Date.now();
    expect(verifyMedia(secret, signMedia(secret, path, 60, now), now + 61_000)).toBeNull();
    const t = signMedia(secret, path, 60);
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ p: "events/other/generated/x.jpg", e: 9e9 })).toString("base64url");
    expect(verifyMedia(secret, `${forged}.${sig}`)).toBeNull();
    expect(verifyMedia("other-secret", t)).toBeNull();
    expect(verifyMedia(secret, `${body}`)).toBeNull();
    expect(verifyMedia(secret, "garbage")).toBeNull();
  });
  it("only serves generated images, never selfies or assets", () => {
    for (const p of ["events/ev/selfies/a.jpg", "assets/events/ev/frame.png", "../etc/passwd", "events/ev/generated/../selfies/a.jpg"])
      expect(verifyMedia(secret, signMedia(secret, p, 60)), p).toBeNull();
  });
});
