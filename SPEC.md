# Portrait Studio: Specification

What the product does and how it is built, as of the latest decisions. Section numbers are stable: code comments, tests
and the other docs refer to them. Where a section was changed by a product decision, the decision is named in brackets,
for example (D-18); [docs/decisions.md](docs/decisions.md) holds the history and the reasons.

**What it is.** A photo booth for events.
- Attendees scan a QR code and send a selfie by WhatsApp or SMS.
- They get back a stylized AI portrait.
- They can choose to print it at the booth, and to show it on the booth screen.

Other documents: [PROMPTS.md](PROMPTS.md) holds the AI prompts taken word for word from V1 (the sections named in §9);
[README.md](README.md) is the setup guide; [docs/deployment.md](docs/deployment.md) covers Azure;
[docs/how-it-works.md](docs/how-it-works.md) is a short walkthrough;
[apps/print-agent/PROTOCOL.md](apps/print-agent/PROTOCOL.md) is the agent contract.

---

## 1. Goals and principles

### 1.1 Goals
- **Fast for attendees.** From the first message to the portrait arriving should take 1–2 minutes. That budget is for the activation itself. The consent and lead steps happen before it and are not counted.
- **Simple to run.** Configuration is split into two places:
  - Environment variables, for infrastructure and secrets.
  - A small admin UI, for creating and configuring events.
- **Privacy-compliant.** Consent works as a gate. People can delete their data. Retention is limited. Stats contain no personal data.

### 1.2 Engineering principles
- **No application state in process memory.** Every piece of state lives in Twilio Sync: jobs, sessions, bindings, dedup records, counters, leads and print queues.
  - The only exception is image bytes while they are being processed.
  - Images are stored in Azure Blob Storage (§7).
  - It must be safe to run several replicas, and a restart must lose nothing.
- **Safety checks fail closed.** If moderation, face detection, scene analysis or AI review returns an error, the job is retried or failed. It is never passed.
- **Never hard-code customer-facing text.** All of it comes from i18n catalogs (§12).
- **No Twilio Serverless Functions, Studio or TwiML Bins.** All logic runs in the app container.
- **Small modules with clear boundaries.**
  - One job state machine.
  - One conversation state machine.
  - Channel adapters.
  - A prompt builder.
  - Storage adapters.
- **Typed throughout.**
  - TypeScript strict mode.
  - zod schemas for every external input: webhooks, admin forms, agent API, and Sync payloads.

### 1.3 V1 lessons (do not repeat these)
| V1 problem | Rule for V2 |
|---|---|
| Used the filesystem as a database | State lives in Sync |
| In-memory sessions, timers and locks | No in-memory state (§1.2) |
| 3–5k-line "god files" | Small modules |
| Safety checks failed open | Safety checks fail closed |
| Portuguese strings hard-coded | All text in i18n catalogs |
| Secrets returned to the browser | Secrets never reach the client |
| Shared PINs | Basic auth for admin; per-event tokens for print agents |
| Image model silently switched | One image model, always (§9.4) |

---

## 2. Scope

### 2.1 In scope
- WhatsApp and SMS attendee flow (§5)
- Event-based routing (§5.2)
- Consent gate, with optional lead collection and email verification (§5.4)
- Recognizing returning attendees with Twilio Conversation Memory (§5.4)
- Fixed styles and backgrounds that each event can enable or disable, plus one uploaded background per event (§8)
- Fixed frames plus one uploaded frame per event; each event selects one frame (§8.3)
- An AI pipeline with AI review (§9)
- Admin follow-up on images the AI flagged and images it passed (§10.3)
- Digital delivery and a public share page (§6)
- One question after delivery: print and show, show only, or neither (§5.8, D-24); attendees choose what is printed
- Optional printing with a Node print agent (DNP DS620, 4x6) and a simulator mode (§11)
- A promo follow-up after a successful print (§5.9)
- An optional LA Kings promotion: the jersey and two backgrounds (§8.4, D-36)
- Event states: draft, live, break and ended. Event deletion wipes all data (§4)
- A booth screen with QR code and CTA, break and ended screens, and a slideshow (§10.4)
- A per-event stats page, a lead export script and a stats reset script (§10.5, D-31)
- Deletion requests detected by an LLM tool, with a confirmation step (§5.10)
- Chatty LLM replies to free text (§5.10)
- English and Brazilian Portuguese (§12)
- Docker, README, `.env.example`, Twilio setup automation and a real-life test checklist (§14–§16)

### 2.2 Out of scope (do not build)
- **Channels and entry points:** phone calls and voice, the web kiosk, the `/start` landing page.
- **Image features dropped from V1:**
  - brands, except the one LA Kings promotion (§8.4, D-36)
  - stickers
  - multiple variations per photo
  - human-first review (AI review is always on)
  - regenerating with reviewer feedback
  - landscape output
- **Delivery and engagement features dropped from V1:**
  - dub.co short links
  - NPS
  - raffles
  - broadcasts
  - drop-off nudges
  - the "still working" message
- **Admin and tooling features dropped from V1:**
  - the PDF report
  - the Prompt Lab
  - printing from the server itself
  - the Electron or Mac print app
  - more than one printer per event
  - printers other than the DNP DS620
