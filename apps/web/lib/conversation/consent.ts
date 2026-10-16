import type { Catalog } from "../../i18n/types";
import type { PortraitEvent } from "../events/schema";
import type { OutboundMessage } from "../messaging/outbound";
import type { Channel } from "../messaging/address";
import type { Session } from "./session";
import { matchesKeyword, normalize } from "./text";

/** Button / list ids. Sent as payloads, never shown to attendees. */
export const ACTION = { agree: "ps:agree", deleteYes: "ps:delete:yes", deleteCancel: "ps:delete:cancel" } as const;

export interface ConsentInput {
  channel: Channel;
  text: string;
  /** Quick-reply or list selection, if any. */
  selection?: string;
}

/** Side effects the caller must perform, in order, after the state is stored. */
export type ConsentEffect =
  /** Case B step 3: send a Verify email code. */
  | { type: "send-code"; email: string }
  | { type: "resend-code"; email: string }
  | { type: "check-code"; email: string; code: string }
  /** Opted in: write the lead record, Memory profile and profile link. */
  | { type: "opt-in"; method: "verified_email" | "returning" | "agree_only"; firstName?: string; lastName?: string; email?: string; memoryProfileId: string | null }
  /** Consent done: continue with the selfie flow (menus or job). */
  | { type: "proceed" };

export interface ConsentResult {
  session: Session;
  messages: OutboundMessage[];
  effects: ConsentEffect[];
}

const EMAIL = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

function agreePrompt(c: Catalog, channel: Channel, body: string): OutboundMessage {
  // SMS has no buttons: accept exact localized keywords instead (docs/decisions.md).
  const keyword = c.consent.agreeKeywords[0]!.toUpperCase();
  return {
    kind: "buttons",
    body,
    buttons: [{ id: ACTION.agree, title: c.consent.agreeButton }],
    smsBody: `${body}\n\n${c.consent.smsAgreeHint({ keyword })}`,
  };
}

function text(body: string): OutboundMessage {
  return { kind: "text", body };
}

/** True when the message is an "I agree" (button payload on WhatsApp, keyword on SMS). */
function isAgree(c: Catalog, input: ConsentInput): boolean {
  return input.selection === ACTION.agree || (input.channel === "sms" && matchesKeyword(input.text, c.consent.agreeKeywords));
}

/**
 * Starts the consent gate for someone who is not opted in (SPEC §5.4).
 * `profile` is the Conversation Memory lookup result for this address.
 */
export function beginConsent(
  session: Session,
  event: PortraitEvent,
  c: Catalog,
  profile: { id: string; firstName?: string } | null,
  privacyUrl: string,
  channel: Channel,
): ConsentResult {
  // Case A: known profile with a name. No new email code is needed (SPEC §5.4).
  if (profile?.firstName) {
    return {
      session: { ...session, step: "awaiting_agree", memoryProfileId: profile.id, lead: { firstName: profile.firstName, lastName: "" } },
      messages: [agreePrompt(c, channel, c.consent.welcomeBack({ firstName: profile.firstName, privacyUrl }))],
      effects: [],
    };
  }
  // Case B: unknown person, lead collection on.
  if (event.config.leadCollection) {
    return {
      session: { ...session, step: "awaiting_name", memoryProfileId: profile?.id ?? null },
      messages: [text(c.consent.askName({ eventName: event.config.name }))],
      effects: [],
    };
  }
  // Case C: unknown person, lead collection off. No Memory profile is created (§17 Q2a).
  return {
    session: { ...session, step: "awaiting_agree" },
    messages: [agreePrompt(c, channel, c.consent.agreeOnly({ eventName: event.config.name, privacyUrl }))],
    effects: [],
  };
}

/**
 * Advances the consent gate (SPEC §5.4). Pure: Verify and Memory calls are
 * returned as effects. `codeResult` is the outcome of a previous `check-code`
 * effect for the same message, when the caller already performed it.
 */
