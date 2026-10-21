import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { calibrationImages, judgeTopBand } from "../../evals/top-clearance";
import { liveEnv } from "./env";

/**
 * The judge behind the top-10% eval (docs/decisions.md D-40) must agree with a person. Opt-in:
 * RUN_LIVE_AI_TESTS=1, a few cents. The examples are portraits the user reported as reaching into the
 * top 10%, regenerated WITHOUT a frame, so the judge sees what the model drew and not the frame's logo.
 * They contain faces, so they live in .local/eval-examples/generated/ (git-ignored) and the test skips
 * without them.
 */
const live = process.env.RUN_LIVE_AI_TESTS === "1";
const DIR = path.join(import.meta.dirname, "../../../../.local/eval-examples/generated");
const vision = { model: process.env.OPENAI_VISION_MODEL ?? "gpt-6.1-sol", effort: "low" } as const;

describe.skipIf(!live)("top-10% judge (live AI)", () => {
  const client = () => new OpenAI({ apiKey: liveEnv(["OPENAI_API_KEY"]).OPENAI_API_KEY, maxRetries: 1 });

  it("tells a head in the band from a clear one", async () => {
    const cal = await calibrationImages();
    expect((await judgeTopBand(client(), vision, cal.headInBand)).pass).toBe(false);
    expect((await judgeTopBand(client(), vision, cal.clear)).pass).toBe(true);
  }, 120_000);

  // Hair, goggles, and the 'crypto.com ARENA' sign all start inside the top 10% (checked by eye and by pixels).
  it.skipIf(!existsSync(DIR))("fails the user's real examples: hair, goggles and the arena sign in the band", async () => {
    for (const name of ["pixel-beerhall", "kings-truss", "popart-truss", "arena"]) {
      const v = await judgeTopBand(client(), vision, readFileSync(path.join(DIR, `${name}.png`)));
      expect(v.pass, name).toBe(false);
    }
  }, 300_000);
});
