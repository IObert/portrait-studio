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
  },

  qrPrefill: ({ code }) => `Hi! I want my AI portrait 🎨 #${code}`,

  routing: {
    noActiveEvent: "Hi! There's no photo booth running right now. Check back during the event!",
    pickEvent: "Hi! Which event are you at?",
    pickEventButton: "Choose event",
    pickEventReplyHint: "Reply with the number of your event.",
    pickEventInvalid: "Sorry, I didn't catch that. Please pick your event from the list.",
    onBreak: "We'll be right back! The photo booth is taking a short break.",
    ended: "This event has ended. Thanks for stopping by!",
  },

  consent: {
    agreeButton: "I agree",
    agreeKeywords: ["agree", "i agree", "yes", "ok"],
    welcomeBack: ({ firstName, privacyUrl }) =>
      `Welcome back, ${firstName}! Tap *I agree* to start. We process your photo to create your portrait. Privacy notice: ${privacyUrl}`,
    agreeOnly: ({ eventName, privacyUrl }) =>
      `Welcome to the AI photo booth at ${eventName}! We process your selfie to create your portrait and keep it for 7 days. Privacy notice: ${privacyUrl}\n\nTap *I agree* to start.`,
    smsAgreeHint: ({ keyword }) => `Reply ${keyword} to start.`,
    agreeReminder: "Please agree to the privacy notice first, then send your selfie.",
    askName: ({ eventName }) => `Welcome to the AI photo booth at ${eventName}! What's your full name?`,
    nameInvalid: "Please send your full name (first and last name).",
    askEmail: ({ firstName }) => `Thanks, ${firstName}! What's your email address?`,
    emailInvalid: "That doesn't look like an email address. Please try again.",
    askCode: ({ email, privacyUrl, resendKeyword }) =>
      `We've sent a 6-digit code to ${email}.\n\nWe use your name, email and selfie to create your portrait and to send you updates and offers from the event organizer. Privacy notice: ${privacyUrl}\n\nBy sending the code you agree to this, including marketing messages. Reply ${resendKeyword} for a new code.`,
    codeInvalid: ({ resendKeyword }) => `That code didn't work. Please check it and try again, or reply ${resendKeyword} for a new one.`,
    codeResent: ({ email }) => `We've sent a new code to ${email}.`,
    codeLocked: ({ resendKeyword }) => `Too many attempts. Please wait 10 minutes, then reply ${resendKeyword} for a new code.`,
    resendKeywords: ["resend", "new code"],
    emailConsentText: ({ eventName, privacyUrl }) =>
      `Enter this code in your chat to confirm your email for the AI photo booth at ${eventName}. By entering it you agree to our use of your name, email and selfie to create your portrait and to receive updates and offers, as described in the privacy notice: ${privacyUrl}`,
    optedIn: "You're all set!",
  },

  selfie: {
    ask: "Send us a selfie and we'll turn it into art!",
    usingPending: "Thanks! Let's use the selfie you already sent.",
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
  },

  share: {
    title: ({ eventName }) => `My AI portrait from ${eventName}`,
    share: "Share",
    copyText: "Copy text",
    copied: "Copied!",
    download: "Download",
    gone: "This portrait is no longer available.",
  },

  errors: {
    generic: "Sorry, something went wrong on our side. Please try again in a moment.",
  },

  privacy: {
    title: ({ eventName }) => `Privacy notice: AI photo booth at ${eventName}`,
    todoBanner: "Draft: the event organizer has not completed this privacy notice yet.",
    sections: {
      controller: "Who is responsible for your data",
      data: "What data we collect",
      purposes: "Why we use it",
      processors: "Who processes it",
      retention: "How long we keep it",
      rights: "Your rights and how to use them",
      contact: "Contact",
    },
    knownFacts: {
      processors: "Twilio (messaging, data storage, email verification), OpenAI (image processing and generation), Microsoft Azure (image storage) and Twilio SendGrid (verification email).",
      retention: "Selfies and generated portraits are deleted automatically after 7 days.",
      deletion: "To delete all your data, send a message to the booth saying you want your data deleted. We will ask you to confirm.",
    },
    notFound: "This privacy notice could not be found.",
  },
} satisfies Catalog;
