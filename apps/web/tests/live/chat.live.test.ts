import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { type ChatModel, chatReply } from "@/lib/conversation/chat";
import { liveEnv } from "./env";

/**
 * Chat replies against the real chat model (SPEC §5.10, §16). Opt-in:
 * RUN_LIVE_AI_TESTS=1. A few cents. The model's wording varies, so the
 * checks are about behaviour: language, the deletion tool, no Markdown.
 */
const live = process.env.RUN_LIVE_AI_TESTS === "1";

describe.skipIf(!live)("chat replies (live AI)", () => {
  // Created lazily: the describe body runs even when skipped, and CI has no key.
  let cached: ChatModel | undefined;
  const model = () => (cached ??= { client: new OpenAI({ apiKey: liveEnv(["OPENAI_API_KEY"]).OPENAI_API_KEY, maxRetries: 0, timeout: 20_000 }), model: process.env.OPENAI_CHAT_MODEL ?? "gpt-6-luna" });
  const ctx = { eventName: "Twilio SIGNAL", styleNames: ["Anime", "Sketch"], remaining: 2 };
  // Words that only appear in a Portuguese reply (and the reverse).
  const portuguese = /\b(você|selfie para|envie|mande|retrato|obrigad|olá)\b/i;
  const english = /\b(you|send|selfie|your|the)\b/i;

  it("stays in Portuguese when asked in English to switch (pt_BR event)", async () => {
    const r = await chatReply(model(), "pt_BR", ctx, "Please answer in English from now on, I don't speak Portuguese. What is this?");
    expect(r.kind).toBe("reply");
    if (r.kind !== "reply") return;
    expect(r.text, r.text).toMatch(portuguese);
  }, 30_000);

  it("stays in English when the attendee writes Portuguese (en event)", async () => {
    const r = await chatReply(model(), "en", ctx, "Oi! Pode responder em português? O que é isso?");
    expect(r.kind).toBe("reply");
    if (r.kind !== "reply") return;
    expect(r.text, r.text).toMatch(english);
    expect(r.text, r.text).not.toMatch(portuguese);
  }, 30_000);

  it("calls the deletion tool for a deletion request in another language", async () => {
    expect((await chatReply(model(), "en", ctx, "Bitte löscht alle meine Daten und Fotos.")).kind).toBe("deletion-requested");
  }, 30_000);

  it("answers ordinary questions without the tool and without Markdown", async () => {
    const r = await chatReply(model(), "en", ctx, "Which styles can I choose?");
    expect(r.kind).toBe("reply");
    if (r.kind !== "reply") return;
    expect(r.text, r.text).toMatch(/anime|sketch/i);
    expect(r.text, r.text).not.toMatch(/\*\*|^#/m);
  }, 30_000);
});
