/**
 * Smart-reply prompts (PROMPTS.md §G1 English, §G2 pt_BR), sent with the
 * `developer` role (SPEC §5.10). Word for word, except:
 * - "AI-powered photobooth" / "cabine de fotos com IA" → "Portrait Studio"
 *   (the user's decision: that name appears nowhere);
 * - G2's admin-written "Instruções adicionais do evento" is left out (the
 *   user's decision: no such setting, SPEC has none);
 * - the language rule at the end is required by SPEC §5.10.
 */

export interface ChatContext {
  eventName: string;
  /** Localized names of the enabled styles. */
  styleNames: string[];
  /** Portraits the person can still get, if known. */
  remaining: number | null;
}

/** §G1, with `\nRespond in English.` appended as the source does. */
export function smartReplyEn({ eventName, styleNames, remaining }: ChatContext): string {
  const remainingLine = remaining === null ? "" : `They have ${remaining} free portrait${remaining === 1 ? "" : "s"} remaining.`;
  return [
    `You are the Portrait Studio assistant at an event called "${eventName}". Powered by Twilio and OpenAI.`,
    "Your job is to respond to the user's message naturally and helpfully, then direct them to send a selfie so you can transform it into art.",
    `Available art styles: ${styleNames.join(", ")}.`,
    ...(remainingLine ? [remainingLine] : []),
    "Keep your response concise (2-4 sentences max). Always end by encouraging them to send a selfie. Be friendly and conversational. Do not use emojis.",
    LANGUAGE_RULE.en,
    "Respond in English.",
  ].join("\n");
}

/** §G2. The remaining line only when the count is known, as the source does. */
export function smartReplyPt({ eventName, styleNames, remaining }: ChatContext): string {
  return [
    `Você é o assistente do Portrait Studio no evento "${eventName}", criado com Twilio e OpenAI.`,
    "Responda à mensagem da pessoa de forma natural e útil e depois oriente-a a enviar uma selfie para transformá-la em arte.",
    `Estilos disponíveis: ${styleNames.join(", ")}.`,
    ...(remaining === null ? [] : [`Ela ainda pode criar ${remaining} ${remaining === 1 ? "retrato" : "retratos"}.`]),
    "Use português brasileiro natural, seja breve (de 2 a 4 frases), não use emojis e termine incentivando o envio de uma selfie.",
    LANGUAGE_RULE.pt_BR,
  ].join("\n");
}

/**
 * SPEC §5.10: the model can never change the conversation language. There is
 * no language tool, and the prompt says so explicitly.
 */
const LANGUAGE_RULE = {
  en: "Always reply in English, even if the user writes in another language or asks you to switch languages. You cannot change the language.",
  pt_BR: "Responda sempre em português brasileiro, mesmo que a pessoa escreva em outro idioma ou peça para trocar de idioma. Você não pode mudar o idioma.",
} as const;

/** The only tool (SPEC §5.10). It deletes nothing: the app asks for confirmation. */
export const DELETION_TOOL = {
  type: "function" as const,
  name: "request_data_deletion",
  description:
    "Call this when the user asks to delete, erase or remove their data, photos or personal information, in any language. It does not delete anything by itself: the user is asked to confirm.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  strict: true,
};
