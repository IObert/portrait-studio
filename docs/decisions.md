# Decisions log

Product-owner decisions made during the build that add to or change [SPEC.md](../SPEC.md).
SPEC.md is still the source of truth. Where an entry here contradicts it, this entry wins,
because it was approved later. Each entry gives the date, the decision and the reason.

## Changes to the spec

### D-01 Image model is `gpt-image-2.5-flare` (changes §8.2, §9.4)
*2026-10-09.* The §8.2 spike showed that `gpt-image-2` rejects `background: "transparent"`
(`400 invalid_value: Transparent background is not supported for this model`).
Both `gpt-image-2.5-flare` and `gpt-image-2.5-sunburst` produce clean cut-outs. Flare was
chosen because it takes about 18–21 s per image, compared with sunburst's 33–40 s, at similar quality.
- `OPENAI_IMAGE_MODEL` defaults to `gpt-image-2.5-flare`.
- It is still one image model for all styles and backgrounds. There is no fallback and no runtime switch.
- Pricing for 2.5 models is per token, so check the cost per portrait in the OpenAI dashboard before an event.

### D-02 Alpha clean-up and the transparency threshold (changes §8.2)
*2026-10-09.*
- gpt-image-2.5 renders the subject at alpha ≈ 253, never 255. During compositing, pixels with alpha ≥ 250 are set
  to fully opaque so the background does not show through the person. Softer edges are left as they are.
  This is not a background-removal step.
- The "≥ 20 % fully transparent" check is used only in the spike. It is not enforced in production, because
  tight group shots legitimately fall below it (18–19 % in the spike).

### D-03 Sync sharding for hot objects (changes §3.4)
*2026-10-09.* The Sync write limit of 20 writes per second applies per Map, not per item. `dedup` and
`ev_<slug>_stats` are therefore split by hash into several maps (`dedup_0..N`, `ev_<slug>_stats_0..N`).
The 429 WARN logging and the `TODO(scalability)` comments stay.

### D-04 New global `shares` map (adds to §3.4)
*2026-10-09.* `shares`: `shareId → {eventSlug, jobId}`, with a 7-day TTL, so that `/s/[shareId]` can find
its job.

### D-05 Sync item retention (adds to §3.4, §7)
*2026-10-09.* Sessions, jobs, print items and slideshow entries have a 7-day TTL, matching the blobs.
Leads and stats are kept until the event is deleted.

### D-06 Booth screen updates (superseded)
*2026-10-09.* Originally server-sent events. Replaced by the Sync client SDK with scoped read-only tokens (D-17).

### D-07 Deployment
*2026-10-09.*
- `deploy.sh` deploys to Azure Container Apps.
- `.github/workflows/deploy.yml` runs it on **every push to `main`**.
- CI uses only GitHub-owned actions, because the org's Actions policy requires it.

### D-08 Sync retry behaviour (implementation note)
*2026-10-09.* twilio-node drops response headers on errors, so Sync's `retry-after` is not available.
Rate limits are retried with exponential backoff and full jitter: 4 attempts per call, and up to 8
re-reads on revision conflicts. Every 429 is logged.

### D-09 Dev environment and Twilio resources
*2026-10-09.*
- The Twilio account is **DevRel Event Activations** (`AC10f4fc…`). It is shared with other activations, so only
  new resources named `Portrait Studio …` are created and nothing existing is changed.
- Created: Sync Service **Portrait Studio Dev** (`IS1e5a46ce…`, ACLs enabled) and API key **Portrait Studio Dev**
  (`SK6898cf13…`). Their values are only in `.env.local`.
- WhatsApp test sender: **+13203780782** ("Anime Artwork"), used for testing and setup.
- In development, `.env.local` wins over inherited shell variables, because shell profiles may export `TWILIO_*` for
  other accounts. In production nothing is read from disk.
- `experimental.agentFeedback` is turned off: it told agents to send reports to Vercel.

