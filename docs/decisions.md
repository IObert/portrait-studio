# Decisions log

Product-owner decisions made during the build that add to or change [SPEC.md](../SPEC.md).
SPEC.md is still the source of truth. Where an entry here contradicts it, this entry wins,
because it was approved later. Each entry gives the date, the decision and the reason.

## Changes to the spec

### D-01 Image model is `gpt-image-2.5-flare` (changes §8.2, §9.4)
*The model was replaced by `gpt-image-2.6-flare` in D-51; the findings below were measured on 2.5.*
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
- `.github/workflows/deploy.yml` runs it on **every push to `main`**, after CI has passed for that commit (2026-10-16).
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

### D-13 Ending an event keeps its bindings
*2026-10-12, revised 2026-10-16 (user decision).* SPEC §4.1 says "any message" to an ended event gets the ended
reply, but it also said ending removes bindings, and without a binding a message that does not name the event cannot be
linked to it. The first version removed them anyway, so only messages naming the event got "This event has ended".
Now **ending keeps the bindings**: everyone who used the event gets the ended reply, whatever they write.
- Once another event is live, an ended binding is ignored and the message is routed as usual (that event, or the
  picker), so someone at the next event is not stuck on the old one. Naming the ended event still gets its reply.
- Deleting an event still removes its bindings (§4.4).

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
- `/booth/<slug>/token` (public, like the booth screen) mints a 1-hour read-only token for the identity `booth:<slug>`, granted read on
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

### D-22 Print agent uses the Sync SDK, confirmed on Node 22 (the agent now requires Node 24)
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
  ago (§11.2 stuck jobs). Admin reprints neither count nor trigger a promo (Q5).
- The admin command now defaults to `--simulate`, since it works with no printer attached. (Replaced by D-46: the command names no printer and the agent asks.)

### D-24 Attendees choose what to print (user decision)
*2026-10-14. Changes SPEC §6.1, §9.2 and §11: nothing is printed automatically any more.*
- Two per-event limits: `maxImagesPerPerson` (X, portraits delivered for free) and `maxPrintsPerPerson` (Y, portraits
  sent to the printer).