- **No STOP-keyword handling of our own.** Deletion goes through §5.10. Twilio's built-in SMS STOP handling stays as it is; do not rebuild it.
- **No automatic switching of event states.**
- **Things attendees cannot do:**
  - switch language (the event's default language is always used)
  - opt out of marketing while still using the app

---

## 3. Architecture

### 3.1 Monorepo
- It is a new repository, separate from V1.
- Use pnpm workspaces. Each project is self-contained.

```
/apps/web            Next.js app (App Router, TypeScript): admin, booth screen, share page, webhooks, agent API
/apps/web/worker     Background worker entry point (same codebase, separate process — see 3.2)
/apps/web/scripts    Command-line tools: setup:twilio, leads:export, stats:reset, previews:styles
/apps/web/evals      Opt-in checks that are not part of `pnpm test`: eval:top-clearance, eval:frame-safe-zone
/apps/print-agent    Node.js print agent (separate project, see §11)
/docs                deployment.md, how-it-works.md, decisions.md
/README.md           Setup guide (§14)
/.env.example
/Dockerfile          Image for the web app and worker
/compose.yaml        Local stack: web, worker, Azurite
/deploy.sh           Deploys to Azure Container Apps (docs/deployment.md)
```

**Shared code.** Do not create a third package unless you need one.
- The agent ↔ server protocol is small. Document it in `apps/print-agent/PROTOCOL.md`.
- The two projects share no types (decided, Q7). The contract is `PROTOCOL.md`, and each side tests its own half.

### 3.2 Runtime processes
| Process | Responsibilities |
|---|---|
| **web** (Next.js, Node runtime) | Webhooks, admin UI, booth screen, share page, agent API, Sync token endpoints |
| **worker** (same Docker image, started with a different command) | Checks photos, runs generation jobs, delivers, and settles prints. Long-running work never runs inside a webhook request. Polls Sync and claims each job with a Sync conditional update (§3.4). |
| **print-agent** (on the booth computer) | Pulls and prints the event's print jobs (§11) |

- Locally: `docker compose --env-file .env.local up --build` starts `web`, `worker` and Azurite (the flag is required, see compose.yaml).
- On Azure Container Apps: web and worker are two Container Apps built from the same image (`deploy.sh`, docs/deployment.md).

### 3.3 External services
| Service | Used for |
|---|---|
| Twilio Messaging Service | One service holding several SMS and WhatsApp senders. All inbound traffic goes to one webhook, so the channel an attendee uses does not matter. |
| Twilio Content API | Quick replies and list pickers, created at runtime (§6.3) |
| Twilio Sync | All application state (§3.4) |
| Twilio Conversation Memory | Recognizing attendees across events. Stores name, verified email and channel addresses. It is the source for lead exports. The store is shared with other activations (D-10, D-12). |
| Twilio Verify, email channel (via SendGrid) | Email verification code during lead collection |
| OpenAI | Moderation, vision checks, image generation, AI review and chat replies (§9) |
| Azure Blob Storage | Selfies, generated images, uploaded frames and backgrounds (§7) |

### 3.4 Sync data model
Use one Sync Service per deployment. Sync limits:
- 16 KB per item.
- About 20 writes per second per object, with 10-second bursts.

**Object types:**
- **Global objects** (`events`, `bindings`, `dedup_0..7`, `content_cache`, `profile_links`, `shares`, `picks`) hold small items shared by all events.
- **Per-event objects** start with `ev_<slug>_`. They are deleted together with the event.

| Object | Kind | Key → Value |
|---|---|---|
| `events` | Map | `slug` → event config (§4.2) |
| `bindings` | Map | `channel:address` → `{eventSlug, boundAt}`. Kept when the event ends (D-13); removed when it is deleted. |
| `dedup_0..7` | Maps, items with TTL (24h) | `MessageSid` → `{receivedAt}`. Sharded by hash, because the write limit is per map (D-03). |
| `content_cache` | Map | hash of the content definition → Content SID, for quick replies and list pickers created at runtime |
| `profile_links` | Map | `memoryProfileId` → `{events: [slug…]}`. Used to decide whether a Memory profile can be deleted (§4.4). |
| `shares` | Map, TTL 7 days | `shareId` → `{eventSlug, jobId, createdAt}`, so `/s/[shareId]` finds its job (D-04) |
| `picks` | Map, TTL 1 hour | `channel:address` → the live events offered in the picker, so the answer can be matched |
| `ev_<slug>_sessions` | Map, TTL 7 days | `channel:address` → conversation state (§5.1) |
| `ev_<slug>_jobs` | Map, TTL 7 days | `jobId` → job (§9.1) |
| `ev_<slug>_print` | Map, TTL 7 days | `jobId` → print job (§11.3). The print agent's token is scoped to this map and `ev_<slug>_printer` only. |
| `ev_<slug>_printer` | Document | Agent heartbeat and printer status |
| `ev_<slug>_booth` | Document | What the booth screen shows: name, state, CTA, QR code, number, localized texts. No personal data (D-17). |
| `ev_<slug>_leads` | Map | `channel:address` → `{memoryProfileId, optedInAt, method: "verified_email" \| "returning" \| "agree_only"}` |
| `ev_<slug>_slideshow` | Map, TTL 7 days | `jobId` → `{blobPath, addedAt, url}`. `url` is the signed image link, so a push has everything the screen needs (D-17). |
| `ev_<slug>_stats_0..3` | Maps | metric → counter. Sharded by metric (D-03). |
| `ev_<slug>_stats_meta` | Map | `lastResetAt` (§10.5, D-31) |

Sessions, jobs, print items and slideshow entries expire after 7 days, like the images. Leads and stats stay until the event is deleted (D-05).

**Concurrency.**
- Every read-modify-write uses the Sync revision with `If-Match`. On a conflict, re-read and retry.
- This is how jobs are claimed and quota is counted.
- Sync supports conditional updates on map items (checked live).

**Rate limits.**
- 10 new attendees per second per event is acceptable for now.
- Every Sync rate-limit response (HTTP 429 / error 54009) must produce a structured `WARN` log line that includes the object name, so a bottleneck shows up in the logs.
- `TODO(scalability)` comments mark the stats counters and the jobs map, the expected hot spots.
- twilio-node drops response headers on errors, so Sync's `retry-after` is not available. Rate limits are retried with exponential backoff and full jitter: 4 attempts per call, up to 8 re-reads on revision conflicts (D-08). Every Twilio client uses an 8 s timeout (D-21).

---

## 4. Events

### 4.1 States (switched by hand in the admin UI only)
| State | What attendees get | Booth screen |
|---|---|---|
| `draft` | Treated as not live: the event is not routable and not in the event picker | — |
| `live` | The full flow | QR code + CTA + slideshow |
| `break` | Any message gets the localized "We'll be right back" reply | Break screen |
| `ended` | Any message from someone who used the event gets the localized "This event has ended" reply, because ending keeps their bindings (D-13). Once another event is live, an ended binding is ignored and the message is routed as usual. | Ended screen |

### 4.2 Event configuration (edited in the admin UI)
| Field | Notes |
|---|---|
| `name` | Display name. Attendees name the event by it (§5.2). |
| `slug` | The internal ID: Sync object names, blob paths, URLs, the printer token and the scripts' `--event`. Generated from the name when the event is created (lowercase, accents removed, other characters a dash, at most 36 characters, `-2`, `-3`… if taken). Never typed or shown; renaming keeps it (D-35). |
| `state` | See §4.1 |
| `language` | `en` or `pt_BR`. Every customer-facing message and screen for this event uses it. |
| `leadChannel`, `qrSender` | One choice in the admin: a number on one channel, from the Messaging Service. Each number appears once per channel it can be messaged on (WhatsApp sender online, SMS capability). Picking one sets both fields. If the senders cannot be loaded, both are entered by hand (D-37). |
| `qrText` | What the phone pre-fills after scanning, in the event's language. Must keep `{event}`, which becomes the event name (D-37). |
| `styles` | The enabled subset of the fixed styles (§8.1), at least one. If only one is enabled, the style menu is skipped. |
| `backgrounds` | The enabled subset of the fixed backgrounds, the optional uploaded one and, with the promotion, the two Kings scenes (§8.2, §8.4), at least one. If only one is enabled, the background menu is skipped. |
| `uploadedBackgroundName` | The localized name shown for the uploaded background |
| `frame` | Exactly one frame: a fixed frame, `none`, or the event's uploaded frame (§8.3) |
| `laKings` | The LA Kings promotion (§8.4) |
| `leadCollection` | On or off (§5.4) |
| `emailPromoCode`, `emailShowSnippet` | Extras for the verification email (§5.4, D-20). Only with lead collection on. |
| `maxImagesPerPerson` | How many delivered portraits each person may get. New events start at 10. |
| `printingEnabled` | On or off |
| `maxPrintsPerPerson` | Total prints each person may get for this event, across all their portraits. It is not copies per portrait. New events start at 6. Only used when printing is on. |
| `printerToken` | `<event id>.XXXX-XXXX-XXXX-XXXX`, generated and rotated in the admin UI. Kept visible there, with the server URL and the full agent command, so it can be typed on the printer laptop (D-33). |
| `promo` | `{enabled, text}`. Only possible when printing is on (§5.9). |
| `shareText` | The suggested caption on the share page. `{event}` becomes the event name (D-34). |
| `ctaText` | Headline and steps for the booth screen |

In the admin form, an option that depends on a switched-off setting is ignored when saving (for example the promo when printing is off).

### 4.3 Quota rules
- **What counts toward `maxImagesPerPerson`:** an image counts once it is delivered. Photos still being checked or generated also hold a place, so several photos sent at once cannot go over the limit. A new photo that replaces one still waiting for its menu choice does not use another place.
- **What does not count:**
  - Attempts that were flagged by the AI or rejected by moderation.
  - Delivering a flagged image after an admin approves it.
- **When the quota is reached:** the attendee gets the localized "you've used all your portraits" reply.
- **What counts toward `maxPrintsPerPerson`:** successful prints. A queued print reserves one place until it is printed or finally fails. Once the limit is reached, nothing more is printed for that person; portraits are still delivered digitally.

### 4.4 Deleting an event
- **Trigger:** an admin action that requires typing the event's name to confirm (D-35).
- **What it deletes, immediately, even if not yet expired:**
  - every `ev_<slug>_*` Sync object, including the booth document
  - the event's `bindings` entries
  - its item in `events`
  - all of the event's generated images and selfies in Blob Storage (prefix `events/<slug>/`)
  - the event's uploaded frame and background
- **Conversation Memory:** for every profile linked to the event, remove the event from `profile_links`. If the profile is then linked to no other event, delete the Memory profile as well.
- **Stats** are deleted along with the event.
- Log a structured audit line containing the slug and a timestamp, with no personal data.

---

## 5. Attendee conversation flow

### 5.1 Inbound pipeline
- **Endpoint:** `POST /api/twilio/inbound`, the single inbound webhook for the whole Messaging Service.
- **Before anything else:**
  1. Validate the Twilio signature against `PUBLIC_BASE_URL`.
  2. Check `dedup` for the `MessageSid`; if it is already there, ignore the message.
  3. Detect the channel from the `whatsapp:` prefix.
  4. Answer within a few seconds with an empty TwiML `<Response/>`.
- **Replies** are sent with the REST API from the Messaging Service, after any processing.
- **Long-running work** (generation) goes to the worker. Short state transitions can run in the request.
- **Session state** is stored in `ev_<slug>_sessions`. Fields:
  - `step`: `new`, `awaiting_agree`, `awaiting_name`, `awaiting_email`, `awaiting_code`, `ready`, `screening`, `awaiting_style`, `awaiting_background`
  - `locale`, `optedIn`
  - the pending selfie (a blob path) while consent is open, and `pendingJobId` for the photo being checked or waiting for menu choices
  - chosen style and background
  - `lead` (name and email while the code is open), `memoryProfileId`
  - `pendingDeletionConfirm`, and `pendingSlideshow` (the last unanswered delivery question)
  - the person's delivered portraits (up to 10, newest last) and the last print menu, for printing later (D-28)
  - last inbound time, used for the WhatsApp 24h window
  - counters: delivered, printed, prints reserved, in flight

### 5.2 Mapping messages to an event
1. **The QR code** opens the event's sender with the event's `qrText` pre-filled (§4.2). It names the event, for example `Hi! I'm at SIGNAL London and want to try Portrait Studio 🎨`. There is no hashtag and no code (D-19, D-35).
   - WhatsApp opens `https://wa.me/<number>?text=…`.
   - SMS opens `sms:+<number>?&body=…`.
2. **Event named.** If the message contains the full name of a live event as whole words (ignoring case and accents), the address is bound to that event. The longest name wins, so "SIGNAL London" beats "London". The ID is never matched. The binding lasts until the event is deleted. Naming another live event re-binds the address.
3. **No name, but bound.** If the address is bound to a live event, use it. If it is bound to an ended event and another event is live, ignore that binding and carry on below (D-13).
4. **No name, not bound.**
   - If exactly one event is live, use it and bind the address.
   - If several are live, reply with a picker of the live event names: a WhatsApp list picker (or quick reply buttons for 3 or fewer events), or a numbered list on SMS. The picker is created at runtime inside the 24h window and needs no approval. The answer, by button, number or name, binds the address.
   - If none is live, send the localized standard "no active event" reply.
5. **Named or bound event is not live.** If it is in `break` or `ended`, send that state's reply (§4.1). A draft event is invisible.

### 5.3 Language
- Every customer-facing text is in the event's `language`.
- There is no language picker and no switching.

### 5.4 Consent gate (needed before any selfie is processed)
**Rule:** consent is a gate. Using the app does not imply consent. Someone who has not opted in for this event cannot use the app.
- If a selfie arrives before opt-in, keep it as the pending selfie (store it in Blob Storage under the session).
- After opt-in, continue with that selfie.

**Step 1: look the person up in Conversation Memory** by address. That is phone for SMS, or the WhatsApp address. Check the docs for the identifier types.

**Case A: known profile with a name**
- Send a quick reply: "Welcome back, {firstName}! Tap *I agree* to start." The message also contains the link to the Twilio Privacy Notice (D-19).
- No new email code is needed.
- When they tap I agree: they are opted in. Write a lead record with `method: "returning"` and add the event to `profile_links`.
- A known profile with a name but no verified email, at an event that collects leads: greet them by name, skip the name step, then ask for the email and the code (Case B from step 2).

**Case B: unknown person, lead collection on.** These are the "minimal cycles" from the checklist.
1. Ask for their full name.
2. Ask for their email.
3. Send a Twilio Verify email code. The message that asks for the code must include:
   - the link to the Twilio Privacy Notice (§13, D-19)
   - the statement that entering the code confirms consent, including marketing
   - Use the exact wording from i18n.
   - The email is the user's own template (`apps/web/assets/email/verification-email.html`) and is in English for every event, including Portuguese ones. The Verify call sends only `event_name`, `promo_code` (the event's setting; empty hides the gift block) and `show_snippet` (hides the code snippet and the Verify button when off) (D-20).
