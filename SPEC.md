# AI Photo Booth V2: Build Specification

## 0. Read this first

**What you are building.** A rebuilt AI photo booth for events.
- Attendees scan a QR code and send a selfie by WhatsApp or SMS.
- They get back a stylized AI portrait.
- If the event has a printer, the portrait is also printed at the booth.

**Inputs you have:**
- **This document.** It is the source of truth. It records the product owner's decisions.
- **`PROMPTS.md`** (in the same folder). It holds the AI prompts taken word-for-word from V1. Reuse the sections named in §9.
- **V1 lives in a different repo.** Do not copy its architecture. It is useful only as an example of what not to do (see §1.3).

**Rules for you, the agent:**
1. **Ask before guessing.** If anything here is ambiguous, contradictory or missing, stop and ask the user. Do not pick an answer silently. Questions that are already known are listed in §17. Ask them before you build the parts they affect.
2. **Keep decisions fixed.** Do not change a decision in this document without the user's approval. That includes adding features that are "out of scope" (§2.2).
3. **Before relying on a Twilio or OpenAI API, check the current documentation.** This matters most for Conversation Memory, Sync conditional updates, Verify email, and the `twilio-sync` SDK running in Node. If the docs contradict this spec, ask the user.

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
- A slideshow consent question after delivery (§5.8)
- Optional printing with a Node print agent (DNP DS620, 4x6) and a simulator mode (§11)
- A promo follow-up after a successful print (§5.9)
- Event states: draft, live, break and ended. Event deletion wipes all data (§4)
- A booth screen with QR code and CTA, break and ended screens, and a slideshow (§10.4)
- A per-event stats page, CSV lead export and a stats reset script (§10.5)
- Deletion requests detected by an LLM tool, with a confirmation step (§5.10)
- Chatty LLM replies to free text (§5.10)
- English and Brazilian Portuguese (§12)
- Docker, README, `.env.example`, Twilio setup automation and a real-life test checklist (§14–§16)