- After each delivery, one question with three buttons replaces the slideshow question: **Print + big screen**, **Big
  screen only**, **No thanks**. Printing a portrait also puts it on the booth screen. When printing is off or no prints are
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
- It never adds the portrait to the booth screen. "Print + big screen" in the chat is the way to do both.
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
- Shipped frames: tab top → top 20% (15% before the safe-zone fix of D-41 moved its logo down); tab bottom / bottom left → bottom 20%; red borders (their own tilted window,
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

- **Profile deletion in the shared Memory store** (user, 2026-10-12): needs a broader discussion once the app is done.
  The current behaviour (D-12) is a best guess. Every relevant line is tagged `TODO(profile-deletion)`; list them
  with `git grep -n "TODO(profile-deletion)"`.

- **Print agent reads only the first 100 queue items** (user, 2026-10-20): left as it is for now. Settled items
  stay for 7 days, so on a long, busy event a new print can sort after the first 100 and be missed. Marked
  `TODO(print-queue-pagination)` in `apps/print-agent/src/agent.ts`. Page through `getItems` with `nextPage()`.

### Closed

- **WhatsApp delivery templates** (user, 2026-10-21): not needed, and removed. A portrait that finishes after WhatsApp's 24-hour window is not sent, by design. See D-42.
- **SPEC and docs aligned with the code** (user, 2026-10-21): SPEC.md rewritten to the current state, the other docs checked against the code. The old section 17 (open questions) is removed; code comments and tests now cite the SPEC section that holds each answer.
- **Eval: portraits keep the top 10% free** (user, 2026-10-20): built, see D-40.
- **Frame safe zone** (user, 2026-10-20): measured on the DS620, frames fixed, eval built, see D-41.
- **`setup:twilio` script** (2026-10-16): written, see D-39.
- **README** (2026-10-16): rewritten with setup, architecture, env table and booth printer steps. The real-life test checklist is in SPEC §16, not in the README (user, 2026-10-21).

- **DS620 borderless prints** (2026-10-16): confirmed on paper, no white edge and nothing cropped.
- **Fewer settings per page in the admin** (2026-10-16): not needed; the event form stays one page.
- **Email templates for all activations** (2026-10-16): the SendGrid verification templates are updated. Portrait
  Studio's uses `event_name`, `promo_code` and `show_snippet` only (D-20).

## Answers to the original open questions

The build specification ended with eight open questions. Their answers are below; the SPEC now states each one in the section that holds the behaviour.

| Q | Decision |
|---|---|
| Q1 Transparency | The spike failed on gpt-image-2. See D-01. |
| Q2a Memory profile in Case C | No profile. Only a lead record is written. |
| Q2b Returning profile without a verified email, at an event that collects leads | Greet them by name, skip the name step, then ask for email and code. |
| Q3 Framing | Chest up for every style. Cartoon's hard-coded "waist up" is replaced by the shared composition text. `{preserve}` uses the settings text in PROMPTS.md §C. |
| Q4 Fixed frames | Ship `none` plus one placeholder border, clearly marked as a placeholder, until real 1200×1800 PNGs are supplied. **Superseded 2026-10-14:** the five supplied Twilio frames are the fixed frames; the placeholder was removed. |
| Q5 Admin reprints | They do not count toward `maxPrintsPerPerson` and send no promo. The log line carries no admin name. |
| Q6 Models | `OPENAI_VISION_MODEL=gpt-6.1-sol`, `OPENAI_CHAT_MODEL=gpt-6-luna`. Both use the Responses API with reasoning effort `none`. |
| Q7 Shared types | None. The two projects stay independent, with a contract in `PROTOCOL.md` and fixture-based contract tests. |
| Q8 Auto-start | No. |

## Other decisions

| Topic | Decision |
|---|---|
| Repo location | `~/Desktop/portrait-studio`, a pnpm monorepo (`apps/web`, `apps/print-agent`) |
| Runtime | Node 24 everywhere: the container, development and the print agent (2026-10-16; the agent previously supported Node 22+). |
| CI | GitHub Actions |
| Containers | Podman locally (with the `docker-compose` provider). The compose file follows the standard Compose spec. |
| HEIC selfies | Not supported. WhatsApp converts photos to JPEG. |
| Print quota | A queued print reserves one unit of quota. The unit is released if the print finally fails. |
| SMS buttons | SMS has no buttons, so it uses exact localized keywords instead (for example `AGREE`/`ACEITO`, `DELETE`/`APAGAR`). They are matched in code, never by the LLM. |
| More than 10 live events | Fall back to a numbered text list |
| Quota identity | Per channel address. WhatsApp and SMS count separately. |
| Lead email | Any valid email is accepted (no business-only rule) |
| Smart-reply prompts | Drop G2's "Instruções adicionais do evento" line. Add a language-lock line and a deletion-tool line to G1 and G2. |
| Copy | I write the new en and pt_BR text. No native-speaker review (user decision, 2026-10-16). |
| Delivery template | Removed (D-42). It was submitted as UTILITY. |
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

### D-39 `setup:twilio` (SPEC §15)
*2026-10-16.* `scripts/setup-twilio.ts`, logic in `lib/setup/twilio.ts`. Safe to run again, and never creates a
second copy:
- A SID in the environment pins its resource; one that does not exist stops the run rather than creating another.
  Otherwise it finds by exact name (`Portrait Studio`, `--name` to change); two with the same name stop the run.
- It goes further than SPEC §15: it also finds or creates the Memory store, since the Memory API can. A store it did not
  create (such as the shared one, D-10) is only checked, never changed.
- The inbound URL is never taken from another app without `--take-over-inbound` (the cut-over, D-10).
- **Delivery template variables changed** (the template was removed again, D-42): WhatsApp only approves a media header like `https://host/{{1}}` whose
  sample ends in a file type. `{{1}}` is now `m/<token>.jpg` (the media route ignores `.jpg`) instead of the full URL,
  and `{{2}}` stays the share id. The sample image is `public/samples/delivery.jpg`.
- Templates are named `portrait_studio_delivery_<host hash>_<lang>`: WhatsApp fixes the URLs at approval, so a new
  `PUBLIC_BASE_URL` host gets new templates and the old ones keep working for the old host.
- `--dry-run` reports and changes nothing.

### D-40 Eval: the top 10% of a portrait stays free (user decision)
*2026-10-20.*
- Rule (user): in every portrait, with or without a frame, no head, hair or face reaches into the top 10% of the
  image, because a frame may cover it. The band is checked on the generated image, before any frame is applied.
- `pnpm --filter @portrait-studio/web eval:top-clearance` (`evals/`) generates with the real prompt builder and judges
  the result. It calls the OpenAI API, costs about $3 for 12 images and is not part of `pnpm test`.
  `--dry-run` prints the plan and the cost, `--calibrate-only` runs just the judge check (cents).
- The judge is a vision model shown the image with the top 10% tinted and a red line under it, and answers
  `PASS` or `FAIL: …`. Before any image is generated it must call a synthetic head in the band a FAIL and a clear one a
  PASS, or the run stops: a judge that cannot tell them apart makes every result meaningless.
- **What counts (user):** people (head, hair, hats, goggles, raised hands) and anything the picture is about, such as the
  "crypto.com ARENA" sign. Plain sky, ceiling or a dark background in the band is fine.
- **Correction:** the first version of the judge only looked for people and passed the arena sign, so a first run
  reported 0 of 12. That was wrong. The user's own examples (hair, goggles and the arena sign in the band) showed it. The
  judge now fails all four of them, checked at full resolution, and `tests/live/top-clearance-judge.live.test.ts`
  keeps it honest. The examples were regenerated without a frame, because the framed ones show the frame's own logo in
  the band. They contain faces and stay in `.local/eval-examples/` (git-ignored).
- Result with the corrected judge and the old prompt: **5 of 12 fail** (arena sign 3/4, the user's shelf of model
  landmarks 2/4, uploaded 0/4). Two changes, both by the user's choice:
  1. **An always-on prompt line** (`TOP_FREE_LINE` in `lib/prompts/frame.ts`, placed before the frame line). This
     replaces D-27's "no frame, no change": every prompt now has the line, so all 30 snapshots gained exactly that line.
     The frame line stays and names a larger share when a frame needs it.
  2. **The arena reference photo moved down 14%**, with the sky above it continued by the image model, so the sign sits at
     about 19–30% instead of 4–17%. The model redrew the whole picture (mean colour difference 13.7/255 from the old one),
     so fine detail differs; portraits made with it look the same. The old file is in `.local/la-kings/`. The ice-rink
     reference was left as it is (user: fine).
- With both: **0 of 12** (looked at by eye: the sign clears the line in all four arena portraits). 12 images from 2 photos
  can rule out a frequent failure, not a rare one.
- Run it when the generation prompt, the style prompts, the brand scenes or the image model change, and by hand before
  an event. Not on every merge: nothing in a normal merge can change what the model draws.

### D-41 Frames keep logos and text 60 px inside every edge (user decision)
*2026-10-20.*
- **Finding:** the DS620 prints borderless by scaling the image slightly past the paper and then cutting. Measured with a
  calibration print (1200×1800, rings every 6–12 px, queue options exactly as the agent sends them): the **left and
  right lose about 24 px (2 mm), the top about 30 px (2.5 mm) and the bottom about 36 px (3 mm)**. `fit-to-page` +
  `print-scaling=fill` are correct; there is no white edge. The loss is the printer's, not a queue setting, so it cannot
  be configured away. A Twilio tab logo 35 px from the top came out almost touching the edge.
- **Rule:** anything that is not anchored to an edge, such as a logo, a wordmark or text, stays at least **60 px**
  (`SAFE_ZONE_PX`, 5 mm) from every edge. Shapes that run off the canvas (the tab itself, a tower, a border) are fine
  and must keep running off it, so the cut never shows a gap. 60 px is the worst edge (36 px) plus a margin for
  paper-to-paper variation.
- **Fixed, for `twilio-tab-*` only** (user): the logo in the top tab moved down from 35 to 67 px, and in both bottom tabs
  up from 57 to 71 px. Done by stretching a plain-colour strip at the edge, so the tab outline and the logo are not
  redrawn. `twilio-border-left/right` already pass (94 and 125 px) and were not touched. The London "Assemble" frame
  supplied by the user was fixed the same way; its file is in `exports/london-assemble-safe-zone.png` and is not part of
  the frame list yet.
- **The portrait is not padded or shrunk at print time**: that would show seams on frames with borders.
- **Check:** `pnpm --filter @portrait-studio/web eval:frame-safe-zone [file…]` measures every PNG in `assets/frames/`
  (or the files given) and exits 1 on a violation. It needs no API key and costs nothing; it is not part of `pnpm test`.
  Run it whenever a frame is added or changed. `scripts/frame-safe-zone-fix.ts` makes the shift described above.
- **Not redone:** the admin thumbnails in `public/previews/frames/` still show the old logo position (a few pixels).

### D-42 No delivery template: a portrait outside WhatsApp's 24-hour window is not sent (user decision)
*2026-10-21. Replaces the delivery template of SPEC §6.3 and D-39, and the open TODO about creating it.*
- WhatsApp allows free-form messages only within 24 hours of the person's last message. After that only an approved
  template can be sent. A portrait is normally ready in about a minute, so this only happens when generation takes more
  than a day or an admin approves a flagged image that long afterwards. The user decided a delivery that late is not
  worth sending, and that this is the intended behaviour, not a gap.
- **Behaviour:** `Messenger.send` skips a WhatsApp message outside the window and logs it (`send_skipped`,
  `outside-24h-window`). `deliver()` returns `skipped`; the portrait is not counted as delivered or in the stats. It stays
  on its share page. For an admin approval the review page says it was not sent.
- **Removed:** the `delivery` template and its Twilio setup step in `setup:twilio`, `TWILIO_TEMPLATE_DELIVERY_EN` and
  `_PT_BR` (env, CI, `deploy.sh`, `.env.example`), `Messenger.sendTemplate`, the sample image `public/samples/delivery.jpg`,
  and the `.jpg` suffix the `/m/<token>` route used to ignore for the template's media URL. The runtime quick-reply and
  list-picker templates (SPEC §6.3) are unaffected: they are created inside the window and need no approval.
- If the user ever wants late deliveries, this is the list of what to bring back; D-39 describes the template.

### D-43 Messages go out from the number the person wrote to (found while testing)
*2026-10-21. Follows D-11.*
- **Problem:** a WhatsApp 24-hour window belongs to a sender number. Replies to an incoming message already used the
  number the person wrote to (D-11), but the worker sent the portrait, the print question, the style menu, rejection
  messages and the promo from the event's configured QR number. When a person had written to a different booth number,
  WhatsApp rejected those messages with error 63016 (outside the messaging window) while Twilio had accepted the request,
  so the app logged `sent`. The person saw "Give us a moment to check it" and then nothing.
- **Fix:** the session remembers the booth number the person last wrote to (`boothNumber`, set on every inbound message
  and never erased by one without a recipient). `senderFor()` gives that number to the four worker paths, and falls back
  to the QR number for a session from before this.
- **Left as is:** a person who writes to two booth numbers at one event is answered from the one they used last.

### D-44 Tell the attendee when the printer looks offline; keep the admin printer line current (user decision)
*2026-10-21. Found while testing: with the printer off, a print request still said "It's on its way to the printer".*
- **Attendee reply.** A print request is always queued. The reply now depends on whether a print would come out right now
  (`printerWillPrint`): an agent is connected (heartbeat younger than 45 s) and its printer is not `offline`, `paused`,
  `out_of_paper` or `error`. The simulator counts as ready, because it prints to a folder. If not, the person is told the
  print is queued but the printer seems offline and will print when it is back (`printQueuedPrinterOffline`, en and
  pt_BR). It applies to the chat and to the print button on the share page (`requestPrint` returns `printerReady`).
- **Admin line.** The printer status in the event header polls `GET /admin/events/<id>/printer` every 30 seconds
  (user's choice), pauses while the tab is hidden and refreshes when it is shown. A failed request keeps the last known
  status instead of claiming the printer is offline; after two failures in a row it adds "(not refreshing)". "Last seen
  N min ago" is recounted every 15 s without a request. The events list and the stats page are not live: they are
  opened by navigating, so they are current on arrival.
- **Not done:** a live push over Sync, as the booth screen uses. It would show a change within a second, but needs a
  token endpoint, ACL grants and the Sync SDK in the admin bundle, and an agent that dies still has to be noticed by a
  timer. Polling every 30 s was chosen as enough; the lag is up to 30 s.


### D-45 Printer calibration: measure what the printer trims, then fit prints inside it (user decision)
*2026-11-03. Found while setting up a Mitsubishi CP-D70DW: its "10x15" driver page (448×295 pt) is larger than a 4×6 print and the printer trims the edges, by a different amount on each side.*
- **Config.** Each event has `printCalibration`: whole mm trimmed per edge (`top`, `right`, `bottom`, `left`, 0 to 12; 0 for
  events saved before it existed). It is edited in the event's "Printer calibration" section and saved with the rest.
- **Measuring.** The section has a "Print clipping chart" button. It copies `assets/calibration/clipping-chart.png` (1229×1867,
  the driver page upright, nested rectangles 0 to 12 mm in from each edge) to the event's blobs and queues it for the print
  agent like an admin reprint (`jobId` `clipping-chart`, no quota, no promo, no stats). The admin enters, per edge, the
  lowest number still visible: that is the trim in mm. The chart needs printing on for the event, as the agent cannot connect
  otherwise, and one chart can wait at a time.
- **Applying.** `GET /m/<token>` fits every `.print.png` to the page minus the trims (`applyCalibration`): scaled down, never
  cropped, so frames and borders stay whole, and the leftover is filled by repeating the picture's edge pixels. The output is
  the chart's page size, so CUPS prints it 1:1. It is done on download, not when the print is made, so a changed calibration
  also reaches prints that are already queued, and the stored print PNG stays the 1200×1800 original. All zeros: untouched.
  The chart is a `.chart.png` and is never calibrated.
- **Agent.** The queue's driver is read once from `lpoptions -p <queue> -l`. A queue that lists `ME_10x15` gets
  `-o PageSize=ME_10x15 -o fit-to-page`, with no forced orientation, since that page is landscape and CUPS turns the portrait
  picture; anything else keeps the DS620 options (PROTOCOL.md §5).
- **Limits.** The canvas is fixed to the CP-D70DW page, so the numbers only mean mm on that printer. Another model needs
  its own chart and `CALIBRATION_PAGE`. A DS620 event should leave all four at 0. The doctor learned the CP-D70DW in D-46.

### D-46 The doctor knows both printers; the agent asks which printer to use (user decision)
*2026-11-03. Found after D-45: `printer:doctor` still checked everything against the DS620, and the admin command still said `--simulate`.*
- **Doctor profiles.** `PROFILES` in `apps/print-agent/src/doctor.ts` holds, per printer: how to recognise it (device URI, queue
  name or driver name), its own driver, the queue defaults, the name of a queue it creates. The doctor works out which printer a
  queue is for from its device, then its driver, then the page sizes the driver lists (`ME_10x15` vs `dnp6x4`). If that says
  nothing, `--model ds620|cp70` decides; it never falls back to the DS620. Several queues are listed, not guessed at.
- **CP-D70DW defaults are only `PageSize=ME_10x15`.** That is the one option name checked on the real printer (D-45). More
  can be added to its profile once `lpoptions -p <queue> -l` has been looked at. Its driver is recognised by description, not
  file name, because the PPD's file name was not seen on a real Mac.
- **Windows.** The Windows doctor is unchanged and still only knows the DS620.
- **Start-up question.** With neither `--printer` nor `--simulate`, the agent lists the simulator (1, also the answer to Enter)
  and the printers from `lpstat -p` (`Get-Printer` on Windows), labels the supported models, and asks for a number. It logs the
  flag that skips the question. Without a terminal it exits with code 2. `--printer` together with `--simulate` is refused.
- **Admin command.** It is now `node agent.mjs --url <app> --token <token>`: no printer, no `--simulate`, no `--out` (the
  default `./prints` is the same). This replaces the `--simulate` default from D-33.
- **Leftover "Filter failed".** CUPS keeps this on the queue after a print failed, even when the printer is idle again (seen on the
  CP-D70DW: `com.mitsubishi-error0023`). `parseLpstat` no longer treats it as an `error` that holds back the next print; the status
  stays `idle` with the note "the last print failed". The failed print is still reported by its own job. For other errors, the detail
  is now the reason line, not the "is idle" state line.

### D-47 A dead print job and a dead connection must not stop the agent (found while testing)
*2026-11-03. The agent seemed to stop after a Wi-Fi drop and needed a restart. The logs showed two different causes.*
- **A stopped job blocked the queue.** The CP-D70DW reported an error (`com.mitsubishi-error0023`), its filter exited 1 and CUPS
  left the job `processing-stopped`, which never finishes. The agent treated "stopped" as "still printing" and waited the
  full 10 minutes with the printer idle. It prints one job at a time, so nothing else came out. The heartbeat kept running, so
  the admin showed it online. A restart reset the wait, and ~2 minutes later (the dead job's lease) the next agent resumed it
  first and blocked again.
- **Now:** a job that CUPS has `stopped` or `held` while the printer is ready is cancelled and retried after 30 s (while the
  printer is off or paused it is still waited for). The retry's error carries the job's `job-printer-state-reasons` and
  message. The 10 min stall limit is counted from `timestamps.printing`, so a restart does not start it over; each step counts
  at most 30 s, so a sleeping laptop does not add up to a stall.
- **Reconnecting.** Opening the print queue, reading it, every Sync write and the SDK shutdown now have time limits (30 s,
  shutdown 5 s), and a session that is ending stops waiting for them at once. Before, any of them could stay pending on a
  dead connection and the session never returned to reconnect. This is hardening from reading the code: the logs showed
  one clean reconnect (16:57) and one inconclusive case, so it is not proven to have been a cause.
- **Not done:** printing several jobs at once. One job at a time is what keeps one print one copy (D-25); the two limits above
  bound how long a bad job can hold the line. A hung SDK client that never shuts down is left behind, not killed.

### D-48 Old buttons and menus keep working; a restyle starts a new portrait from the same photo (user decision)
*2026-11-05. Attendees scroll up in the chat to print again, change their answer, or pick another style or background for the photo they already sent. The bot only accepted a style or background while that photo was waiting for an answer.*
- **Print and big-screen buttons** already carried the job id and worked at any time (D-24). New: **No** after an earlier **Yes** removes the
  portrait from the big screen (own portrait only; `slideshowYes` goes down by one, so the stat counts portraits on the screen).
- **Menu ids carry the job id**: `ps:opt:style:<jobId>:<style>` and `ps:opt:background:<jobId>:<background>` (`ACTION_OPTION`). The id fits a WhatsApp
  list item (200 characters). Menus sent before this carried only `opt:<id>`; those are still read, for the photo waiting for an answer.
- **A tap on a menu for the photo waiting for an answer** is the normal flow. **A tap for a photo that was already chosen for** is a **restyle**
  (`optionTap`, `lib/conversation/inbound.ts`): the tapped style or background is used and the other is kept from that photo, so the portrait is
  generated at once with no second menu. The photo was screened already, so the job starts in `queued` with `subjects` and `pet` copied.
- **Quota (user decision).** A restyle counts as a portrait (`quotaLeft`, `inFlight`, stats `imagesRequested`, `style:*`, `background:*`). Nothing
  new to configure.
- **The selfie is copied**, not shared, because removing a portrait (admin or attendee) deletes its selfie. The copy happens before the session is
  written, so a missing photo never leaves a counted slot.
- **Gone photos** (selfie expired after 7 days, job rejected or removed, someone else's job) get `selfie.photoGone`. A photo still being checked gets
  the "still checking" reply. A restyle does not touch a photo that is waiting for an answer: that one stays open.
- **WhatsApp only (user decision).** SMS has no payloads and keeps the numbered, one-step flow.
- **Not done:** WhatsApp's reply context (`OriginalRepliedMessageSid`). It would need every outbound message SID stored; the id inside the button
  or list item says the same without it.

### D-49 Hidden "ALL" at the style prompt renders every style (user decision)
*2026-11-05. People wanted to try all styles with one photo. It is a team feature: no menu, hint, reply or chat-model context mentions it.*
- **Trigger.** While a screened photo waits for its style (`step: awaiting_style`), a text that matches the keyword `all` (pt_BR: `todos`, `tudo`, `all`; `menus.allKeywords`) and no
  button or list selection. Not at the background prompt, not with an event that has one style (there is no style prompt). WhatsApp and SMS.
- **What it does** (`allStyles`, `lib/conversation/inbound.ts`). One job per enabled style on `gradient` (the event's first background without it). The waiting job gets the
  first style (`choose` effect); the rest are created as in a restyle (D-48) with `batch: true`. One confirmation message; portraits arrive as they finish.
- **Quota (user decision).** One slot per style: `quotaLeft + 1 >= number of styles` (the waiting photo already holds one). Otherwise a message says how many are needed and left,
  the style menu is sent again, and nothing is created. No special exemption, so the per-person limit still bounds the cost (up to 6 generations per `ALL`).
- **No question after the images (user decision).** `Job.batch` makes `deliver` skip the print / big-screen question and leave `pendingSlideshow` alone. The portraits are
  still counted and kept in `session.delivered`, so `PRINT` lists them. Nothing goes on the big screen without an answer.
- **Copies before the session.** The selfie copies are made before the session is written, so a failed copy never leaves a counted slot (as in D-48).
- **Not done:** an "ALL" for a restyle (an old menu has no free text) and a summary question after the last image.

### D-50 Count what happens on the share page (user decision)
*2026-11-05. We did not know how many attendees open their share link or use its buttons, so we could not tell whether the page is worth the work.*
- **Counters in the event's stats** (SPEC §10.5): `shareViews`, `shareLinksOpened`, `shareShares`, `shareTextCopied`, `shareDownloads`. They reset with the other counters.
  The stats page has a "Share page" card; "portraits whose link was opened" is shown against the portraits delivered.
- **Views are sent by the page, not counted on the server**: `ShareTracker` runs in the browser after load, once per portrait and tab session (`sessionStorage`).
  The crawlers that fetch a link for its preview (WhatsApp, iMessage, Slack) do not run JavaScript, so they are not counted; a reload is not counted twice.
  Opening your own link counts. Clicks (share, copy, download) are counted per click, not per person.
- **Share** counts when the phone's share sheet completes (`navigator.share` resolved), not when it is dismissed. **Copy text** is counted apart. **Download** counts the
  link and the fallback used where sharing files is not supported.
- **First open** is stored as `openedAt` on the share record, so "links opened" counts portraits, not visits.
- **No personal data**: the page sends only the share id and the kind; the event comes from the share record (`trackShareAction`), so a made-up id counts nothing, and a
  link that is unknown, expired or whose portrait was removed is ignored. Anyone with a link can still raise its counters by calling the action, which is accepted for aggregate numbers.
- **Not done:** unique visitors (would need a cookie or an identifier), referrer or device data, and counting print taps on the share page (prints are already counted).

### D-51 Image model is `gpt-image-2.6-flare` (replaces the model of D-01)
*2026-11-05.* OpenAI released `gpt-image-2.6-flare` and `gpt-image-2.6-sunburst`, as it did for 2.5. Flare stays the choice (D-01: about half the time of sunburst).
- **What changed:** the default of `OPENAI_IMAGE_MODEL` in `lib/env.ts` and `.env.example`. `lib/env.ts` is now the only place with the model names (image, vision and chat):
  the top-clearance eval and the live tests read them with `getEnv()` instead of repeating the strings. Production sets the variable explicitly, so the code default alone changes nothing there. The
  `OPENAI_IMAGE_MODEL` variable of the GitHub `production` environment was set to `gpt-image-2.6-flare` on 2026-11-05 (it was `gpt-image-2.5-flare`); the container apps
  take it at the next deploy.
- **To check on 2.6 before an event** (D-01, D-02, D-40 were measured on 2.5): `background: "transparent"` still works and the subject alpha is still about 253 (the 250
  threshold in D-02); `input_fidelity` is still rejected (it is not sent); the time per image; the cost per portrait (priced per token); the top margin
  (`pnpm --filter web eval:top-clearance`; the full run is 54 images, about $13.50, not the $3 the SPEC used to say); and the likeness of the styles on real photos.
- **Checked on 2026-11-05** (mirror selfie, all six styles, three backgrounds): unit, integration and end-to-end tests and the frame safe-zone eval pass. With the prompts of D-40 the **uploaded
  background failed 6 of 6** on 2.6 (the same two styles on 2.5 passed): the hair reached into the top 10% (about 60 px for pop-art, the whole hair for cartoon), the scene backgrounds passed 12 of 12.
  Not run: the other two photos, the live pipeline test, alpha level, cost and time per image.
- **Why, and the fix (user decision: 2.6 goes to production):** the margin line said the strip stays "plain background", which makes no sense for a cut-out, and a model told "10%" puts the hair
  right on the 10% line. Changes in `lib/prompts/frame.ts` and `build.ts`: ask for **13%** (about 200 px, from one constant), say it in pixels, repeat it in the final reminder, and word the strip
  per background (`stripRule`). Result: **17 of 18 fail-free** (the uploaded sketch crossed the line by a few pixels; one sample).
- **Blank banner on the original background:** with "plain background" the model left a flat band across the top of portraits made with the original background (a flat orange strip in pop-art, bare paper
  in the sketch). Scene backgrounds are now told to fill the strip: "continue the scene up to the top edge (more wall, ceiling, sky…), with no blank band, flat color block, solid stripe or border".
  The six originals now show the ceiling, a row of tiles and the door frame; pop-art is still the most band-like (an orange halftone ceiling). The arena and uploaded cases were not regenerated after this change.
- **Likeness wording (the middle ground):** the strict wording of the first likeness change made cartoon and pop-art look like unedited photos. The shared preserve line now says "an illustration of this person,
  not a photo: simplify and stylize boldly" and keeps face shape and jaw width, hairstyle and the hair, eye and skin *color family*. Cartoon has its rounded Pixar features back, with the jaw width kept;
  pop-art puts the bold palette on the background, clothing, shadows and highlights and keeps hair and eyes in their own color family. The user liked the six styles.
- **A mistake worth remembering:** the eval marks the top 10% with a red overlay, which turns any dark hair inside it red. For a while that was read as "2.6 recolors hair", and a cartoon lighting line
  ("the warm light tints skin and fabric only: hair keeps the exact color it has in the photo") was added for it. The hair was never recolored. The line is harmless and was kept; check the unmarked image before
  blaming the model.
- **Eval:** `--background=` joins `--style=` and `--people=`.
- **If an uploaded-background event still shows heads cut by a frame tab:** raise the asked margin, or set `OPENAI_IMAGE_MODEL=gpt-image-2.5-flare` in the `production` environment and deploy.

### D-52 Up to 6 people in a portrait (user decision)
*2026-11-08. The limit was 4 people. Groups at events are bigger.*
- **One number:** `MAX_SUBJECTS` in `lib/pipeline/run.ts` (now 6). The rejection message takes it as a parameter (`job.tooManyPeople({ max })`, English and Portuguese), so the number is no longer
  written in the catalogs. The tests and the docs name 6 on purpose; a change of the limit means editing `MAX_SUBJECTS`, the message test and the two doc lines (SPEC §5.6, §5.8, §9.2, `docs/how-it-works.md`).
- **Unchanged:** the scene analysis counts only the primary people (bystanders, edge figures and people on screens do not count); the generation prompt already names the exact count and, for groups, says
  not to merge or blend faces; `Job.subjects` allows up to 10.
- **Not checked:** how well the image model draws 5 and 6 faces on one 1024x1536 portrait (faces get small, and the model may merge or drop people), and how reliably the vision model counts 5 or 6.
  The top-clearance eval has only a 3-person photo. Try a real 5 and a 6-person photo, in every style, before an event with groups.