4. They reply with the code, and the code is checked with Verify.
   - **Valid code:** they are opted in.
     1. Create or update the Memory profile with name, verified email and the channel address.
     2. Write the lead record (`method: "verified_email"`).
     3. Update `profile_links`.
     4. Ask for the selfie, or continue with the pending one.
   - **Invalid code:** reply with a localized retry message. Verify's attempt limits apply.
   - **Keyword "resend"** (localized) sends a new code.
   - **Never entering a valid code** means they are not opted in and cannot continue.

**Case C: unknown person, lead collection off**
- Send a quick reply with a short notice, the link to the Twilio Privacy Notice, and an *I agree* button.
- When they tap it: they are opted in, and a lead record is written with `method: "agree_only"`.
- No Memory profile is created. Only the lead record is written.

**Declining**
- There is no "decline" path that still uses the app.
- Marketing consent cannot be refused separately. Opting in covers it.

### 5.5 Selfie and options
1. **More than one image:** reply with the localized "one at a time" message. Media that is not a JPEG, PNG or WebP image gets the "not an image" reply. HEIC is not supported; WhatsApp converts photos.
2. **No remaining image quota:** reply with the quota message and discard the photo (§4.3).
3. **Checks first (D-18).** The photo creates its job at once, in state `screening`, and the person gets a short "checking your photo" reply. The worker runs moderation, face detection and scene analysis (§9.2 steps 2–3). A photo that fails is rejected straight away with its §5.6 message, so nobody picks a style for a photo that cannot be used. While checking, other text gets a "still checking" reply.
4. **Style menu**, after the photo passed, and only if the event has more than one style. Sent by the worker.
   - WhatsApp: a list picker created at runtime.
   - SMS: a numbered list.
   - Accept a number, the style name or a localized alias, ignoring case and accents.
   - An invalid answer re-sends the menu.