### D-10 Messaging, Verify and Memory resources
*2026-10-09.*
- **Messaging Service:** the empty "Anime Artwork" service (`MGeed911…`) was renamed **Portrait Studio**.
  +13203780782 was moved into it from `MG705b9c…` ("Messaging Service created on September 9, 2026"). The other app
  sends directly from the number, not through that service, so its outgoing messages are unaffected.
  `useInboundWebhookOnNumber` is still `true`, and the WhatsApp sender's own webhook still points at the
  `ai-anime-artwork` app. **The cut-over** (sending inbound traffic to Portrait Studio) is a separate, explicit step
  and stops that app.
- **Verify:** a new service **Portrait Studio** (`VAb8e2869f…`) with the same settings as the other activations
  (6-digit codes, no lookup). Email integrations can only be created and linked in the Console, and one integration
  can serve several services. **Manual step:** link an existing SendGrid email integration to this service
  (Console → Verify → Services → Portrait Studio → Email).
- **Conversation Memory:** the shared store **Cross-Activation-Memory** (`mem_store_01kvcx…`) is reused. For how
  deletion works, see D-12. (An earlier "remove only our traits" rule was replaced by D-12.)

### D-11 WhatsApp replies name the booth number as `From`
*2026-10-12.* A Messaging Service does not select a WhatsApp sender on its own: sending with only
`MessagingServiceSid` fails with 21703. WhatsApp replies are therefore sent with `MessagingServiceSid` **and**
`From: whatsapp:<the number the attendee wrote to>`, which also keeps each attendee on the number they used.
SMS still lets the service choose the sender. Confirmed live: replies were delivered and read.

### D-12 Deletion wipes the whole Memory profile
*2026-10-12, user decision.* The Memory store is shared with other activations. Even so, a deletion **deletes the
entire profile**: traits, identifiers and observations. Other apps must cope with a missing profile, and so does
this one. A delete of an already-deleted profile succeeds, and a lookup that finds nothing restarts consent.
- **Deletion request (§5.10):** the person's profile is deleted outright.
- **Event deletion (§4.4):** the event is unlinked from each profile; a profile linked to no other Portrait Studio
  event is then deleted.

### D-13 Ending an event removes its bindings
*2026-10-12.* SPEC §4.1 says ending removes bindings and that "any message" gets the ended reply. Without a binding,
a message with no code can no longer be linked to the ended event, so it gets the standard reply (or goes to another
live event). Only messages that carry the event code get "This event has ended". **Open for review.**

### D-14 Vision model reasoning effort
*2026-10-12.* The early research said `gpt-6.1-sol` supports reasoning effort `none`. **It does not.** The API returns
`400 unsupported_value`, while `gpt-6-luna` does accept `none`. The vision model (Sol) therefore runs at `low`, its
lowest accepted value. Face check ≈ 1.4 s; the full live pipeline took 26 s (cartoon, uploaded background, framed,
reviewed). The effort is chosen per model in `lib/pipeline/context.ts`.

### D-15 AI review criteria
*2026-10-12.* SPEC §9.2 says "all six criteria on", but PROMPTS.md §B1 criterion 4 (Branding) only applies when brand
references are present, and brands are out of scope (§2.2). The review therefore uses the other 5 criteria, as V1 did
without brand references.

### D-16 Admin "Remove" is a full takedown
*2026-10-13, user decision (replaces the 2026-10-12 version).* One **Remove** action, with a confirmation step, on the
delivered tab. It:
- moves the job to `removed_by_admin`
- takes the image off the booth screen at once
- cancels a print that has not started (an in-progress print cannot be recalled; the admin is told)
- **deletes the selfie and both output files immediately**

The share link then shows "This portrait was removed by the event organizer." Discarding a flagged image ends it as
`rejected` with `error: discarded_by_admin`.

