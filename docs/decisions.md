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

### D-06 Booth screen updates over server-sent events (picks an option in §10.4)
*2026-10-09.* The booth uses server-sent events from the web app instead of a browser Sync token. This
avoids Sync ACLs and keeps the booth from reading other events' data.

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

### D-16 Admin removals do not end the job
*2026-10-12.* SPEC §9.1 lists `delivered → removed_by_admin` for "slideshow/print removal only". Removing an image
from the slideshow or the print queue changes only that list. The job stays `delivered`, so the attendee keeps their
portrait and share link. `removed_by_admin` is not used. Discarding a flagged image ends it as `rejected` with
`error: discarded_by_admin`.

### D-17 Booth screen updates
*2026-10-12.* `/booth/[slug]/stream` (SSE, behind basic auth) polls Sync every 2 s per connection and pushes the full
state only when the event state, its config or the slideshow list changes. It sends a heartbeat every 15 s and
`X-Accel-Buffering: no` so proxies don't buffer the stream. A screen costs about 0.5 Sync reads per second. The client
keeps the last state on screen and reconnects with exponential back-off (up to 30 s).

## Open TODOs after the last milestone

- **Profile deletion in the shared Memory store** (user, 2026-10-12): needs a broader discussion once the app is done.
  The current behaviour (D-12) is a best guess. Every relevant line is tagged `TODO(profile-deletion)`; list them
  with `git grep -n "TODO(profile-deletion)"`. The deletion-request tool (milestone j) will add more tags.

- **Email templates for all activations** (requested 2026-10-10): update the SendGrid verification templates used by
  every activation's Verify email integration (Portrait Studio, Mixologist, Wheel of Twilio, …). For Portrait Studio,
  the template renders the `{{consent_text}}` substitution (privacy notice and consent, SPEC §5.4); confirmed by the
  user, 2026-10-12. The other activations' templates still need the same update.

## Answers to SPEC §17

| Q | Decision |
|---|---|
| Q1 Transparency | The spike failed on gpt-image-2. See D-01. |
| Q2a Memory profile in Case C | No profile. Only a lead record is written. |
| Q2b Returning profile without a verified email, at an event that collects leads | Greet them by name, skip the name step, then ask for email and code. |
| Q3 Framing | Chest up for every style. Cartoon's hard-coded "waist up" is replaced by the shared composition text. `{preserve}` uses the settings text in PROMPTS.md §C. |
| Q4 Fixed frames | Ship `none` plus one placeholder border, clearly marked as a placeholder, until real 1200×1800 PNGs are supplied. |
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