5. **Background menu**, only if the event has more than one background. Same rules as the style menu. With one style and one background, the job goes straight to generation.
6. **Job started.** Send the localized "started" message, for example "Got it! Your portrait is being created. It'll be ready in about a minute."
7. **A new photo** sent while a photo is being checked, or while its menus are open, replaces that one. The old job ends as rejected and its selfie is deleted; it does not use another place of the quota.

### 5.6 Result messages
| Outcome | Message |
|---|---|
| Delivered | See §6 |
| Moderation flagged | Localized "can't use this photo" message, plus an invitation to send another. Does not count toward quota. |
| No face, or more than 4 people | Localized message ("we need a clear selfie" / "up to 4 people"), plus an invitation to resend. Sent right after the photo, before any menu (§5.5). |
| AI review flagged | Localized "that one didn't turn out great — please send another selfie". The job goes to the admin review list (§10.3). Does not count toward quota. |
| Technical failure after retries | Localized apology plus an invitation to try again |

In every case that is not a delivery the person can send another photo straight away, and the attempt does not count toward the quota.

### 5.7 Admin approval of a flagged image
- When an admin approves a flagged image, it is delivered just like a normal result (§6), together with the question of §5.8.
- If the attendee has already received a newer portrait, they still get both.
- **Outside the WhatsApp 24h window,** the portrait is not sent (§5.11, D-42). The job is still marked approved and delivered, and the admin is told it was not sent.
- Approval does not count toward quota.
- If sending fails, the image stays flagged and Approve can be tried again.

### 5.8 The question after each delivery (D-24)
Nothing is printed or shown automatically. After each delivery, inside the 24h window, one question is sent.
- **Printing on and prints left:** three buttons, **Print + show**, **Show only**, **No thanks**. Printing a portrait also puts it on the booth screen.
- **Printing off, or no prints left:** the plain "Can we show your portrait on the booth screen? Yes / No".
- **Group photos (2–4 people):** the localized text adds that everyone in the photo should agree.
- **Only a yes** adds the image to `ev_<slug>_slideshow`. "No" or no answer means it is not shown or printed.
- **Old buttons keep working**, so an earlier portrait can still be printed later. The buttons carry the job id.
- **SMS has no buttons.** `PRINT`, `YES` and `NO` (localized) answer the last question, and only for 10 minutes: a stray "ok" hours later is not an answer. The keywords are matched in code, never by the model.
- **Printing a portrait you already have (D-28).** A message containing the print word (`print` / `imprimir`) while nothing else awaits an answer lists the person's printable portraits, newest first: one **Print it** button or a numbered list. Choosing one prints it without adding it to the booth screen. On SMS, `PRINT 2` picks the second one listed.
- **Print quota** is reserved when a print is requested, before it is queued, so two taps never print twice (§4.3). A portrait can be printed again once its earlier print is counted, and again after a failure.
- An admin can remove an image from the booth screen at any time (§10.3).

### 5.9 Promo follow-up
- Sent only when printing is on, the promo is enabled, and that job's print **succeeded**.
- The promo text is sent to everyone. There is no marketing opt-out (§5.4).
- It is sent once per printed job, triggered by the print-success event and not by a timer.
- If the attendee is outside the WhatsApp window, skip it and log the skip (§5.11).
- Admin reprints do not trigger a promo (§10.3).