### 2.2 Out of scope (do not build)
- **Channels and entry points:** phone calls and voice, the web kiosk, the `/start` landing page.
- **Image features dropped from V1:**
  - brands
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
/apps/web            Next.js app (App Router, TypeScript): admin, booth screen, share page, privacy page, webhooks, agent API
/apps/web/worker     Background worker entry point (same codebase, separate process — see 3.2)
/apps/print-agent    Node.js print agent (separate project, see §11)
/README.md           Setup guide (§14)
/.env.example
/Dockerfile          Image for the web app and worker
```

**Shared code.** Do not create a third package unless you need one.
- The agent ↔ server protocol is small. Document it in `apps/print-agent/PROTOCOL.md`.
- If you share types between the projects, ask the user first. They asked for two projects.

### 3.2 Runtime processes
| Process | Responsibilities |
|---|---|
| **web** (Next.js, Node runtime) | Webhooks, admin UI, booth screen, share page, privacy page, agent API, Sync token endpoints |
| **worker** (same Docker image, started with a different command) | Runs generation jobs and timed follow-ups. Long-running work never runs inside a webhook request. Picks up work by watching or polling Sync, and claims each job with a Sync conditional update (§3.4). |
| **print-agent** (on the booth computer) | Pulls and prints the event's print jobs (§11) |

- Locally: use `docker compose` with a `web` service and a `worker` service.
- On Azure Container Apps: run web and worker as two containers in one Container App, or as two Container Apps built from the same image. Document both options in the README.

### 3.3 External services
| Service | Used for |
|---|---|
| Twilio Messaging Service | One service holding several SMS and WhatsApp senders. All inbound traffic goes to one webhook, so the channel an attendee uses does not matter. |
| Twilio Content API | Quick replies and list pickers created at runtime, plus one approved WhatsApp delivery template (§6.3) |
| Twilio Sync | All application state (§3.4) |
| Twilio Conversation Memory | Recognizing attendees across events. Stores name, verified email and channel addresses. It is the source for lead exports. |
| Twilio Verify, email channel (via SendGrid) | Email verification code during lead collection |
| OpenAI | Moderation, vision checks, image generation, AI review and chat replies (§9) |
| Azure Blob Storage | Selfies, generated images, uploaded frames and backgrounds (§7) |

### 3.4 Sync data model
Use one Sync Service per deployment. Sync limits:
- 16 KB per item.
- About 20 writes per second per object, with 10-second bursts.

**Object types:**
- **Global objects** (`events`, `bindings`, `dedup`, `content_cache`, `profile_links`) hold small items shared by all events.
- **Per-event objects** start with `ev_<slug>_`. They are deleted together with the event.

| Object | Kind | Key → Value |
|---|---|---|
| `events` | Map | `slug` → event config (§4.2) |
| `bindings` | Map | `channel:address` → `{eventSlug, boundAt}`. Removed when the event ends or is deleted. |
| `dedup` | Map, items with TTL (~24h) | `MessageSid` → `{receivedAt}` |
| `content_cache` | Map | hash of the content definition → Content SID, for quick replies and list pickers created at runtime |
| `profile_links` | Map | `memoryProfileId` → `{events: [slug…]}`. Used to decide whether a Memory profile can be deleted (§4.4). |
| `ev_<slug>_sessions` | Map | `channel:address` → conversation state (§5.1) |
| `ev_<slug>_jobs` | Map | `jobId` → job (§9.1) |
| `ev_<slug>_print` | Map | `jobId` → print job (§11.3). The print agent's token is scoped to this map and `ev_<slug>_printer` only. |
| `ev_<slug>_printer` | Document | Agent heartbeat and printer status |
| `ev_<slug>_leads` | Map | `channel:address` → `{memoryProfileId, optedInAt, method: "verified_email" \| "returning" \| "agree_only"}` |
| `ev_<slug>_slideshow` | Map | `jobId` → `{blobPath, addedAt}` |
| `ev_<slug>_stats` | Map | metric → counter, plus `lastResetAt` (§10.5) |

**Concurrency.**
- Every read-modify-write uses the Sync revision with `If-Match`. On a conflict, re-read and retry.
- This is how jobs are claimed and quota is counted.
- Before relying on it, verify that Sync supports conditional updates on map items.

**Rate limits.**
- 10 new attendees per second per event is acceptable for now.
- Every Sync rate-limit response (HTTP 429 / error 54009) must produce a structured `WARN` log line that includes the object name, so a bottleneck shows up in the logs.
- Add `TODO(scalability)` comments at the stats counters and the jobs map noting that these are the expected hot spots.

---

## 4. Events

### 4.1 States (switched by hand in the admin UI only)
| State | What attendees get | Booth screen |
|---|---|---|
| `draft` | Treated as not live: the event is not routable and not in the event picker | — |
| `live` | The full flow | QR code + CTA + slideshow |
| `break` | Any message gets the localized "We'll be right back" reply | Break screen |
| `ended` | Any message gets the localized "This event has ended" reply. Bindings to the event are removed. | Ended screen |

### 4.2 Event configuration (edited in the admin UI)
| Field | Notes |
|---|---|
| `name` | Display name |
| `slug` / event code | Unique, URL-safe. Also used as the code in the QR prefill text (§5.2). Cannot be changed after creation. |
| `state` | See §4.1 |
| `language` | `en` or `pt_BR`. Every customer-facing message and screen for this event uses it. |
| `leadChannel` | `whatsapp` or `sms`. Decides which single QR code the booth screen shows. |
| `qrSender` | Which sender (phone number) from the Messaging Service the QR code opens. Fetch the list of senders from the Twilio API. |
| `styles` | The enabled subset of the fixed styles (§8.1), at least one. If only one is enabled, the style menu is skipped. |
| `backgrounds` | The enabled subset of the fixed backgrounds plus the optional uploaded one (§8.2), at least one. If only one is enabled, the background menu is skipped. |
| `frame` | Exactly one frame: a fixed frame, `none`, or the event's uploaded frame (§8.3) |
| `leadCollection` | On or off (§5.4) |
| `maxImagesPerPerson` | How many delivered portraits each person may get |
| `printingEnabled` | On or off |
| `maxPrintsPerPerson` | Total prints each person may get for this event, across all their images. It is not copies per image. Only used when printing is on. |
| `printerToken` | Generated and rotated in the admin UI. Kept visible there, so it can be typed in on the printer laptop (D-33). |
| `promo` | `{enabled, text}`. Only possible when printing is on (§5.9). |
| `shareText` | The suggested caption on the share page, in the event's language |
| `ctaText` | Headline and steps for the booth screen |

### 4.3 Quota rules
- **What counts toward `maxImagesPerPerson`:** an image counts once it is delivered.
- **What does not count:**
  - Attempts that were flagged by the AI or rejected by moderation.
  - Delivering a flagged image after an admin approves it.
- **When the quota is reached:** the attendee gets the localized "you've used all your portraits" reply.
- **What counts toward `maxPrintsPerPerson`:** successful prints. Once the limit is reached, new images are still delivered digitally but are not printed.

### 4.4 Deleting an event
- **Trigger:** an admin action that requires typing the slug to confirm.
- **What it deletes, immediately, even if not yet expired:**
  - every `ev_<slug>_*` Sync object
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
  - `step`
  - `locale`
  - pending selfie, as a blob path
  - chosen style and background
  - `pendingDeletionConfirm`
  - last inbound time, used for the WhatsApp 24h window
  - counters

### 5.2 Mapping messages to an event
1. **The QR code** opens the event's sender with prefilled text in the event's language. The text includes the event code.
   - Example: `Hi! I want my AI portrait 🎨 #SPLONDON`.
   - The prefilled text comes from i18n.
   - WhatsApp opens `https://wa.me/<number>?text=…`.
   - SMS opens `sms:<number>?&body=…`; handle the iOS/Android format.
