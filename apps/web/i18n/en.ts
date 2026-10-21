import type { Catalog } from "./types";

// Where V1 had copy (PROMPTS.md §H) it is reused; the rest is new.
export const en = {
  styles: {
    cartoon: { name: "Cartoon", aliases: ["pixar", "3d"] },
    "pop-art": { name: "Pop Art", aliases: ["popart", "warhol"] },
    watercolor: { name: "Watercolor", aliases: ["watercolour", "painting"] },
    anime: { name: "Anime", aliases: ["manga"] },
    sketch: { name: "Sketch", aliases: ["pencil", "drawing"] },
    "pixel-art": { name: "Pixel Art", aliases: ["pixel", "8bit", "16bit", "retro"] },
  },
  backgrounds: {
    gradient: { name: "Gradient", aliases: [] },
    "solid-white": { name: "White", aliases: ["solid white"] },
    "solid-black": { name: "Black", aliases: ["solid black"] },
    original: { name: "Original", aliases: ["keep", "same"] },
    "ice-rink": { name: "Ice rink", aliases: ["rink", "ice", "hockey"] },
    "crypto-arena": { name: "Crypto.com Arena", aliases: ["arena", "crypto", "crypto.com"] },
  },

  routing: {
    noActiveEvent: "Hi! Portrait Studio isn't running right now. Check back during the event!",
    pickEvent: "Hi! Which event are you at?",
    pickEventButton: "Choose event",
    pickEventReplyHint: "Reply with the number of your event.",
    pickEventInvalid: "Sorry, I didn't catch that. Please pick your event from the list.",
    onBreak: "We'll be right back! Portrait Studio is taking a short break.",
    ended: "This event has ended. Thanks for stopping by!",
  },

  booth: { orWhatsapp: "Or message us on WhatsApp", orSms: "Or send a text to" },

  consent: {
    agreeButton: "I agree",
    agreeKeywords: ["agree", "i agree", "yes", "ok"],
    welcomeBack: ({ firstName, privacyUrl }) =>
      `Welcome back, ${firstName}! Tap *I agree* to start. We process your photo to create your portrait. Privacy notice: ${privacyUrl}`,
    agreeOnly: ({ eventName, privacyUrl }) =>
      `Welcome to Portrait Studio at ${eventName}! We use your selfie to create your artwork and keep it for 7 days. Privacy notice: ${privacyUrl}\n\nTap *I agree* to start.`,
    smsAgreeHint: ({ keyword }) => `Reply ${keyword} to start.`,
    agreeReminder: "Please agree to the privacy notice first, then send your selfie.",
    askName: ({ eventName }) => `Welcome to Portrait Studio at ${eventName}! What's your full name?`,
    nameInvalid: "Please send your full name (first and last name).",
    askEmail: ({ firstName }) => `Thanks, ${firstName}! What's your email address?`,
    emailInvalid: "That doesn't look like an email address. Please try again.",
    askCode: ({ email, privacyUrl, resendKeyword }) =>
      `We've sent a 6-digit code to ${email}.\n\nWe use your name, email and selfie to create your portrait and to send you updates and offers from the event organizer. Privacy notice: ${privacyUrl}\n\nBy sending the code you agree to this, including marketing messages. Reply ${resendKeyword} for a new code.`,
    codeInvalid: ({ resendKeyword }) => `That code didn't work. Please check it and try again, or reply ${resendKeyword} for a new one.`,
    codeResent: ({ email }) => `We've sent a new code to ${email}.`,
    codeLocked: ({ resendKeyword }) => `Too many attempts. Please wait 10 minutes, then reply ${resendKeyword} for a new code.`,
    resendKeywords: ["resend", "new code"],
  },

  selfie: {
    ask: "Send us a selfie and we'll turn it into art!",
    usingPending: "Thanks! Let's use the selfie you already sent.",
    checking: "Nice photo! Give us a moment to check it…",
    stillChecking: "Still checking your photo, just a moment!",
    oneAtATime: "One at a time! Send a single selfie and we'll work our magic.",
    quotaReached: ({ eventName, max }) =>
      `You've already used your ${max} free ${max === 1 ? "portrait" : "portraits"} for ${eventName}. Thanks for stopping by!`,
    notAnImage: "That file isn't a photo we can use. Please send a selfie as an image.",
  },

  menus: {
    styleBody: "Great selfie! Pick your art style:",
    styleButton: "Choose style",
    backgroundBody: "Now pick your background:",
    backgroundButton: "Choose background",
    replyWithNumber: "Reply with a number or name.",
    invalidChoice: "That one isn't on the menu! Please pick from the list.",
  },

  job: {
    started: "Got it! Your portrait is being created. It'll be ready in about a minute.",
    moderationRejected: "Sorry, we can't use this photo. Please send a different selfie.",
    noFace: "We need a clear selfie with your face visible. Please send another one!",
    tooManyPeople: "We can fit up to 4 people in a portrait. Please send a photo with 4 people or fewer.",
    reviewFlagged: "That one didn't turn out great. Please send another selfie and we'll try again!",
    failed: "Sorry, something went wrong while creating your portrait. Please send your selfie again.",
  },


  delivery: {
    caption: ({ styleName, shareUrl }) => `Here's your ${styleName} portrait! Share it: ${shareUrl}`,
    linkOnly: ({ styleName, shareUrl }) => `Your ${styleName} portrait is ready! See and share it here: ${shareUrl}`,
    slideshowQuestion: "Can we show your portrait on the booth screen?",
    slideshowQuestionGroup: "Can we show your portrait on the booth screen? Please only say yes if everyone in the photo agrees.",
    slideshowYes: "Yes",
    slideshowNo: "No",
    yesKeywords: ["yes", "y", "sure", "ok"],
    noKeywords: ["no", "n", "nope"],
    slideshowThanksYes: "Thanks! Look out for it on the screen.",
    slideshowThanksNo: "No problem, it won't be shown.",
    printQuestion: ({ printsLeft }) => `Want it printed? You have ${printsLeft} ${printsLeft === 1 ? "print" : "prints"} left. Printed portraits are also shown on the booth screen.`,
    printQuestionGroup: ({ printsLeft }) =>
      `Want it printed? You have ${printsLeft} ${printsLeft === 1 ? "print" : "prints"} left. Printed portraits are also shown on the booth screen, so please only choose that if everyone in the photo agrees.`,
    printAndSlideshow: "Print + show",
    slideshowOnly: "Show only",
    noThanks: "No thanks",
    printKeywords: ["print"],
    printSmsHint: "Reply PRINT to print it and show it on the screen, YES to only show it, or NO.",
    printQueued: ({ printsLeft }) => `It's on its way to the printer! Pick it up at the booth. Prints left: ${printsLeft}.`,
    printQueuedPrinterOffline: ({ printsLeft }) => `Your print is queued, but the printer seems to be offline right now. It will print as soon as it is back; ask the booth team if it takes long. Prints left: ${printsLeft}.`,
    printNoneLeft: "You've used all your prints for this event, so this one stays digital.",
    printAlready: "This portrait is already on its way to the printer.",
    printUnavailable: "Printing isn't available right now, so this one stays digital.",
    printMenuOne: ({ styleName, printsLeft }) => `Print your ${styleName} portrait? You have ${printsLeft} ${printsLeft === 1 ? "print" : "prints"} left.`,
    printMenuMany: ({ printsLeft }) => `Which portrait should we print? You have ${printsLeft} ${printsLeft === 1 ? "print" : "prints"} left.`,
    printMenuButton: "Choose",
    printMenuPrint: "Print it",
    printMenuItem: ({ n, styleName, printed }) => `${n}. ${styleName}${printed ? " (printed)" : ""}`,
    printSmsHintOne: "Reply PRINT 1 to print it.",
    printSmsHintMany: "Reply PRINT and the number, e.g. PRINT 1. 1 is your newest.",
    printMenuNone: "You've used all your prints for this event.",
    printMenuEmpty: "You don't have a portrait to print yet. Send us a selfie first!",
    printHint: ({ printsLeft }) => `Or reply PRINT to print one of your portraits (${printsLeft} ${printsLeft === 1 ? "print" : "prints"} left).`,
  },

  share: {
    title: ({ eventName }) => `Made with Portrait Studio at ${eventName}`,
    share: "Share",
    copyText: "Copy text",
    copied: "Copied!",
    download: "Download",
    gone: "This portrait is no longer available.",
    print: ({ printsLeft }) => `Print at the booth (${printsLeft} left)`,
    printing: "Sending to the printer…",
    printAgain: ({ printsLeft }) => `Print again (${printsLeft} left)`,
    printPending: "On its way to the printer",
    removed: "This portrait was removed by the event organizer.",
  },

  deletion: {
    confirm: "Delete all your data from this booth? This can't be undone.",
    yes: "Yes, delete",
    cancel: "Cancel",
    yesKeyword: "DELETE",
    smsHint: ({ keyword }) => `Reply ${keyword} to confirm, or anything else to cancel.`,
    done: "Done. All your data from this booth has been deleted: your photos, portraits and details. Thanks for stopping by!",
    donePrinting: "Done. All your data from this booth has been deleted. One print was already at the printer and may still come out.",
    cancelled: "No problem, nothing was deleted.",
  },

  errors: {
    generic: "Sorry, something went wrong on our side. Please try again in a moment.",
  },

} satisfies Catalog;