### 5.10 Free text, chatty replies and data deletion
- **When it applies:** any free-text message that is not part of an active step (menus, the consent steps).
- **What it does:** the text goes to the chat model (`OPENAI_CHAT_MODEL`, reasoning effort `none`) with the smart-reply prompt (PROMPTS.md §G1 and §G2 word for word, with the product called Portrait Studio, G2's admin-written extra instructions left out, and a language rule added) (D-29). Context sent to the model:
  - event name
  - enabled style names
  - remaining portraits
  - the user's text
- **Its job:** answer briefly and steer the person to send a selfie. The reply is sent as is (Markdown stripped, at most 600 characters). If the model fails or takes more than 10 s, the person gets the localized selfie prompt instead. The print hint of §5.8 is added to either.
- The print and `PRINT` keywords of §5.8 are handled before the model.

**The one tool the model has: `request_data_deletion`**
- It is called when the user asks to delete their data, in any language.
- The tool does not delete anything. It sets `pendingDeletionConfirm` and sends a quick-reply confirmation: "Delete all your data from this booth? This can't be undone." with **Yes, delete** and **Cancel**.
- **On "Yes, delete"** (the button payload, not free text):
  1. Delete everything belonging to that address across **all events**: sessions, jobs, slideshow entries, print-queue items, share links, leads, bindings, the event picker, and blobs (selfies and generated images). Only the button confirms on WhatsApp; on SMS the exact keyword (`DELETE` / `APAGAR`) right after the question. Anything else cancels (D-30).
  2. Delete the **whole** Conversation Memory profile (traits, identifiers and observations) and its `profile_links` entry, even though the store is shared with other activations (D-12).
  3. Anonymous stats counters stay.
  4. Send a localized confirmation.
  5. Increment the `deletionRequests` stat, once it succeeded.
  - Every step can be repeated safely, so any error stops it without the "done" reply, and confirming again finishes it. A print already at the printer cannot be recalled: its queue item stays until it finishes, and the reply says one print may still come out.
- **Constraints on the model:**
  - It has no other tools. It cannot change settings, styles, quotas or the image model.
  - **It can never change the conversation language.** There is no language tool. The model always replies in the event's `language`, even if the attendee writes in another language or asks it to switch. The system prompt must state this. Add a test where the attendee writes in another language or asks for a different one, and check that the reply stays in the event's language.
  - Its replies never change state, except through the deletion tool.

### 5.11 WhatsApp 24h window
- Every WhatsApp message (including runtime quick replies and list pickers) is sent only inside the 24h window since the person's last inbound message.
- **Outside the window nothing is sent, on purpose (D-42).** A portrait that arrives that late is not worth sending, so there is no approved template to fall back on. The message is skipped and logged (`send_skipped`, `outside-24h-window`), and the portrait stays on its share page. This only happens when generation or an admin approval takes more than a day; normally a portrait is ready in about a minute.

---

## 6. Delivery and share page

### 6.1 Delivery message
- **WhatsApp:** the framed image, plus a localized caption and the share-page link.
- **SMS:**
  - If the recipient's country supports MMS (US, CA, AU; decide by the E.164 country code), send an MMS with the JPEG version (≤ 5 MB) and the share link.
  - Anywhere else, send an SMS with the share-page link only.
- **Media URLs** sent to Twilio are short-lived blob SAS URLs (§7), or an app route that streams the blob.
- **After delivering:**
  - increment the stats
  - count the delivery toward quota
  - send the question of §5.8 (nothing is printed until the person chooses)
- **The send comes first.** The portrait is counted as delivered only once it was sent. If sending fails, the job is retried; if it could not be sent at all (outside the WhatsApp window, §5.11), it is not counted and the share page still works.

### 6.2 Share page `/s/[shareId]` (public)
- `shareId` is an unguessable random ID.
- The page expires when the image expires (7 days) or is deleted. After that it shows a localized "no longer available" page. A portrait taken down by an admin shows "This portrait was removed by the event organizer" (D-16).
- **Page contents:**
  - the image
  - a **Share** button that calls `navigator.share({ files: [File(image.jpg, "image/jpeg")] })` after checking `navigator.canShare`. This opens the phone's share sheet, so the attendee can pick Instagram, LinkedIn, WhatsApp and so on.
  - a **Copy text** button that copies the event's `shareText`, because many apps drop text when an image is attached
  - a **Download** button, which is the fallback when sharing is not supported, for example on desktop
  - a **Print at the booth (N left)** button when the event has printing on and the owner still has prints. Anyone with the link may use it; it takes one of the owner's prints and never adds the portrait to the booth screen (D-26).
- Add OpenGraph tags so a pasted link shows a preview.
- No tracking pixels and no short links.

### 6.3 WhatsApp templates
- **No approved templates (D-42).** Nothing is sent outside the 24h window (§5.11), so the app has none to maintain or to get approved.
- **Quick replies and list pickers** are created at runtime with the Content API, inside the window, and cached in `content_cache`. They need no approval.

---

## 7. Image storage (Azure Blob Storage)

| Container / prefix | Contents | Retention |
|---|---|---|
| `events/<slug>/selfies/` | Normalized selfies | 7 days (lifecycle policy). Deleted when the event is deleted or on a deletion request. |
| `events/<slug>/generated/` | Framed print PNG (1200×1800) and delivery JPEG | 7 days, as above |
| `assets/events/<slug>/` | The event's uploaded frame and background | Never expires. Deleted when the event is deleted. |

- Fixed frames and backgrounds live in the repo under `apps/web/assets/`.
- The 7-day expiry is an Azure lifecycle-management rule, applied by `deploy.sh`. It is added to the account's existing policy and leaves other rules alone.
- Image bytes may sit in process memory only while a job is processing them.
- Twilio and the print agent download images through signed links to the app's `/m/<token>` route, so neither needs storage credentials (D-23). Locally, storage is Azurite.

---

## 8. Styles, backgrounds and frames

### 8.1 Styles (fixed in code)
- Cartoon (Pixar 3D), Pop Art, Watercolor, Anime, Sketch, Pixel Art.
- Their prompts are taken word-for-word from PROMPTS.md §D. Sticker is excluded. Cartoon and anime add one sentence: if glasses hide the eyes, keep the lenses opaque and never draw eyes on them (D-38).
- Each style has localized display names in i18n.
- Events enable a subset of them.

### 8.2 Backgrounds
- **Fixed in code:** gradient, solid white, solid black and original. Prompts are in PROMPTS.md §C.
- **Uploaded:** each event can upload one extra background image, plus its localized name.
- Events enable a subset of all of these.

**How each kind of background is used:**
- **Fixed backgrounds:** the model draws them from the prompt text (PROMPTS.md §C).
- **The uploaded background:** it is composited exactly as uploaded. The model draws only the person.
  1. Call the image model (`OPENAI_IMAGE_MODEL`) with `background: "transparent"` and the exact-mode background prompt (PROMPTS.md §E6, "Exact mode"). The background image itself is **not** sent to the model.
  2. Scale the uploaded background to cover 1024×1536.
  3. Composite the transparent portrait on top, centered.
  4. Apply the frame (§8.3).
- **Validate the upload:** PNG or JPEG, at least 1024×1536, 2:3 aspect ratio or croppable to it.

**Transparency was proven first (D-01, D-02).** `gpt-image-2` rejects `background: "transparent"`. `gpt-image-2.5-flare` produces clean cut-outs and is the model (about 18–21 s per image). It renders the subject at alpha ≈ 253, so when compositing, pixels with alpha ≥ 250 are made fully opaque. This is not a background-removal step. The "20% fully transparent" check was only used in the spike, because tight group shots fall below it.
- **Regression tests:**
  - A unit test for the compositing step, using a fixture PNG that has alpha.
  - A test of the full pipeline with the uploaded background. It runs against the real API, and only when `RUN_LIVE_AI_TESTS=1` is set.

### 8.3 Frames
- **Fixed in code:** `none` and the five Twilio frames in `apps/web/assets/frames/`: `twilio-tab-top`, `twilio-tab-bottom`, `twilio-tab-bottom-left`, `twilio-border-left`, `twilio-border-right`.
- **Uploaded:** each event can upload one frame. It must be a PNG of exactly 1200×1800 (4x6 portrait at 300 DPI) with a transparent window. Format, size and the alpha channel are validated on upload.
- Each event selects exactly one frame.
- **Compositing:**
  1. Find the bounding box of the transparent region (alpha < 128).
  2. Scale the generated portrait to cover that box.
  3. Place the portrait under the frame.
- **Clearance (D-27).** The image model cannot see the frame, so the prompt tells it which edge to keep free. The share of the window that the frame's opaque parts cover at the top and bottom is measured from the PNG (middle 40% of the width). From 8% up, one line is added, rounded up to the next 5% plus a margin. Uploaded frames get the same treatment.
- **Safe zone (D-41).** The DS620 cuts off about 24 px left and right, 30 top and 36 bottom. Logos and text in a frame stay at least 60 px from every edge; shapes that run off the canvas keep doing so. `pnpm --filter web eval:frame-safe-zone` checks it.

### 8.4 LA Kings promotion (D-36)
One switch per event. On, it dresses every portrait in the LA Kings jersey and adds two backgrounds, **Ice rink** and **Crypto.com Arena**; off, those two cannot be chosen. It is a brand definition in code (`lib/brands/la-kings.ts`): three reference images of the outfit, the wardrobe text, and one reference image per scene. The image call sends the selfie, then `brand_ref_0..2.png`, then `bg_ref_0.png`. There is no analysis step. A second brand would be a new definition.

---

## 9. AI pipeline (worker)

### 9.1 Job state machine (`ev_<slug>_jobs`)
A photo is checked before the person chooses anything (D-18):
```
screening → (rejected | awaiting_choice) → queued → processing → (delivered | flagged | rejected | failed)
flagged → approved_by_admin → delivered
delivered → removed_by_admin   (share page off, files deleted, D-16)
```
A job with a single style and background goes from `screening` straight to `queued`. A job waits in `screening` or `queued` between attempts. A discarded flagged image ends as `rejected` with `error: discarded_by_admin`; a photo replaced by a newer one ends as `rejected` with `error: superseded`.

**Job fields:**
- `jobId`, `address`, `channel`, `style`, `background`, `selfieBlob`, `outputBlobs`, `shareId`
- `subjects` and `pet`, found while screening and reused for generation
- `state`, `attempts`, `leaseUntil`, `error`, `aiReview: {reason}` (empty for a pass)
- timestamps for each state

**Leases.** The worker claims a job by setting `processing` and `leaseUntil` (now + 3 min) with `If-Match`, and renews it every minute while it works. If a job's lease has expired, any worker can take it back. A job that passed review keeps a lease until delivery claims it, so a delivery that failed or was lost is picked up again and delivered without generating a second image.

**Retries.** Up to 3 attempts on errors. Back off exponentially with jitter and honor the server's `retry-after` (read from the OpenAI error's headers).