2. **Code present.** If the message contains the code of a live event, the address is bound to that event. The binding lasts until the event ends or is deleted. A new code for another live event re-binds the address.
3. **No code, but bound.** If the address is already bound to a live event, use that event.
4. **No code, not bound.**
   - If exactly one event is live, use it and bind the address.
   - If several are live, reply with a picker of the live event names: a WhatsApp list picker (or quick reply when there are 3 or fewer events), or a numbered list on SMS. The picker is created at runtime inside the 24h window and needs no approval. The answer binds the address.
   - If none is live, send the localized standard "no active event" reply.
5. **Bound event is not live.** If the bound event is in `break` or `ended`, send that state's reply (§4.1).

### 5.3 Language
- Every customer-facing text is in the event's `language`.
- There is no language picker and no switching.

### 5.4 Consent gate (needed before any selfie is processed)
**Rule:** consent is a gate. Using the app does not imply consent. Someone who has not opted in for this event cannot use the app.
- If a selfie arrives before opt-in, keep it as the pending selfie (store it in Blob Storage under the session).
- After opt-in, continue with that selfie.

**Step 1: look the person up in Conversation Memory** by address. That is phone for SMS, or the WhatsApp address. Check the docs for the identifier types.

**Case A: known profile with a name**
- Send a quick reply: "Welcome back, {firstName}! Tap *I agree* to start." The message also contains the privacy notice link.
- No new email code is needed.
- When they tap I agree: they are opted in. Write a lead record with `method: "returning"` and add the event to `profile_links`.
- See §17, Q4, for a known profile that has no verified email while this event has lead collection on.

**Case B: unknown person, lead collection on.** These are the "minimal cycles" from the checklist.
1. Ask for their full name.
2. Ask for their email.
3. Send a Twilio Verify email code. The message that asks for the code must include:
   - the GDPR/privacy notice summary and link (§13)
   - the statement that entering the code confirms consent, including marketing
   - Use the exact wording from i18n.
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
- Send a quick reply with a privacy notice summary, the link, and an *I agree* button.
- When they tap it: they are opted in, and a lead record is written with `method: "agree_only"`.
- No Memory profile is created. See §17, Q4.

**Declining**
- There is no "decline" path that still uses the app.
- Marketing consent cannot be refused separately. Opting in covers it.

### 5.5 Selfie and options
1. **More than one image:** reply with the localized "one at a time" message.
2. **No remaining image quota:** reply with the quota message.
3. **Style menu**, only if the event has more than one style.
   - WhatsApp: a list picker created at runtime.
   - SMS: a numbered list.
   - Accept a number, the style name or a localized alias, ignoring case and accents.
   - An invalid answer re-sends the menu.
4. **Background menu**, only if the event has more than one background. Same rules as the style menu.
5. **Job created.** Send the localized "started" message right away, for example "Got it! Your portrait is being created — it'll be ready in about a minute."
6. **A new selfie** sent while a menu is pending replaces the pending selfie.

### 5.6 Result messages
| Outcome | Message |
|---|---|
| Delivered | See §6 |
| Moderation flagged | Localized "can't use this photo" message, plus an invitation to send another. Does not count toward quota. |
| No face, or more than 4 people | Localized message ("we need a clear selfie" / "up to 4 people"), plus an invitation to resend. |
| AI review flagged | Localized "that one didn't turn out great — please send another selfie". The job goes to the admin review list (§10.3). Does not count toward quota. |
| Technical failure after retries | Localized apology plus an invitation to try again |

### 5.7 Admin approval of a flagged image (later)
- When an admin approves a flagged image, it is delivered just like a normal result (§6), together with the slideshow question.
- If the attendee has already received a newer portrait, they still get both.
- **Outside the WhatsApp 24h window,** use the approved delivery template (§6.3).
- Approval does not count toward quota.

