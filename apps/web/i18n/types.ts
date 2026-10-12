import type { BackgroundId } from "../lib/events/schema";
import type { StyleId } from "../lib/prompts/styles";

/**
 * Customer-facing catalog (SPEC §12). Both locales must satisfy this type, so
 * a missing message, or a message with the wrong parameters, is a compile
 * error. Messages are functions so their placeholders are typed too.
 *
 * Limits that apply to some entries (Content API, in-session WhatsApp):
 * quick-reply button titles ≤ 20 chars, list-picker item titles ≤ 24 chars.
 */
export interface Catalog {
  styles: Record<StyleId, { name: string; aliases: readonly string[] }>;
  backgrounds: Record<Exclude<BackgroundId, "uploaded">, { name: string; aliases: readonly string[] }>;

  /** QR prefill text; must contain the event code (SPEC §5.2). */
  qrPrefill: (p: { code: string }) => string;

  routing: {
    noActiveEvent: string;
    /** Body of the event picker (WhatsApp list/quick reply, or SMS numbered list). */
    pickEvent: string;
    /** Button that opens a WhatsApp list picker. */
    pickEventButton: string;
    /** SMS: shown after the numbered list. */
    pickEventReplyHint: string;
    pickEventInvalid: string;
    onBreak: string;
    ended: string;
  };

  consent: {
    /** Button label; also the SMS keyword hint (SPEC §5.4, docs/decisions.md). */
    agreeButton: string;
    /** Exact SMS keywords accepted as "I agree" (matched case/accent-insensitively). */
    agreeKeywords: readonly string[];
    /** Case A: known profile with a name. */
    welcomeBack: (p: { firstName: string; privacyUrl: string }) => string;
    /** Case C: lead collection off. */
    agreeOnly: (p: { eventName: string; privacyUrl: string }) => string;
    /** SMS only: how to agree without buttons. */
    smsAgreeHint: (p: { keyword: string }) => string;
    /** Reminder sent when someone who has not agreed sends anything else. */
    agreeReminder: string;
    /** Case B step 1. */
    askName: (p: { eventName: string }) => string;
    nameInvalid: string;
    /** Case B step 2. */
    askEmail: (p: { firstName: string }) => string;
    emailInvalid: string;
    /** Case B step 3: must include the privacy summary and that the code confirms consent incl. marketing. */
    askCode: (p: { email: string; privacyUrl: string; resendKeyword: string }) => string;
    codeInvalid: (p: { resendKeyword: string }) => string;
    codeResent: (p: { email: string }) => string;
    /** Verify's attempt or send limit was reached. */
    codeLocked: (p: { resendKeyword: string }) => string;
    /** Localized keyword that sends a new code (SPEC §5.4). */
    resendKeywords: readonly string[];
    /** Text substituted into the verification email (privacy notice + consent statement). */
    emailConsentText: (p: { eventName: string; privacyUrl: string }) => string;
    optedIn: string;
  };

  selfie: {
    ask: string;
    /** After opt-in, when a selfie was sent before consent and is now being used. */
    usingPending: string;
    oneAtATime: string;
    quotaReached: (p: { eventName: string; max: number }) => string;
    notAnImage: string;
  };

  menus: {
    styleBody: string;
    styleButton: string;
    backgroundBody: string;
    backgroundButton: string;
    /** SMS: after a numbered list. */
    replyWithNumber: string;
    invalidChoice: string;
  };

  /** Result messages (SPEC §5.6). */
  job: {
    started: string;
    moderationRejected: string;
    noFace: string;
    tooManyPeople: string;
    /** AI review flagged the image; it goes to the admin review list. */
    reviewFlagged: string;
    /** Technical failure after retries. */
    failed: string;
  };

  errors: {
    /** Something failed on our side while handling a message. */
    generic: string;
  };

  /** Privacy notice page (SPEC §10.6). Section headings follow GDPR Art. 13/14; bodies are TODO. */
  privacy: {
    title: (p: { eventName: string }) => string;
    todoBanner: string;
    sections: {
      controller: string;
      data: string;
      purposes: string;
      processors: string;
      retention: string;
      rights: string;
      contact: string;
    };
    /** Facts we already know and can state; the rest is for the user to write. */
    knownFacts: {
      processors: string;
      retention: string;
      deletion: string;
    };
    notFound: string;
  };
}
