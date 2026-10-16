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

  /** Booth screen: the line beside the QR code, naming the channel it opens. */
  booth: { orWhatsapp: string; orSms: string };

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
    optedIn: string;
  };

  selfie: {
    ask: string;
    /** After opt-in, when a selfie was sent before consent and is now being used. */
    usingPending: string;
    /** Photo received; safety checks run before the menus (D-18). */
    checking: string;
    /** A message arrived while the photo is still being checked. */
    stillChecking: string;
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


  /** Delivery (SPEC §6.1) and slideshow consent (§5.8). */
  delivery: {
    caption: (p: { styleName: string; shareUrl: string }) => string;
    /** SMS without MMS: link only. */
    linkOnly: (p: { styleName: string; shareUrl: string }) => string;
    slideshowQuestion: string;
    /** Group photos (2–4 people): everyone should agree. */
    slideshowQuestionGroup: string;
    slideshowYes: string;
    slideshowNo: string;
    /** Exact SMS keywords for yes / no. */
    yesKeywords: readonly string[];
    noKeywords: readonly string[];
    slideshowThanksYes: string;
    slideshowThanksNo: string;
    /** Combined print + slideshow question, when the person still has prints (D-24). */
    printQuestion: (p: { printsLeft: number }) => string;
    printQuestionGroup: (p: { printsLeft: number }) => string;
    /** Button titles: at most 20 characters (WhatsApp quick replies). */
    printAndSlideshow: string;
    slideshowOnly: string;
    noThanks: string;
    /** Exact SMS keyword for "print and show". */
    printKeywords: readonly string[];
    /** SMS hint listing the keywords for the combined question. */
    printSmsHint: string;
    printQueued: (p: { printsLeft: number }) => string;
    printNoneLeft: string;
    printAlready: string;
    printUnavailable: string;
    /** Print menu (D-28): reply PRINT any time. */
    printMenuOne: (p: { styleName: string; printsLeft: number }) => string;
    printMenuMany: (p: { printsLeft: number }) => string;
    printMenuButton: string;
    printMenuPrint: string;
    /** List row: "1. Anime", marked when printed before. At most 24 characters. */
    printMenuItem: (p: { n: number; styleName: string; printed: boolean }) => string;
    /** SMS: how to answer the print menu. */
    printSmsHintOne: string;
    printSmsHintMany: string;
    printMenuNone: string;
    printMenuEmpty: string;
    /** Added to the selfie prompt when prints are left. */
    printHint: (p: { printsLeft: number }) => string;
  };

  /** Share page (SPEC §6.2). */
  share: {
    title: (p: { eventName: string }) => string;
    share: string;
    copyText: string;
    copied: string;
    download: string;
    gone: string;
    /** Print button (D-26). */
    print: (p: { printsLeft: number }) => string;
    /** Same, for a portrait printed before (another copy). */
    printAgain: (p: { printsLeft: number }) => string;
    printing: string;
    printPending: string;
    /** Taken down by the organizer (D-16). */
    removed: string;
  };

  /** Data deletion (SPEC §5.10). */
  deletion: {
    confirm: string;
    yes: string;
    cancel: string;
    /** Exact SMS keyword for "Yes, delete". */
    yesKeyword: string;
    smsHint: (p: { keyword: string }) => string;
    done: string;
    /** Deleted, but a print was already at the printer. */
    donePrinting: string;
    cancelled: string;
  };

  errors: {
    /** Something failed on our side while handling a message. */
    generic: string;
  };

}