### 5.8 Slideshow consent (after each delivery)
- Send a quick reply: "Can we show your portrait on the booth screen? Yes / No".
- **For group photos (2–4 people)** the localized text adds that everyone in the photo should agree.
- **Only "Yes"** adds the image to `ev_<slug>_slideshow`. "No" or no answer means it is not shown.
- An admin can remove an image from the slideshow at any time.

### 5.9 Promo follow-up
- Sent only when printing is on, the promo is enabled, and that job's print **succeeded**.
- The promo text is sent to everyone. There is no marketing opt-out (§5.4).
- It is sent once per printed job, triggered by the print-success event and not by a timer.
- If the attendee is outside the WhatsApp window, skip it and log the skip. Do not create a template for it unless the user asks.

### 5.10 Free text, chatty replies and data deletion
- **When it applies:** any free-text message that is not part of an active step (menus, the consent steps).
- **What it does:** the text goes to the chat model with the smart-reply prompt (PROMPTS.md §G1, plus a localized version based on §G2). Context sent to the model:
  - event name
  - enabled style names
  - remaining portraits
  - the user's text
- **Its job:** answer briefly and steer the person to send a selfie.

**The one tool the model has: `request_data_deletion`**
- It is called when the user asks to delete their data, in any language.
- The tool does not delete anything. It sets `pendingDeletionConfirm` and sends a quick-reply confirmation: "Delete all your data from this booth? This can't be undone." with **Yes, delete** and **Cancel**.
- **On "Yes, delete"** (the button payload, not free text):
  1. Delete everything belonging to that address across **all events**: sessions, jobs, slideshow entries, print-queue items, leads, bindings, and blobs (selfies and generated images).
  2. Delete the person's Conversation Memory profile and remove its `profile_links` entry.
  3. Anonymous stats counters stay.
  4. Send a localized confirmation.
  5. Increment the `deletionRequests` stat.
- **Constraints on the model:**
  - It has no other tools. It cannot change settings, styles, quotas or the image model.
  - **It can never change the conversation language.** There is no language tool. The model always replies in the event's `language`, even if the attendee writes in another language or asks it to switch. The system prompt must state this. Add a test where the attendee writes in another language or asks for a different one, and check that the reply stays in the event's language.
  - Its replies never change state, except through the deletion tool.

### 5.11 WhatsApp 24h window
- Free-form messages (including runtime quick replies and list pickers) are sent only inside the 24h window since the person's last inbound message.
- Outside the window, only the approved delivery template is sent (§6.3). Anything else is skipped and logged.

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
  - if printing is on and print quota remains, enqueue a print job (§11)
  - send the slideshow question (§5.8)

### 6.2 Share page `/s/[shareId]` (public)
- `shareId` is an unguessable random ID.
- The page expires when the image expires (7 days) or is deleted. After that it shows a localized "no longer available" page.
- **Page contents:**
  - the image
  - a **Share** button that calls `navigator.share({ files: [File(image.jpg, "image/jpeg")] })` after checking `navigator.canShare`. This opens the phone's share sheet, so the attendee can pick Instagram, LinkedIn, WhatsApp and so on.
  - a **Copy text** button that copies the event's `shareText`, because many apps drop text when an image is attached
  - a **Download** button, which is the fallback when sharing is not supported, for example on desktop
- Add OpenGraph tags so a pasted link shows a preview.
- No tracking pixels and no short links.

### 6.3 WhatsApp templates
- **One approved template, `delivery`, in `en` and `pt_BR`, category UTILITY.**
  - It has a media header (the image) and a URL button to the share page.
  - It is used only for out-of-window deliveries (§5.7).
- **Everything else** (quick replies and list pickers) is created at runtime with the Content API and cached in `content_cache`.
- A setup script creates the template and submits it for approval (§15).

---

## 7. Image storage (Azure Blob Storage)

| Container / prefix | Contents | Retention |
|---|---|---|
| `events/<slug>/selfies/` | Normalized selfies | 7 days (lifecycle policy). Deleted when the event is deleted or on a deletion request. |
| `events/<slug>/generated/` | Framed print PNG (1200×1800) and delivery JPEG | 7 days, as above |
| `assets/events/<slug>/` | The event's uploaded frame and background | Never expires. Deleted when the event is deleted. |

- Fixed frames and backgrounds live in the repo under `apps/web/assets/`.
- Configure the 7-day expiry as an Azure lifecycle-management rule. Document it in the README and include it in the setup automation.
- Image bytes may sit in process memory only while a job is processing them.
- The print agent downloads images with short-lived SAS URLs (or through the agent API).