### D-17 Booth screen updates are pushed by Twilio Sync
*2026-10-13, user decision (replaces the SSE/polling version and D-06).* The booth screen uses the **Twilio Sync
client SDK** (`twilio-sync`): Sync pushes changes, with no polling.
- The server keeps a public document, `ev_<slug>_booth`, in sync with the event: name, state, CTA, QR code SVG,
  number, and the localized break and ended texts. There is no personal data in it. `EventRepo.onChange` republishes
  it on every event write.
- Slideshow items carry their signed image URL, so a push contains everything the screen needs.
- `/booth/<slug>/token` (basic auth) mints a 1-hour read-only token for the identity `booth:<slug>`, granted read on
  `ev_<slug>_booth` and `ev_<slug>_slideshow` only. The service has ACLs on, so everything else is denied with 54007.
  This was verified live against `events`, `sessions`, `jobs` and `leads`. The browser opens objects with
  `open_existing`, since creating them would need write access, and refreshes the token before it expires.
- On a network drop the SDK reconnects by itself and the screen keeps its last state.
- In CI (in-memory Sync) the screen uses its server render. The real push is tested in
  `tests/live/booth-sync.live.test.ts` (`RUN_LIVE_SYNC_TESTS=1`).

### D-18 Photo checks run before the menus
*2026-10-13, user decision.* A photo now creates its job immediately in a new `screening` state. The worker runs
moderation, face detection and scene analysis (§9.2 steps 1–3). A photo that fails is rejected straight away with
its §5.6 message, so nobody picks a style for a photo that can't be used. A photo that passes stores its scene
(`subjects`, `pet`) and moves to `awaiting_choice`. The worker then opens the style menu, or with one style and one
background goes straight to generation. Generation reuses the stored scene, with no second vision call. A new photo
during screening or the menus replaces the old job. Checks still run in the worker, never in the webhook (§3.2).

### D-19 Twilio Privacy Notice; no hashtag; one product name
*2026-10-13, user decisions.*
- Every consent message and the verification email **only link** the Twilio Privacy Notice
  (`https://www.twilio.com/en-us/legal/privacy`). The app has no privacy text of its own, copied or adapted. The
  app-specific `/privacy/[slug]` page (SPEC §10.6) is removed.
- The QR prefill names the event ("Hi! I'm at SIGNAL London and want to try Portrait Studio 🎨"). Routing matches the
  event's full name or its code as whole words, with no `#` needed. A name match beats a code match, and the longest
  name wins.
- The product is called **Portrait Studio** everywhere: messages, templates, README and docs. "AI photo booth" and
  similar phrasings are gone (SPEC.md and PROMPTS.md are left unchanged as source documents). A sentence that names
  the product does not also say "portrait" or "retrato".

### D-20 Verification email: the user's template, with per-event extras
*2026-10-13, user decisions.* `apps/web/assets/email/verification-email.html` is the user's template, renamed to
Portrait Studio and with its "ordering" lines adapted. It holds its own wording, and **English is used for every
event**, including pt_BR events (a deviation from SPEC §12, accepted by the user). The Verify call sends only:
- `event_name`
- `promo_code`: the event's **promo code** setting; when empty, the gift block is hidden
- `show_snippet`: the event's **show code snippet** setting; when off, the snippet and the Verify CTA are hidden

Both settings only work with lead collection on, and validation enforces that. Variables use underscores:
SendGrid's Handlebars does not accept `{{event-name}}`. **Manual step:** paste the file into a SendGrid dynamic
template (subject "Your Portrait Studio verification code") and set it on the Verify email integration.

### D-21 Shorter Twilio request timeout
*2026-10-13.* The worker logged "timeout of 30000ms exceeded" about every 10 minutes while idle: both lanes failed
on the same shared Sync call. That is the Twilio SDK's default 30 s timeout on a keep-alive socket the network had
silently dropped. Every Twilio client now comes from `lib/twilio/client.ts`, which sets an **8 s timeout**, plus
keep-alive with a 5 s idle recycle. The callers' own retries (SyncStore, worker) then open a fresh connection, so a
stale socket costs seconds instead of 30 s. Covered by a unit test against a server that never answers, and by the
live Sync tests.