### 9.2 Steps
1. **Normalize the selfie:** accept JPEG, PNG or WebP up to 20 MB. Auto-rotate it, then re-encode it as JPEG. Photos still being checked count toward the quota (§4.3).
2. **Moderation:** `omni-moderation-latest`. If the image is flagged, the job ends as `rejected` (moderation). If the call errors, retry; after the retries are used up, the job `failed` (fail closed).
3. **Face detection and scene analysis**, run in parallel on the vision model, with the prompts from PROMPTS.md §A1 and §A2. Steps 2–3 run in `screening`, before any menu (§5.5).
   - If the scene analysis can't be parsed, retry, then fail. Never default to "1 subject".
   - 0 faces → `rejected` (no face).
   - More than 4 subjects → `rejected` (too many people).
   - 1–4 subjects → the scene (`subjects`, `pet`) is stored and the menus open.
4. **Build the prompt** (§9.3), once the person has chosen.
5. **Generate:** `images.edit` with:
   - model `OPENAI_IMAGE_MODEL` (`gpt-image-2.5-flare`, D-01)
   - input: the selfie, then, with the LA Kings promotion, the reference images (§8.4)
   - size 1024×1536, quality high, PNG output
   - if the event's uploaded background is chosen, add `background: "transparent"` (§8.2)
   - `input_fidelity` is not sent: the model rejects it.
   - If the API rejects the image for safety reasons, the job is `rejected` permanently.
6. **Background, frame and resize:**
   - If the uploaded background was chosen, composite the transparent portrait onto it (§8.2).
   - Composite with the event's frame (§8.3), unless the frame is `none`.
   - Resize to 1200×1800 at 300 DPI and save as PNG for printing.
   - Save a JPEG of 5 MB or less for delivery.
   - Upload both to Blob Storage.
7. **AI review:** PROMPTS.md §B1 with its five criteria that apply without brand references (likeness, subject count, gender accuracy, key accessories, anatomy; D-15), plus the generation prompt as context. Images sent: the selfie and the output.
   - **PASS** → deliver (§6).
   - **FAIL** → `flagged`; send the "please send another selfie" message (§5.6).
   - **Error** → retry, then fail. Never pass by default.

### 9.3 Prompt assembly
- **Built from these parts, in this order:**
  1. style prompt (§D), with `{preserve}` and `{composition}` taken from the defaults in §C. One composition everywhere: chest up, never waist up.
  2. scene line (§E3)
  3. with the LA Kings promotion: the brand block (§E4) after the scene line, and its scene (§E6, AI mode) in place of the background
  4. background (§E6, or the plain background-choice prompt)
  5. **top margin (D-40), always:** keep the top 10% of the image free. Every head, all hair, hats, goggles and raised hands, and any readable sign, building name or logo, must start below that strip.
  6. frame clearance (D-27), only when the frame covers 8% or more of an edge
  7. with the promotion: the style lock (§E10)
  8. final reminder (§E11)
- **Left out entirely** (out of scope): container (§E5), palette (§E7), caricature (§E8), reviewer feedback (§E9) and landscape (§E12).
- Prompts are code, not admin settings. Image-generation prompts are in English.
- A snapshot test covers each style × background combination.
- **The top margin is checked by an eval** (D-40): `pnpm --filter web eval:top-clearance` generates portraits and asks a vision model whether anything important reaches into the top 10%. It costs about $3 and is run when the prompt, the styles, the brand scenes or the image model change.

### 9.4 Models (environment variables, no admin UI)
| Purpose | Variable | Default |
|---|---|---|
| Image generation | `OPENAI_IMAGE_MODEL` | `gpt-image-2.5-flare` |
| Face, scene and AI review | `OPENAI_VISION_MODEL` | `gpt-6.1-sol`, reasoning effort `low` (it does not accept `none`, D-14) |
| Chat replies and the deletion tool | `OPENAI_CHAT_MODEL` | `gpt-6-luna`, reasoning effort `none` |

- The image model never changes at runtime. There is no fallback model and no switch for transparency.
- Moderation always uses `omni-moderation-latest`.

---

## 10. Web app surfaces (Next.js)