---

## 8. Styles, backgrounds and frames

### 8.1 Styles (fixed in code)
- Cartoon (Pixar 3D), Pop Art, Watercolor, Anime, Sketch, Pixel Art.
- Their prompts are taken word-for-word from PROMPTS.md §D. Sticker is excluded.
- Each style has localized display names in i18n.
- Events enable a subset of them.

### 8.2 Backgrounds
- **Fixed in code:** gradient, solid white, solid black and original. Prompts are in PROMPTS.md §C.
- **Uploaded:** each event can upload one extra background image, plus its localized name.
- Events enable a subset of all of these.

**How each kind of background is used:**
- **Fixed backgrounds:** the model draws them from the prompt text (PROMPTS.md §C).
- **The uploaded background:** it is composited exactly as uploaded. The model draws only the person.
  1. Call gpt-image-2 with `background: "transparent"` and the exact-mode background prompt (PROMPTS.md §E6, "Exact mode"). The background image itself is **not** sent to the model.
  2. Scale the uploaded background to cover 1024×1536.
  3. Composite the transparent portrait on top, centered.
  4. Apply the frame (§8.3).
- **Validate the upload:** PNG or JPEG, at least 1024×1536, 2:3 aspect ratio or croppable to it.

**gpt-image-2 transparency must be proven before building on it.** It is not confirmed that gpt-image-2 supports `background: "transparent"`.
- **Spike first.** As the first task of the image pipeline, write a script, `apps/web/scripts/spike-transparent.ts`. It runs several test selfies (1 person and 3 people) through gpt-image-2 with `background: "transparent"`. For each output it checks:
  - The PNG has an alpha channel.
  - At least 20% of the pixels are fully transparent.
  - There is no checkerboard or solid fill drawn into the image.
  - Hair edges are clean when composited over a dark and a light background.
- **Show the user** the composited results.
- **If any check fails, or the API rejects the parameter:** stop and ask the user. Do **not** switch to another image model, and do **not** add a background-removal step without their approval.
- **Regression tests:**
  - A unit test for the compositing step, using a fixture PNG that has alpha.
  - A test of the full pipeline with the uploaded background. It runs against the real API, and only when `RUN_LIVE_AI_TESTS=1` is set.

### 8.3 Frames
- **Fixed in code:** `none` plus a few default frames in `apps/web/assets/frames/`. The user has not provided any frames yet; ask them.
- **Uploaded:** each event can upload one frame. It must be a PNG of exactly 1200×1800 (4x6 portrait at 300 DPI) with a transparent window. Validate the format, size and that the PNG has an alpha channel when it is uploaded.
- Each event selects exactly one frame.
- **Compositing:**
  1. Find the bounding box of the transparent region (alpha < 128).
  2. Scale the generated portrait to cover that box.
  3. Place the portrait under the frame.

---

## 9. AI pipeline (worker)

### 9.1 Job state machine (`ev_<slug>_jobs`)
```
queued → processing → (delivered | flagged | rejected | failed)
flagged → approved_by_admin → delivered
delivered → removed_by_admin (slideshow/print removal only)
```
**Job fields:**
- `jobId`, `address`, `channel`, `style`, `background`, `selfieBlob`, `outputBlobs`, `shareId`, `subjects`
- `state`, `attempts`, `leaseUntil`, `error`, `aiReview: {result, reason}`
- timestamps for each state

**Leases.** The worker claims a job by setting `processing` and `leaseUntil` (now + 3 min) with `If-Match`. If a job's lease has expired, any worker can take it back.

**Retries.** Up to 3 attempts on transient errors (429, 5xx, network). Back off exponentially and honor `retry-after`.

### 9.2 Steps
1. **Normalize the selfie:** accept JPEG, PNG, WebP or HEIC up to 20 MB. Auto-rotate it, then re-encode it as JPEG.
2. **Moderation:** `omni-moderation-latest`. If the image is flagged, the job ends as `rejected` (moderation). If the call errors, retry; after the retries are used up, the job `failed` (fail closed).
3. **Face detection and scene analysis**, run in parallel on the vision model, with the prompts from PROMPTS.md §A1 and §A2.
   - If the scene analysis can't be parsed, retry, then fail. Never default to "1 subject".
   - 0 faces → `rejected` (no face).
   - More than 4 subjects → `rejected` (too many people).
   - 1–4 subjects → continue.