### D-22 Print agent uses the Sync SDK, confirmed on Node 22
*2026-10-14.* SPEC §11.1 asked for this check before relying on `twilio-sync`. Verified on real Node 22.22:
the SDK connects, opens objects and receives pushes. One catch: it is CommonJS, so an esbuild ESM bundle needs a
`createRequire` banner, otherwise it dies at start-up with "Dynamic require of events is not supported". CI now
starts the built bundle (`--version` and a bad invocation) so this cannot regress. No fallback to a polling agent
API is needed.

### D-23 Print agent and server responsibilities
*2026-10-14.*
- The agent claims jobs with the SDK's `mutate` (compare-and-set): a lost race cancels, so two agents never print
  the same job. Lease 2 min, renewed every 30 s while printing, 3 attempts then failed.
- `POST /api/agent/token` swaps the printer token for a Sync token for identity `printer:<slug>`, with read+write on
  that event's print map and printer document only. Everything else is denied (54007, verified live). Printing must
  be enabled, and an unknown event, a rotated token and printing-off all return the same 401.
- Print items carry a **signed download link** (`/m/<token>`), so the agent needs no storage credentials.
- The server settles prints (`lib/pipeline/prints.ts`): counts successes toward `maxPrintsPerPerson`, releases
  reservations, sends the promo once per printed job (§5.9), and requeues or fails jobs whose lease expired 5 min
  ago (§11.2 stuck jobs). Admin reprints neither count nor trigger a promo (§17 Q5).
- The admin command now defaults to `--simulate`, since it works with no printer attached.

### D-24 Attendees choose what to print (user decision)
*2026-10-14. Changes SPEC §6.1, §9.2 and §11: nothing is printed automatically any more.*
- Two per-event limits: `maxImagesPerPerson` (X, portraits delivered for free) and `maxPrintsPerPerson` (Y, portraits
  sent to the printer).
- After each delivery, one question with three buttons replaces the slideshow question: **Print + show**, **Show
  only**, **No thanks**. Printing a portrait also puts it on the booth screen. When printing is off or no prints are
  left, the question is the plain slideshow Yes / No.
- The buttons carry the job id, so an earlier portrait can still be printed later. SMS: `PRINT` / `YES` / `NO` answer
  the latest question.
- `lib/delivery/print-request.ts` checks that it is the person's own delivered job, reserves a print on the session
  first (so two taps never print twice), then queues it. A failed print may be asked for again.
- The admin reprint is unchanged.
- Simulated prints go to `prints/` in the repo root (gitignored).

### D-25 One print, one copy
*2026-10-14. Found on the real DS620: with the printer off, three attempts left three CUPS jobs, and all three printed
when it was switched on.*
- A print is submitted to CUPS once, and its request id is stored on the item (`printerJobId`). After that the agent
  only waits for that job or cancels it.
- A printer that is off, paused or out of paper is a reason to wait, not a failure: the agent keeps its lease and
  claims nothing new until the printer is ready.
- Done means IPP `job-state = completed` (via `ipptool`). `lpstat -W completed` also lists cancelled jobs.
- Before any retry or final failure, the CUPS job is cancelled. A job stalled for 10 min while the printer reports
  ready counts as an error.
- The server never requeues a `printing` item that has a `printerJobId`, because that copy may already be on paper;
  the next agent resumes it instead.
- The admin page already shows the printer status (heartbeat), so staff can see why nothing comes out.