### 10.1 Auth
- **Basic auth** (`ADMIN_USER` and `ADMIN_PASSWORD` environment variables), enforced in `proxy.ts` (Next.js's middleware). It covers `/admin/**` and `/booth/**`, and fails closed when the variables are not set. Server Actions check the admin again.
- **Public routes:**
  - `/api/twilio/*` (Twilio signature required)
  - `/s/*`
  - `/m/*` (signed media links, §7)
  - `/api/agent/*` (per-event printer token, compared in constant time)
  - `/healthz`, `/healthz/ready`
- **Admin forms** use Server Actions with CSRF protection (Next.js Server Actions check the Origin header; keep that on).
- Secrets never reach the client.

### 10.2 Admin: events
- A list of events with their state.
- Create and edit events (all the fields in §4.2), with zod validation.
- State buttons: Go live, Break, End, Back to draft.
- Upload the frame and background, with previews.
- The event page has five sections: Event, Booth screen and QR code, Portraits, Printing, Lead collection. Printing shows the printer token (it stays visible, with a ready-to-copy agent command, §11.1, D-33) and the printer's status.
- Delete an event, confirmed by typing its name (§4.4, D-35).

### 10.3 Admin: review (per event)
- **Flagged tab:** shows the selfie, the output, and the AI's reason.
  - **Approve & send** delivers the image (§5.7).
  - **Discard.** The image ends as rejected, with the admin's decision as the reason.
- **Delivered tab:**
  - **Remove** (with a confirmation) is a full takedown (D-16): the portrait leaves the booth screen at once, a print that has not started is cancelled (one already printing cannot be recalled, and the admin is told), the selfie and both output files are deleted immediately, and the share link shows "removed by the event organizer". If a file could not be deleted, Remove can be run again.
  - **Remove from the print queue**, if the job is not printed yet.
  - **Reprint.** It does not count toward the person's print quota and sends no promo.
- Each action is logged without personal data. The log does not carry the admin's name.

### 10.4 Booth screen `/booth/[slug]`
- A full-screen, kiosk-friendly page that updates live. The browser uses the Twilio Sync client SDK with a 1-hour read-only token from `/booth/<slug>/token`, limited to the event's booth document and slideshow (D-17). Sync pushes changes; nothing is polled. The token is refreshed before it expires.
- **live:**
  - the event's CTA text and steps
  - one QR code for `leadChannel`
  - a slideshow of the consented images in `ev_<slug>_slideshow`, auto-advancing
  - images removed or deleted disappear from the slideshow at once
- **break:** the "We'll be right back" screen. **ended:** the "Event ended" screen. It switches automatically when the state changes; if the event is deleted or goes back to draft, the screen stops showing the QR code.
- If the network drops, keep showing the last state and reconnect with back-off.
- Localized in the event's language.

### 10.5 Stats `/admin/events/[slug]/stats`
- **Counters, in `ev_<slug>_stats`.** They contain no personal data. Never use Twilio logs as a source.
  - total interactions (inbound messages)
  - unique opted-in users
  - leads collected, split into verified email, returning and agree-only
  - images requested and delivered
  - flagged, rejected and failed
  - approved by admin
  - prints succeeded and failed
  - images per style and per background
  - slideshow consents (yes)
  - deletion requests
  - average time from selfie to delivery
- Show `lastResetAt`. The page also shows the average delivery time, the funnel, counts per style and background, and the print agent's status (offline after 45 s without a heartbeat) (D-31).
- **Leads export is a script, not a download** (D-31): `pnpm --filter web leads:export [--event <slug>] [--out <file>]`. Without `--event` it lists the events and asks for one. It reads `ev_<slug>_leads` to get the profile IDs, then fetches name, email and channel address **from Conversation Memory**. The CSV has name, email, phone, WhatsApp, opt-in time and method; agree-only leads and deleted profiles have empty contact fields. Cells a spreadsheet would run as a formula are prefixed with `'`. It writes to `exports/` (git-ignored, folder `0700`, file `0600`) and never overwrites a file.
- **Reset script:** `pnpm --filter web stats:reset --event <slug>`. It zeroes the counters and writes `lastResetAt`. Running it is also logged.

### 10.6 Privacy notice
There is no privacy page of our own (D-19). Every consent message and the verification email link the Twilio Privacy Notice, `https://www.twilio.com/en-us/legal/privacy`.

### 10.7 Health
- `/healthz` reports liveness.
- `/healthz/ready` checks that Sync and Blob Storage can be reached.

---

## 11. Print agent (`apps/print-agent`)

### 11.1 Distribution and running
- **A plain Node.js 24+ script, never a compiled binary or app bundle**, so macOS Gatekeeper never asks for anything.
- **Nothing to install at runtime.** The `twilio-sync` SDK is shipped as a pre-bundled single file, `dist/agent.mjs` (esbuild). It was checked on real Node (D-22): the bundle needs a `createRequire` banner, and CI starts the built bundle so this cannot regress. There is no polling fallback.
- **How it is started:**
  ```
  node agent.mjs --url https://<app> --token <event printer token> [--printer <CUPS queue>] [--simulate --out ./prints]
  ```
  The admin UI shows this command with the values filled in (D-33).
- **Printer doctor.** `node agent.mjs doctor [--fix]` checks the CUPS queue (driver, paused or rejecting queue, the defaults below) and repairs what it can.
- No auto-start at login (decided).
- macOS with CUPS is the tested platform. Windows printing is a beta, not yet tested on a real booth PC. Linux printing is a known gap (`TODO(linux)`).

### 11.2 Behavior
- **Auth.** The agent exchanges its printer token at `/api/agent/token` for a Sync token for the identity `printer:<slug>`. That token can read and write only `ev_<slug>_print` and `ev_<slug>_printer`; everything else is denied. An unknown event, a rotated token and printing switched off all return the same 401. The agent refreshes the token before it expires (D-23).
- **One printer per event.** It must be a DNP DS620 using 4x6 paper.
- **Print command:** `lp -d <queue> -o PageSize=dnp6x4 -o Cutter=Normal -o Finish=Glossy -o Resolution=300x300dpi`, plus `fit-to-page` and `print-scaling=fill` so the print is borderless. Confirmed on paper: no white edge and nothing cropped (the printer itself cuts a few millimetres, §8.3). The doctor sets these as the queue's defaults.
- **One print, one copy (D-25).** A print is submitted to CUPS once, and its request id is stored on the item (`printerJobId`). After that the agent only waits for that job or cancels it. A printer that is off, paused or out of paper is a reason to wait: the agent keeps its lease and takes nothing new. Done means IPP `job-state = completed`. Before any retry or final failure the CUPS job is cancelled. A job that stalls for 10 minutes while the printer reports ready counts as an error.
- **Printer health.** Check the queue regularly for offline, paused, out-of-paper and error states. Report the status and a heartbeat every 15 seconds to `ev_<slug>_printer`. The admin UI and stats show it.
- **Job flow:**
  1. Claim the item with the SDK's compare-and-set (`mutate`) and set a lease (2 minutes, renewed every 30 seconds while printing).
  2. Download the PNG from the signed link on the item (D-23).
  3. Print it and wait for the CUPS job to finish.
  4. Report the result:
     - **Success:** mark it `printed`. If that write keeps failing, the item stays `printing` with its `printerJobId` and the next start records it, so a copy is never printed twice. The server then counts it and sends the promo (§5.9).
     - **Failure:** retry up to 3 times, then mark it `failed`. The attendee already has the image digitally, so they are not sent anything.
  The agent reads the first 100 items of the queue per look (`TODO(print-queue-pagination)`).
- **Stuck jobs.** The server (`lib/pipeline/prints.ts`) puts a `claimed` item, or a `printing` item without a `printerJobId`, whose lease ran out 5 minutes ago back to `queued`, or fails it after 3 attempts. A `printing` item that has a `printerJobId` is never requeued, because that copy may already be on paper; the next agent resumes it.
- **Settlement.** The server counts successful prints toward `maxPrintsPerPerson`, releases the reservation of a failed one, and sends the promo once per printed job. An item that does not parse is skipped and logged, so one bad item cannot stop it.
- **Simulator (`--simulate`).** No printer is needed. "Printing" writes the PNG to `--out` with a short delay. This mode is the required hardware simulator. Real prints also keep a copy of every print in the output folder.
- **Network drops.** Reconnect with back-off (1 s, doubling to 60 s while connecting keeps failing, starting over after a session that lasted a minute) and carry on with items that are still queued. With no successful heartbeat for 60 seconds the agent drops the session and starts a fresh one with a new token; a print at the printer is resumed (D-32).
- Logs go to the console as readable lines.

### 11.3 Print job item (`ev_<slug>_print`)
Fields:
- `jobId`
- `blobPath`, and `url`, the signed download link
- `state`: `queued`, `claimed`, `printing`, `printed` or `failed`
- `printerJobId` once submitted, `attempts`, `leaseUntil`, `error`
- `reprint` (an admin reprint: no quota, no promo), `settledAt` (set by the server once counted)
- `who`: the masked address
- timestamps for each state

Personal data is not allowed. Use a masked address at most. The item expires after 7 days.

---

## 12. Localization
- **Locales:** `en` and `pt_BR`. Each event has a fixed language.
- **What is localized:** every customer-facing string. That includes:
  - messages, menu texts and button labels
  - booth screen and share page
  - style and background display names
  - error replies
- All of it lives in typed catalogs, e.g. `apps/web/i18n/en.ts` and `pt_BR.ts`. The type system must make it impossible to leave a key missing in one of them.
- The admin UI is in English only.
- The verification email is the exception: it is the user's own English template for every event (D-20).
- Prompts sent to the AI are in English. Chat replies must be given in the event's language.

---

## 13. Compliance mapping
| Requirement | Where it is handled |
|---|---|
| Containerized (Dockerfile, container deploy) | §3, §14 |
| README, `.env.example`, and where to get each value | §14 |
| Easy start (few cycles, GDPR note) | §5.2 (QR prefill names the event, no picker when one event is live), §5.4 (Case B has 3 replies: name, email, code) |
| Break / Event-ended modes, with adapted replies | §4.1, §10.4 |
| KISS (1–2 minutes) | §5.5 (menus skipped when there is one option), §9 |
| Multilingual | §12 |
| Real-life test | §16 |
| Simulator | §11.2 `--simulate` |
| Disposal date | Not used (the user's decision). Events are ended and deleted by hand (§4.4). Images expire after 7 days (§7). |
| Offline / network handling | Applies only to the booth screen and print agent: they reconnect and resume (§10.4, §11.2). Not relevant otherwise (the user's decision). |
| Stats that persist, without personal data, plus a reset script | §10.5 |
| Twilio resources documented, setup automated, no Serverless | §15 |
| Privacy notice when data is collected | §5.4, §10.6 (every consent message links the Twilio Privacy Notice) |
| Consent and withdrawal | §5.4 (consent as a gate), §5.10 (deletion request) |

---

## 14. Configuration and documentation

**README.md** covers:
- an architecture overview
- local development (docker compose, an ngrok-style tunnel for webhooks, the agent with `--simulate`)
- deploying to Azure Container Apps
- how to set up the Twilio resources (§15)
- how to run the tests, the opt-in live tests and the two evals
- the other scripts
- the full environment variable table (below)

The real-life test checklist (§16) belongs with it.

**Environment variables** (`.env.example`). For each one, explain where to find the value or how to obtain it.

| Variable | Purpose |
|---|---|
| `PUBLIC_BASE_URL` | Public HTTPS origin. Used for webhooks, the share page and signature validation. |
| `ADMIN_USER`, `ADMIN_PASSWORD` | Basic auth |
| `TWILIO_ACCOUNT_SID` | Twilio account |
| `TWILIO_AUTH_TOKEN` | Webhook signature validation |
| `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET` | REST API calls and Sync access tokens |
| `TWILIO_MESSAGING_SERVICE_SID` | The Messaging Service with all SMS and WhatsApp senders |
| `TWILIO_SYNC_SERVICE_SID` | Sync Service |
| `TWILIO_VERIFY_SERVICE_SID` | Verify Service with the email channel set up (SendGrid integration and template) |
| `TWILIO_MEMORY_STORE_ID` | Conversation Memory store |
| `OPENAI_API_KEY`, `OPENAI_IMAGE_MODEL`, `OPENAI_VISION_MODEL`, `OPENAI_CHAT_MODEL` | OpenAI |
| `AZURE_STORAGE_CONNECTION_STRING`, `AZURE_STORAGE_CONTAINER` | Blob Storage. Empty locally: compose then uses Azurite. |
| `MEDIA_SIGNING_SECRET` | Signs the `/m/<token>` media links (§7) |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | Keeps Server Action IDs valid across replicas and deploys |
| `WORKER_CONCURRENCY` | Jobs a worker runs at once (1–8, default 2) |
| `LOG_LEVEL` | Logging |

The authoritative list, with defaults, is `apps/web/lib/env.ts` and `.env.example`.

---

## 15. Twilio resources and setup automation

**Documented in the README:**
- **Messaging Service:**
  - its senders: SMS numbers and WhatsApp senders, which must be registered in the WhatsApp self-sign-up flow
  - the inbound request URL `PUBLIC_BASE_URL/api/twilio/inbound`
  - a status callback, if you use one
- **Sync Service.**
- **Conversation Memory store:** its identifiers for phone and WhatsApp, and its traits (first name, last name, email).
- **Verify Service** with the email channel: a SendGrid API key, a dynamic template in EN and PT, and the Verify email integration.

**Script `pnpm --filter web setup:twilio`** (D-39). It is safe to run again and never creates a second copy: a SID in the environment pins its resource (one that does not exist stops the run), otherwise it finds by exact name (`Portrait Studio`, `--name` to change); two with the same name stop the run. It:
1. creates or finds the Sync Service, the Verify Service and the Memory store (a store it did not create, such as the shared one, is only checked)
2. sets the Messaging Service's inbound URL. It never takes the URL from another app without `--take-over-inbound`.
3. prints the environment variable values to copy

`--dry-run` reports and changes nothing.

Steps that can only be done in the Console (for example WhatsApp sender registration, or the Memory store if no API exists) are listed in the README as manual steps.

No TwiML Bins, Functions or Studio. If the app ever needs static TwiML, it serves it from its own route.

---

## 16. Testing

**Unit tests (vitest, `pnpm test`):**
- the prompt builder, with a snapshot per style × background, and the top margin and frame clearance lines
- the conversation state machine, covering every branch in §5
- event routing
- quota rules
- i18n completeness
- Sync conditional-update retry
- frame compositing, background compositing with a transparent portrait (§8.2), and the frame clearance measurement
- the chat reply always stays in the event's language (§5.10)
- CUPS command building and the print agent's claim, retry and reconnect logic

**Integration tests (vitest):** the webhook handler, the worker, delivery, review and print requests, using mocked Twilio, OpenAI and Sync. The print agent against a fake queue.

**End-to-end:** Playwright tests (`pnpm test:e2e`) for the admin pages, the booth screen and the share page, with in-memory Sync and Blob, so they need no credentials.

**Live tests (opt-in, real services from `.env.local`):**
- `RUN_LIVE_AI_TESTS=1`: the full pipeline with the uploaded background and the LA Kings scene (§8.2, §8.4), the chat replies, and the judge behind the top-margin eval. About $0.20.
- `RUN_LIVE_SYNC_TESTS=1`: Sync storage, the booth push and the scope of the agent token.
- `RUN_LIVE_INBOUND_TESTS=1` and `RUN_LIVE_DELIVERY_TESTS=1`: send **real** messages.

**Evals (opt-in, not part of `pnpm test`):**
- `pnpm --filter web eval:top-clearance`: generates portraits and checks that nothing important reaches into the top 10% (§9.3, D-40). About $3.
- `pnpm --filter web eval:frame-safe-zone`: checks that frames keep logos 60 px from every edge (§8.3, D-41). Free.

**Real-life test checklist.** Run it after every major upgrade:
- At least 5 team members from different regions, on both WhatsApp and SMS, including the region where the activation will run.
- Several players at the same time.
- Check the following:
  - the break and ended modes
  - a deletion request
  - admin approval of a flagged image
  - a portrait with the event's uploaded background, and one with the LA Kings jersey
  - printing from the chat ("Print + show", then `PRINT` later) and from the share page, with a real DS620 and with `--simulate`
  - the booth screen on a landscape and a portrait display