4. **Build the prompt** (§9.3).
5. **Generate:** `images.edit` with:
   - model `OPENAI_IMAGE_MODEL` (gpt-image-2)
   - input: the selfie only
   - size 1024×1536, quality high, PNG output
   - if the event's uploaded background is chosen, add `background: "transparent"` (§8.2)
   - If the API rejects the image for safety reasons, the job is `rejected` permanently.
6. **Background, frame and resize:**
   - If the uploaded background was chosen, composite the transparent portrait onto it (§8.2).
   - Composite with the event's frame (§8.3), unless the frame is `none`.
   - Resize to 1200×1800 at 300 DPI and save as PNG for printing.
   - Save a JPEG of 5 MB or less for delivery.
   - Upload both to Blob Storage.
7. **AI review:** PROMPTS.md §B1, with all six criteria on, plus the generation prompt as context. Images sent: the selfie and the output.
   - **PASS** → deliver (§6).
   - **FAIL** → `flagged`; send the "please send another selfie" message (§5.6).
   - **Error** → retry, then fail. Never pass by default.

### 9.3 Prompt assembly
- **Built from these sections of PROMPTS.md, in this order:**
  1. style prompt (§D), with `{preserve}` and `{composition}` taken from the defaults in §C
  2. scene line (§E3)
  3. background (§E6, or the plain background-choice prompt)
  4. final reminder (§E11)