### D-26 Print button on the share page (user decision)
*2026-10-14.*
- The share page shows **Print at the booth (N left)** when the event has printing on and the owner still has prints.
- **Anyone with the link** may use it (the user's choice): it takes one of the *owner's* prints, never more than
  their quota. The page sends only the share id; the server looks up the job and owner.
- It never adds the portrait to the booth screen. "Print + show" in the chat is the way to do both.
- Same rules as the chat print (`requestPrint`): own delivered portrait, one print per portrait, a failed print can
  be asked for again.

### D-27 Frame clearance line in the generation prompt (user decision)
*2026-10-14. An addition to PROMPTS.md §E; PROMPTS.md itself is unchanged.*
- Problem: the image model does not know about the frame, so a logo tab could cover a head or hair.
- `lib/image/frame-clearance.ts` measures, from the frame PNG, how much of the portrait window its opaque parts
  cover at the top and bottom (middle 40% of the width, where heads are). Frames are measured automatically, so an
  uploaded frame gets the same treatment.
- When a side is covered by 8% or more, one line is added before the final reminder (§E11), with the share rounded
  up to the next 5% plus a margin:
  `Frame clearance: A decorative frame will cover {the top N%| the bottom N%| both} of the image after generation.
  Keep that area free of the subjects: every head, all hair and every face must sit fully outside {…}, with only
  background there. Scale and position the subjects so nothing important is hidden.`
- Shipped frames: tab top → top 15%; tab bottom / bottom left → bottom 20%; red borders (their own tilted window,
  3–5% wedge) → no line. With no frame, or one that covers nothing, the prompt is exactly the PROMPTS.md prompt.
- The model follows this most of the time, not always. If it is still not good enough, the fallback is to move the
  photo below the tab in the frame designs.

### D-28 "print" in the chat (user decision; ahead of the §5.10 chat replies)
*2026-10-14.*
- A message containing the event language's print word (`print` / `imprimir`) while nothing else awaits an answer
  replies with the person's printable portraits, newest first: one **Print it** button, or a numbered list.
  Already-printed ones are marked and can be printed again (D-26). Choosing one prints it **without** adding it to
  the booth screen (`ps:slide:printonly:<jobId>`).
- SMS: `PRINT 2` picks the second portrait listed. The session keeps the order shown (`printMenu`).
- The session keeps up to 10 delivered job ids (`delivered`, a WhatsApp list's limit), so the menu reads only
  those jobs rather than scanning the jobs map (SPEC §3.4 hot spot).
- The "send us a selfie" fallback adds "Or reply PRINT…" when the person has prints left and a portrait.
- The AI chat replies (§5.10, D-29) replaced the fallback; this keyword handling stays in front of them.

### D-29 Chat replies (SPEC §5.10)
*2026-10-15.*
- Free text (opted in, no active step) goes to the chat model (`OPENAI_CHAT_MODEL`, effort `none`) with PROMPTS.md
  §G1 / §G2 word for word, except: "AI-powered photobooth" / "cabine de fotos com IA" → "Portrait Studio" (user
  decision), G2's admin-written extra instructions left out (user decision: no new setting), and a language rule
  appended. Context: event name, enabled styles, remaining portraits, the message.
- The reply is sent as is (Markdown stripped, at most 600 characters) and never changes state. Any model failure or a
  10 s timeout falls back to the localized selfie prompt. The PRINT hint (D-28) is added to either.
- Language: the prompt is always the event's language and tells the model it cannot switch. A live test
  (`RUN_LIVE_AI_TESTS=1`) checks both directions, plus a deletion request in German calling the tool.

### D-30 Data deletion (SPEC §5.10)
*2026-10-15. Follows D-12.*
- `request_data_deletion` (the only tool) sets `pendingDeletionConfirm` and sends **Yes, delete** / **Cancel**.
  Only the button payload confirms on WhatsApp; on SMS the exact keyword (`DELETE` / `APAGAR`) right after the
  question. Anything else cancels.
- Deletes across all events: jobs and their files, slideshow, print-queue items, share links, leads, sessions,
  bindings, the event picker; then the whole Memory profile and its links (D-12). Anonymous stats stay;
  `deletionRequests` is counted once it succeeded.
- Fails closed: every step is idempotent (missing items and blobs are no-ops), so any error stops it without the
  "done" reply, and confirming again finishes it. A print already at the printer cannot be recalled: its queue item
  stays until it finishes, and the reply says one print may still come out.

### D-31 Stats page, leads CSV, reset
*2026-10-15.*
- `/admin/events/<slug>/stats`: the §10.5 counters, average delivery time, per style and background, the print
  agent's status (offline after 45 s without a heartbeat), and `lastResetAt`.
- **Leads export is a script only** (user decision; changes SPEC §10.5's CSV export in the admin UI): `pnpm --filter
  web leads:export [--event <slug>] [--out <file>]`. Without `--event` it lists the events and asks for a number.
  Leads are joined with Conversation Memory; agree-only leads and deleted profiles give empty contact fields. Cells
  that a spreadsheet would run as a formula are prefixed with `'` (phone numbers are exempt). It writes to
  `exports/` at the repo root (gitignored, folder `0700`) unless `--out` is given; the file is `0600`, never
  overwrites an existing one, and `leads-*.csv` is gitignored anywhere as a second guard. The web app has no download.
- `pnpm --filter web stats:reset --event <slug>` deletes the counters and writes `lastResetAt` to
  `ev_<slug>_stats_meta` (deleted with the event). The run is logged.

### D-32 Print agent rebuilds a dead Sync connection
*2026-10-15. Found after the laptop slept: the SDK stopped reconnecting and every heartbeat timed out for 15 hours,
with no error event.* Each heartbeat is limited to 15 s; with no successful heartbeat for 60 s the agent drops the
session and starts a fresh one with a new token. A print at the printer keeps its printer job id and is resumed
(D-25), so this cannot duplicate prints.

### D-33 Short printer token, kept visible in the admin (user decision)
*2026-10-15. Changes SPEC §4.2 and §10.1 ("shown once, hash only").*
- The web app runs in the cloud and the print agent on a laptop next to the printer, so the token is often typed by
  hand. It is now `<event id>.XXXX-XXXX-XXXX-XXXX`: 16 Crockford base32 characters (80 random bits, no I, L, O or U).
  Only guessable online, one request at a time.
- Typing is forgiving: case, spaces, missing dashes and the look-alikes O→0, I/L→1 are normalised before the
  constant-time hash comparison.
- The token is stored on the event (`printerToken`) next to its hash, and the event page always shows it with the
  server URL and the full agent command, each with a copy button. Anyone who can read the event can read the token;
  that is the same audience that can already change the event.
- Tokens from before D-33 (`pst_<id>_<43 chars>`) no longer verify (2026-10-16). An event that still has one shows
  **Generate token**, and its agent must be restarted with the new token.

### D-34 Share caption and promo defaults, with an `{event}` placeholder (user decision)
*2026-10-15.*
- New events start with a suggested share caption and post-print promo (en and pt_BR in `DEFAULT_COPY`). `{event}`
  is replaced by the event name when the text is used, so renaming an event keeps the copy right.
- On the new-event form, switching the language swaps in that language's suggestions unless the admin edited them.
- New-event limits: 10 portraits and 6 prints per person. Existing events keep their values.

### D-35 The event ID is generated from the name and never shown (user decision)
*2026-10-15. Changes SPEC §4.2 (the admin no longer types an event code) and §5.2 (only the name is matched).*
- The slug stays as the internal ID: Sync object names, blob paths, URLs, the printer token and the scripts' `--event`
  all use it. The admin never types it and attendees never see it.
- On create it is derived from the name (`lib/events/event-id.ts`): lowercase, accents removed, anything else a dash,
  at most 36 characters; a name with nothing usable becomes `event`. A taken ID gets `-2`, `-3`, … (race-safe: the
  repo's create fails on an existing key). Renaming an event keeps its ID.
- Chat routing matches the event **name** only; the ID is never matched. The QR message already names the event.
- Deleting an event asks for its name, not its ID.

### D-36 LA Kings promotion: jersey and two scenes (user decision)
*2026-10-15. Brings back part of what SPEC §2.2 dropped ("brands") and §9.3 left out (§E4 brand block, §E10 style
lock), for one brand.*
- **Admin:** one toggle in the Portraits section, "LA Kings promotion". It does not mention the jersey. Turning it on
  dresses every portrait in the Kings jersey and adds two backgrounds, **Ice rink** and **Crypto.com Arena**, both
  selected by default. With it off, those two are not shown, cannot be chosen, and the schema rejects them.
- **Brand definition** in code (`lib/brands/la-kings.ts`): three reference images (`assets/la-kings/LAK-*.png`), the
  wardrobe text, and the two scenes with one reference image each. A second brand is a new definition.
- **Prompt** (`lib/prompts/brand.ts`), PROMPTS.md wording: §E4 "with brand references but no analysis",
  §C `preserveBrand` replacing the style's preserve line (so the jersey replaces the person's top), §C
  `promptBrandInstruction`, the wardrobe, the §E4 reminder; §E6 AI mode for the scenes; §E10 style lock with §D
  `brandCore`. Without the promotion every prompt is byte-for-byte unchanged (snapshots).
- **No analysis step:** a live probe showed the reference images plus the wardrobe text reproduce the crest, crown,
  Mercury Insurance patch and NHL collar exactly, so there is no vision call or cache.
- **Image call:** the selfie, then `brand_ref_0..2.png`, then `bg_ref_0.png`. `input_fidelity` is not sent:
  gpt-image-2.5-flare rejects it (400).
- **Scenes** are AI mode: the model re-renders them in the chosen style. The two backgrounds were made from the
  user's sample portraits with one image-edit call each (person and frame removed, photoreal), approved by the user.

### D-37 One QR choice of channel and number, and a QR message (user decision)
*2026-10-15.*
- The admin picks **one** entry: a number on one channel, from the Messaging Service (`TWILIO_MESSAGING_SERVICE_SID`).
  Each number appears once per channel it can be messaged on: WhatsApp when it is an ONLINE WhatsApp sender, SMS
  when it has the SMS capability. Picking an entry sets `leadChannel` and `qrSender` together, so they cannot
  disagree. Entries show a WhatsApp or SMS icon. If the senders cannot be loaded, both fields fall back to free entry.
- **RCS** is not a separate entry: an RCS sender is an agent, not a number, and has no QR link of its own. Twilio
  sends RCS first and falls back to SMS when an RCS sender is in the service's pool, so the SMS entries get an RCS
  badge then. Checked live: this service has no RCS sender today.
- **QR message** (`qrText`): what the phone fills in after scanning. Default per language: "Send this message to get
  your portrait from Twilio at {event}" / "Envie esta mensagem para ganhar seu retrato da Twilio no {event}", swapped
  with the language while unedited. It must keep `{event}`, which becomes the event name: that is how the first
  message is matched (D-35). Links: `https://wa.me/<number>?text=<message>` and `sms:+<number>?&body=<message>`.
- New events also start with the booth headline and three steps as real values (previously placeholders).

## Open TODOs after the last milestone

- **`setup:twilio` script** (SPEC §15): never built. `docs/deployment.md` step 4, `README.md` and SPEC.md
  still point to it. Either write it (Sync and Verify services, Memory store, delivery templates, Messaging Service
  inbound URL; safe to run again) or replace those references with the manual Console steps.

- **README is out of date**: the intro still says sections are marked *(coming)*, and "Coming in later milestones"
  lists an architecture overview, webhook tunnel setup, Twilio resource setup, an env var table and a real-life test
  checklist that were never written. Write them or drop the section.

- **Profile deletion in the shared Memory store** (user, 2026-10-12): needs a broader discussion once the app is done.
  The current behaviour (D-12) is a best guess. Every relevant line is tagged `TODO(profile-deletion)`; list them
  with `git grep -n "TODO(profile-deletion)"`.

### Closed

- **DS620 borderless prints** (2026-10-16): confirmed on paper, no white edge and nothing cropped.
- **Fewer settings per page in the admin** (2026-10-16): not needed; the event form stays one page.
- **Email templates for all activations** (2026-10-16): the SendGrid verification templates are updated. Portrait
  Studio's uses `event_name`, `promo_code` and `show_snippet` only (D-20).

## Answers to SPEC §17

| Q | Decision |
|---|---|
| Q1 Transparency | The spike failed on gpt-image-2. See D-01. |
| Q2a Memory profile in Case C | No profile. Only a lead record is written. |
| Q2b Returning profile without a verified email, at an event that collects leads | Greet them by name, skip the name step, then ask for email and code. |
| Q3 Framing | Chest up for every style. Cartoon's hard-coded "waist up" is replaced by the shared composition text. `{preserve}` uses the settings text in PROMPTS.md §C. |
| Q4 Fixed frames | Ship `none` plus one placeholder border, clearly marked as a placeholder, until real 1200×1800 PNGs are supplied. **Superseded 2026-10-14:** the five supplied Twilio frames are the fixed frames; the placeholder was removed. |
| Q5 Admin reprints | They do not count toward `maxPrintsPerPerson`. They are logged with the admin's name. |
| Q6 Models | `OPENAI_VISION_MODEL=gpt-6.1-sol`, `OPENAI_CHAT_MODEL=gpt-6-luna`. Both use the Responses API with reasoning effort `none`. |
| Q7 Shared types | None. The two projects stay independent, with a contract in `PROTOCOL.md` and fixture-based contract tests. |
| Q8 Auto-start | No. |

## Other decisions

| Topic | Decision |
|---|---|
| Repo location | `~/Desktop/portrait-studio`, a pnpm monorepo (`apps/web`, `apps/print-agent`) |
| Runtime | Node 24 in the container. The print agent supports Node 22+. |
| CI | GitHub Actions |
| Containers | Podman locally (with the `docker-compose` provider). The compose file follows the standard Compose spec. |
| HEIC selfies | Not supported. WhatsApp converts photos to JPEG. |
| Print quota | A queued print reserves one unit of quota. The unit is released if the print finally fails. |
| SMS buttons | SMS has no buttons, so it uses exact localized keywords instead (for example `AGREE`/`ACEITO`, `DELETE`/`APAGAR`). They are matched in code, never by the LLM. |
| More than 10 live events | Fall back to a numbered text list |
| Quota identity | Per channel address. WhatsApp and SMS count separately. |
| Lead email | Any valid email is accepted (no business-only rule) |
| Smart-reply prompts | Drop G2's "Instruções adicionais do evento" line. Add a language-lock line and a deletion-tool line to G1 and G2. |
| Copy | I write the new en and pt_BR text. pt_BR is marked for review by a native speaker. |
| Delivery template | Submitted as UTILITY. If Meta reclassifies it, the user is told; nothing is changed automatically. |
| QR sender list | The Messaging Service's phone numbers plus WhatsApp senders from the Channels Senders API, falling back to entering the number by hand |
| Local Blob Storage | Azurite in compose |
| Local Sync | A real dev Sync Service. Tests use mocks. |
| MMS country check | libphonenumber, so +1 Caribbean numbers are not treated as US or CA |

### D-38 Cartoon and anime: no eyes drawn on sunglasses (user decision)
*2026-10-15. A change to the PROMPTS.md §D cartoon and anime styles; PROMPTS.md itself is unchanged.*
- Problem: with mirrored or dark sunglasses, cartoon and anime portraits showed eyes painted onto the lenses. Both
  styles ask for big expressive eyes (cartoon also for "detailed iris reflections"), and the preserve line asks for eye
  colour, so the model invents eyes where none are visible.
- Both style lines now add (`SUNGLASSES` in `lib/prompts/styles.ts`): "If a subject wears sunglasses or other glasses
  that hide the eyes, keep the lenses opaque and reflective as in the photo, and never draw eyes on or through them."
- With a brand, the anime style lock (§E10) also says "large expressive eyes" and comes last in the prompt, so it
  repeats the sentence. The cartoon lock says nothing about eyes.
- The other styles were not seen to do this and are unchanged.
