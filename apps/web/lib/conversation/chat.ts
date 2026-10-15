import type OpenAI from "openai";
import { type ChatContext, DELETION_TOOL, smartReplyEn, smartReplyPt } from "../prompts/chat";

export type ChatOutcome = { kind: "reply"; text: string } | { kind: "deletion-requested" } | { kind: "unavailable" };

export interface ChatModel {
  client: OpenAI;
  model: string;
}

/** Replies longer than this are cut: SMS segments, and a guard against a runaway answer. */
const MAX_REPLY = 600;

/**
 * Free-text reply (SPEC §5.10). The model answers briefly and steers the
 * person to send a selfie, or calls `request_data_deletion`. It has no other
 * tool and its reply never changes state. Any failure is `unavailable`, and
 * the caller falls back to the localized selfie prompt.
 */
export async function chatReply(model: ChatModel, locale: "en" | "pt_BR", ctx: ChatContext, text: string, signal?: AbortSignal): Promise<ChatOutcome> {
  try {
    const r = await model.client.responses.create(
      {
        model: model.model,
        reasoning: { effort: "none" },
        tools: [DELETION_TOOL],
        input: [
          { role: "developer", content: locale === "pt_BR" ? smartReplyPt(ctx) : smartReplyEn(ctx) },
          { role: "user", content: text.slice(0, 1000) },
        ],
      },
      { signal },
    );
    if (r.output.some((o) => o.type === "function_call" && o.name === DELETION_TOOL.name)) return { kind: "deletion-requested" };
    const reply = plain(r.output_text);
    return reply ? { kind: "reply", text: reply } : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

/** WhatsApp and SMS show Markdown literally: strip the common marks the model may still add. */
export function plain(s: string): string {
  const t = s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .trim();
  return t.length > MAX_REPLY ? `${t.slice(0, MAX_REPLY - 1).trimEnd()}…` : t;
}