- **Left out entirely** (those features are out of scope): brand blocks (§E4), container (§E5), palette (§E7), caricature (§E8), reviewer feedback (§E9), style lock (§E10) and landscape (§E12).
- Fix the V1 inconsistency: the composition text ("chest up" versus "waist up", and Cartoon's hard-coded composition) must be the same everywhere. Ask the user which framing they want.
- Prompts are code, not admin settings. Image-generation prompts are in English.
- Keep a snapshot test for each style × background combination.

### 9.4 Models (environment variables, no admin UI)
| Purpose | Variable | Default |
|---|---|---|
| Image generation | `OPENAI_IMAGE_MODEL` | `gpt-image-2` |
| Face, scene and AI review | `OPENAI_VISION_MODEL` | check the current docs and ask the user |
| Chat replies and the deletion tool | `OPENAI_CHAT_MODEL` | check the current docs and ask the user |

- The image model never changes at runtime. There is no fallback model and no switch for transparency.
- Moderation always uses `omni-moderation-latest`.

---

## 10. Web app surfaces (Next.js)

### 10.1 Auth
- **Basic auth** (`ADMIN_USER` and `ADMIN_PASSWORD` environment variables), enforced in middleware. It covers `/admin/**` and `/booth/**`.
- **Public routes:**
  - `/api/twilio/*` (Twilio signature required)
  - `/s/*`
  - `/privacy/*`
  - `/api/agent/*` (per-event printer token, compared in constant time)
  - `/healthz`
- **Admin forms** use Server Actions with CSRF protection (Next.js Server Actions check the Origin header; keep that on).
- Secrets never reach the client.

### 10.2 Admin: events
- A list of events with their state.
- Create and edit events (all the fields in §4.2), with zod validation.
- State buttons: Go live, Break, End, Back to draft.
- Upload the frame and background, with previews.
- Generate or rotate the printer token. It stays visible, together with a ready-to-copy agent command (§11.1, D-33).
- Delete an event, confirmed by typing its slug (§4.4).

### 10.3 Admin: review (per event)
- **Flagged tab:** shows the selfie, the output, and the AI's reason.
  - **Approve & send** delivers the image (§5.7).
  - **Discard.**
- **Delivered tab:**
  - Remove from slideshow.
  - Remove from the print queue, if the job is not printed yet.
  - Reprint. This counts against print quota; ask whether admin reprints should be exempt.

### 10.4 Booth screen `/booth/[slug]`
- A full-screen, kiosk-friendly page that updates live. Subscribe to Sync with a read-only token for the event's objects, or use server-sent events from the web app.
- **live:**
  - the event's CTA text and steps
  - one QR code for `leadChannel`
  - a slideshow of the consented images in `ev_<slug>_slideshow`, auto-advancing
  - images removed or deleted disappear from the slideshow at once
- **break:** the "We'll be right back" screen. **ended:** the "Event ended" screen. It switches automatically when the state changes.
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
- Show `lastResetAt`.
- **CSV export of leads.** It reads `ev_<slug>_leads` to get the profile IDs, then fetches name, email and channel address **from Conversation Memory**. The CSV contains name, email, phone/WhatsApp, opt-in time and method.
- **Reset script:** `pnpm --filter web stats:reset --event <slug>`. It zeroes the counters and writes `lastResetAt`. Running it is also logged.

### 10.6 Privacy notice `/privacy/[slug]` (public)
- It is linked from every consent message.
- The content is a `TODO` placeholder for the user to fill in. Give it the sections required by GDPR Art. 13/14:
  - what data is collected
  - why
  - who processes it: Twilio, OpenAI, Microsoft Azure, SendGrid
  - how long it is kept
  - the rights a person has and how to use them, including the deletion request
  - contact details
- Localized.

### 10.7 Health
- `/healthz` reports liveness.
- `/healthz/ready` checks that Sync and Blob Storage can be reached.

---

## 11. Print agent (`apps/print-agent`)

### 11.1 Distribution and running
- **A plain Node.js 22+ script, never a compiled binary or app bundle**, so macOS Gatekeeper never asks for anything.
- **Nothing to install at runtime.**
  - If it needs the `twilio-sync` SDK, ship it as a pre-bundled single file (for example an esbuild bundle at `dist/agent.mjs`), committed or served by the web app at `/agent.mjs`.
  - First check that `twilio-sync` works in Node 22, which has a built-in WebSocket. If it doesn't, ask the user. The fallback is for the agent to talk only to the web app's agent API (`/api/agent/*`) using polling or server-sent events.
- **How it is started:**
  ```
  node agent.mjs --url https://<app> --token <event printer token> [--printer <CUPS queue>] [--simulate --out ./prints]
  ```
  The admin UI shows this command with the values filled in.
- Auto-start at login is optional. If you build it, it is a LaunchAgent created by an `--install-autostart` flag. Ask the user before building it.

### 11.2 Behavior
- **Auth.** The agent exchanges its printer token at `/api/agent/token` for a short-lived Sync token. That token can access only `ev_<slug>_print` and `ev_<slug>_printer`, and the agent refreshes it before it expires.
- **One printer per event.** It must be a DNP DS620 using 4x6 paper.
- **Print command:**
  - CUPS: `lp -d <queue> -o PageSize=dnp6x4 -o Cutter=Normal -o Finish=Glossy -o Resolution=300x300dpi`, plus scaling options so the print is borderless.
  - Check the exact option names with `lpoptions -p <queue> -l` on a real DS620 and adjust them.
- **Printer health.** Check `lpstat` regularly for offline, paused, out-of-paper and error states. Report the status and a heartbeat every 15 seconds to `ev_<slug>_printer`. The admin UI and stats show it.
- **Job flow:**
  1. Claim the job with `If-Match` and set a lease.
  2. Download the PNG.
  3. Print it and wait for the CUPS job to finish.
  4. Report the result:
     - **Success:** mark it `printed`. The worker then sends the promo (§5.9) and updates the stats.
     - **Failure:** retry up to 3 times, then mark it `failed`. The attendee already has the image digitally, so they are not sent anything.
- **Stuck jobs.** If a job's lease has expired, it is released by the worker or by the next agent.
- **Simulator (`--simulate`).** No printer is needed. "Printing" writes the PNG to `--out`, with a short delay that imitates a real print. This mode is the required hardware simulator.
- **Network drops.** Reconnect with back-off and carry on with jobs that are still queued.
- Logs go to the console as readable lines.

### 11.3 Print job item (`ev_<slug>_print`)
Fields:
- `jobId`
- `blobPath` or a way to get the URL
- `state`: `queued`, `claimed`, `printing`, `printed` or `failed`
- `attempts`, `leaseUntil`, `error`
- timestamps for each state

Personal data is not allowed. Use a masked address at most.

---

## 12. Localization
- **Locales:** `en` and `pt_BR`. Each event has a fixed language.
- **What is localized:** every customer-facing string. That includes:
  - messages, menu texts and button labels
  - Verify email text
  - booth screen, share page and privacy page
  - style and background display names
  - error replies
- All of it lives in typed catalogs, e.g. `apps/web/i18n/en.ts` and `pt_BR.ts`. The type system must make it impossible to leave a key missing in one of them.
- The admin UI is in English only.
- Prompts sent to the AI are in English. Chat replies must be given in the event's language.

---

## 13. Compliance mapping
| Requirement | Where it is handled |
|---|---|
| Containerized (Dockerfile, container deploy) | §3, §14 |
| README, `.env.example`, and where to get each value | §14 |
| Easy start (few cycles, GDPR note) | §5.2 (QR prefill, no picker when one event is live), §5.4 (Case B has 3 replies: name, email, code) |
| Break / Event-ended modes, with adapted replies | §4.1, §10.4 |
| KISS (1–2 minutes) | §5.5 (menus skipped when there is one option), §9 |
| Multilingual | §12 |
| Real-life test | §16 |
| Simulator | §11.2 `--simulate` |
| Disposal date | Not used (the user's decision). Events are ended and deleted by hand (§4.4). Images expire after 7 days (§7). |
| Offline / network handling | Applies only to the booth screen and print agent: they reconnect and resume (§10.4, §11.2). Not relevant otherwise (the user's decision). |
| Stats that persist, without personal data, plus a reset script | §10.5 |
| Twilio resources documented, setup automated, no Serverless | §15 |
| Privacy notice when data is collected | §5.4, §10.6 (the text is a TODO) |
| Consent and withdrawal | §5.4 (consent as a gate), §5.10 (deletion request) |

---

## 14. Configuration and documentation

**README.md** must include:
- an architecture overview
- local development (docker compose, an ngrok-style tunnel for webhooks, the agent with `--simulate`)
- deploying to Azure Container Apps
- how to set up the Twilio resources (§15)
- how to run the tests
- the real-life test checklist (§16)
- the full environment variable table (below)

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
| `TWILIO_TEMPLATE_DELIVERY_EN`, `TWILIO_TEMPLATE_DELIVERY_PT_BR` | Approved delivery template SIDs |
| `OPENAI_API_KEY`, `OPENAI_IMAGE_MODEL`, `OPENAI_VISION_MODEL`, `OPENAI_CHAT_MODEL` | OpenAI |
| `AZURE_STORAGE_CONNECTION_STRING` (or account and key), `AZURE_STORAGE_CONTAINER` | Blob Storage |
| `LOG_LEVEL` | Logging |

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
- **Content template** `delivery` (EN and PT_BR) and its approval.

**Script `pnpm --filter web setup:twilio`.** It must be safe to run again. It:
1. creates or finds the Sync Service and the Verify Service
2. sets the Messaging Service's inbound URL
3. creates and submits the delivery templates
4. prints the environment variable values to copy

Steps that can only be done in the Console (for example WhatsApp sender registration, or the Memory store if no API exists) are listed in the README as manual steps.

No TwiML Bins, Functions or Studio. If the app ever needs static TwiML, it serves it from its own route.

---

## 16. Testing

**Unit tests (vitest):**
- the prompt builder, with snapshot tests
- the conversation state machine, covering every branch in §5
- event routing
- quota rules
- i18n completeness
- Sync conditional-update retry
- frame compositing
- background compositing with a transparent portrait (§8.2)
- the chat reply always stays in the event's language (§5.10)
- CUPS command building

**Live AI tests (opt-in with `RUN_LIVE_AI_TESTS=1`):**
- the gpt-image-2 transparency spike (§8.2)
- the full pipeline with the uploaded background (§8.2)

**Integration tests:**
- the webhook handler, using mocked Twilio, OpenAI and Sync
- the agent in `--simulate` mode against a local web app

**End-to-end:** Playwright tests for the admin pages, the booth screen and the share page.

**Real-life test checklist** (README). Run it after every major upgrade:
- At least 5 team members from different regions, on both WhatsApp and SMS, including the region where the activation will run.
- Several players at the same time.
- Check the following:
  - the break and ended modes
  - a deletion request
  - admin approval of a flagged image
  - a portrait with the event's uploaded background
  - a print with a real DS620 and with `--simulate`

---

## 17. Open questions (ask the user before building the affected part)

Already answered, so don't ask these again: uploaded backgrounds are composited exactly (§8.2); the chat model can never change the language (§5.10); `maxPrintsPerPerson` is total prints per person (§4.2).

1. **gpt-image-2 transparency (§8.2).** Ask only if the spike fails.
2. **Memory profiles:**
   - (a) In events with lead collection off (Case C), should a Memory profile be created for someone who has no name?
   - (b) If a returning profile has no verified email and this event collects leads, should we run the name/email/code steps (Case B) for them?
3. **Composition framing (§9.3).** Chest up or waist up for every style?
4. **Fixed frames (§8.3).** Which default frames should ship?
5. **Admin reprints (§10.3).** Do they count toward `maxPrintsPerPerson`?
6. **Default models (§9.4).** Which vision and chat models should be the defaults?
7. **Shared types (§3.1).** Is a shared types package between the two projects OK, or must they stay fully independent?
8. **Auto-start (§11.1).** Should the print agent have an auto-start-at-login option?