export function advanceConsent(
  session: Session,
  event: PortraitEvent,
  c: Catalog,
  input: ConsentInput,
  privacyUrl: string,
  codeResult?: "approved" | "wrong" | "locked" | "expired",
  sendResult?: "sent" | "locked",
): ConsentResult {
  const keep = (messages: OutboundMessage[], effects: ConsentEffect[] = []): ConsentResult => ({ session, messages, effects });

  switch (session.step) {
    case "awaiting_agree": {
      if (!isAgree(c, input)) {
        // Any other message: re-send the prompt. Consent is a gate (SPEC §5.4).
        const body = session.lead?.firstName
          ? c.consent.welcomeBack({ firstName: session.lead.firstName, privacyUrl })
          : c.consent.agreeOnly({ eventName: event.config.name, privacyUrl });
        return keep([text(c.consent.agreeReminder), agreePrompt(c, input.channel, body)]);
      }
      const returning = !!session.memoryProfileId;
      return {
        session: { ...session, step: "ready", optedIn: true },
        messages: [],
        effects: [
          {
            type: "opt-in",
            method: returning ? "returning" : "agree_only",
            firstName: session.lead?.firstName,
            memoryProfileId: session.memoryProfileId,
          },
          { type: "proceed" },
        ],
      };
    }

    case "awaiting_name": {
      const parts = input.text.trim().split(/\s+/).filter(Boolean);
      // "Full name" per SPEC §5.4; a single word is treated as incomplete.
      if (parts.length < 2 || normalize(input.text).length < 3) return keep([text(c.consent.nameInvalid)]);
      const firstName = parts[0]!.slice(0, 60);
      const lastName = parts.slice(1).join(" ").slice(0, 60);
      return {
        session: { ...session, step: "awaiting_email", lead: { firstName, lastName } },
        messages: [text(c.consent.askEmail({ firstName }))],
        effects: [],
      };
    }

    case "awaiting_email": {
      const email = input.text.trim().toLowerCase();
      if (!EMAIL.test(email) || email.length > 254) return keep([text(c.consent.emailInvalid)]);
      const lead = { ...(session.lead ?? { firstName: "", lastName: "" }), email };
      if (sendResult === undefined) {
        // The caller must send the code, then call again with sendResult.
        return { session: { ...session, lead }, messages: [], effects: [{ type: "send-code", email }] };
      }
      if (sendResult === "locked") return { session: { ...session, lead }, messages: [text(c.consent.codeLocked({ resendKeyword: c.consent.resendKeywords[0]!.toUpperCase() }))], effects: [] };
      return {
        session: { ...session, step: "awaiting_code", lead },
        messages: [text(c.consent.askCode({ email, privacyUrl, resendKeyword: c.consent.resendKeywords[0]!.toUpperCase() }))],
        effects: [],
      };
    }

    case "awaiting_code": {
      const email = session.lead?.email;
      if (!email) return { session: { ...session, step: "awaiting_email" }, messages: [text(c.consent.emailInvalid)], effects: [] };
      const resendKeyword = c.consent.resendKeywords[0]!.toUpperCase();

      if (matchesKeyword(input.text, c.consent.resendKeywords)) {
        if (sendResult === undefined) return keep([], [{ type: "resend-code", email }]);
        return keep([text(sendResult === "locked" ? c.consent.codeLocked({ resendKeyword }) : c.consent.codeResent({ email }))]);
      }
      // A new email address replaces the old one and starts over.
      const maybeEmail = input.text.trim().toLowerCase();
      if (EMAIL.test(maybeEmail) && maybeEmail !== email)
        return advanceConsent({ ...session, step: "awaiting_email" }, event, c, input, privacyUrl, undefined, sendResult);

      const code = input.text.replace(/\D+/g, "");
      if (code.length < 4) return keep([text(c.consent.codeInvalid({ resendKeyword }))]);
      if (codeResult === undefined) return keep([], [{ type: "check-code", email, code }]);
      if (codeResult === "approved") {
        return {
          session: { ...session, step: "ready", optedIn: true, lead: null },
          messages: [],
          effects: [
            {
              type: "opt-in",
              method: "verified_email",
              firstName: session.lead!.firstName,
              lastName: session.lead!.lastName,
              email,
              memoryProfileId: session.memoryProfileId,
            },
            { type: "proceed" },
          ],
        };
      }
      if (codeResult === "locked") return keep([text(c.consent.codeLocked({ resendKeyword }))]);
      return keep([text(c.consent.codeInvalid({ resendKeyword }))]);
    }

    default:
      // Not in the consent gate: nothing to advance.
      return keep([]);
  }
}
