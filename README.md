# Portrait Studio

Portrait Studio for events. Attendees scan a QR code, send a selfie over WhatsApp or SMS, pick a style, and get back
an AI portrait with a share link. If the event has a printer, they can print it at the booth.

## How it fits together

```text
 attendee ──WhatsApp/SMS──▶ Twilio Messaging ──webhook──▶ web (Next.js) ──▶ Twilio Sync (all state)
                                                              │                  ▲   │
 booth screen ◀── Sync push (read-only token) ────────────────┘                  │   ▼
                                                        worker ── OpenAI ── Azure Blob Storage (images, 7 days)
 print agent (booth laptop) ◀── Sync push (scoped token) ──▶ DNP DS620
```

| Path | What it is |
|---|---|
| `apps/web` | Next.js app: admin, booth screen, share page, Twilio webhook, print agent API |
| `apps/web/worker` | Background worker: photo checks, generation, AI review, delivery (same image, separate process) |
| `apps/print-agent` | Standalone Node.js print agent for the booth computer ([README](apps/print-agent/README.md), [protocol](apps/print-agent/PROTOCOL.md)) |
| `docs/` | [Deployment](docs/deployment.md) and the [decisions log](docs/decisions.md) (changes to [SPEC.md](SPEC.md)) |

- **Twilio Sync** holds all state: events, sessions, jobs, print queue, stats. Hot objects are sharded (D-03).
- **Conversation Memory** recognises returning attendees; **Verify** (email via SendGrid) confirms lead emails.
- **Azure Blob Storage** holds selfies and portraits for 7 days. Locally, compose runs Azurite.
- `/healthz` is liveness; `/healthz/ready` checks Sync and Blob Storage.

## Setup

### 1. Tools

- **Node.js 24** (`.nvmrc`; `nvm install`) and **pnpm 10** (`corepack enable`)
- **Docker or Podman** with Compose, for the local stack (Podman on macOS: `brew install docker-compose`)
- **ngrok** or another HTTPS tunnel, so Twilio can reach your laptop
- For deploying: Azure CLI 2.60+ ([docs/deployment.md](docs/deployment.md))

### 2. Configuration

```sh
pnpm install
cp .env.example .env.local
```

Every process reads the repo-root `.env.local`. In development it wins over shell variables, so a `TWILIO_*` exported
for another project is never used by mistake.

| Variables | Where they come from |
|---|---|
| `PUBLIC_BASE_URL` | Your tunnel (`https://<name>.ngrok.app`) locally; printed by `./deploy.sh` on Azure |
| `ADMIN_USER`, `ADMIN_PASSWORD` | You choose. Basic auth for `/admin` and `/booth` |
| `MEDIA_SIGNING_SECRET`, `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | Generate once: `openssl rand -base64 48` / `32` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Console → Account info |
| `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET` | Console → API keys & tokens → Create API key (Standard) |
| `TWILIO_MESSAGING_SERVICE_SID` | The Messaging Service with the booth's SMS numbers and WhatsApp senders (see step 3) |
| `TWILIO_SYNC_SERVICE_SID`, `TWILIO_VERIFY_SERVICE_SID`, `TWILIO_MEMORY_STORE_ID`, `TWILIO_TEMPLATE_DELIVERY_EN` / `_PT_BR` | Printed by `setup:twilio` (step 3) |
| `OPENAI_API_KEY` | platform.openai.com → API keys. Models default to the values in `.env.example` |
| `AZURE_STORAGE_CONNECTION_STRING`, `AZURE_STORAGE_CONTAINER` | Empty locally (Azurite); `./deploy.sh` creates them on Azure |

`.env.example` describes every variable, including optional ones (`LOG_LEVEL`, `WORKER_CONCURRENCY`, deploy overrides).

### 3. Twilio resources

In the Console (the API cannot do these):

1. **Messaging Service** with the booth numbers. WhatsApp senders are registered through WhatsApp self sign-up.
2. **SendGrid email integration** for Verify. After step 3 below, link it to the Verify Service (Verify → Services →
   the service → Email) and set its dynamic template to [`verification-email.html`](apps/web/assets/email/verification-email.html)
   (subject "Your Portrait Studio verification code").

Then let the script do the rest:

```sh
pnpm --filter web setup:twilio --dry-run    # shows what it would do
pnpm --filter web setup:twilio --public-base-url https://<deployed host>
```

It finds or creates the Sync Service, Verify Service and Memory store, points the Messaging Service at
`/api/twilio/inbound`, and submits the WhatsApp delivery templates. It is safe to run again and never creates
duplicates; it never changes a shared Memory store, and only takes inbound traffic from another app with
`--take-over-inbound`. Copy the values it prints into `.env.local`. **Run it again after WhatsApp approves the
templates** (minutes to 24 hours) to get their SIDs. Details: [docs/deployment.md](docs/deployment.md) §4, D-39.

Use the deployed host for templates: WhatsApp fixes their URLs at approval, so templates made for a tunnel only work
on that tunnel.

### 4. Run locally

```sh
ngrok http 3000 --url <name>.ngrok.app      # PUBLIC_BASE_URL must match
pnpm dev                                    # web on http://localhost:3000
pnpm --filter web worker                    # worker, second terminal
```

Or everything in containers: `docker compose up --build` (or `podman compose up --build`).

To test messages against your laptop, point the Messaging Service at the tunnel with
`pnpm --filter web setup:twilio --take-over-inbound`, and back at the deployed app the same way afterwards. While it
points at your laptop, the deployed app receives nothing.

### 5. Deploy

`./deploy.sh` deploys web and worker to Azure Container Apps; CI deploys every push to `main`.
See [docs/deployment.md](docs/deployment.md).

## Running an event

1. **Create the event** in `/admin`: name, language, styles, backgrounds, frame, limits, the QR number and message.
2. **Booth screen:** open the event's **Booth** link full screen on the booth display.
3. **Printer** (optional): turn printing on for the event, then set up the booth laptop (below).
4. **Go live.** Use **Break** for pauses and **End** afterwards: attendees then get the ended reply.
5. **Review** (`/admin/events/<id>/review`): approve or discard portraits the AI review flagged; take down delivered ones.
6. **Stats** tab on the event page. Leads: `pnpm --filter web leads:export`. Reset counters: `pnpm --filter web stats:reset --event <id>`.

### Booth printer (DNP DS620, 4x6)

On the booth laptop (macOS; Windows is beta, Linux not yet supported):

1. **Install Node.js 24 or newer** from [nodejs.org](https://nodejs.org) (`node --version`).
2. **Install the DNP DS620 driver** from DNP ([dnpphoto.com/downloads](https://www.dnpphoto.com/downloads), DS620 macOS driver), then connect
   the printer by USB. macOS's automatic *Generic PostScript* driver prints the wrong size.
3. **Copy the agent**: build it with `pnpm --filter @portrait-studio/print-agent build` and copy
   `apps/print-agent/dist/agent.mjs` to the laptop. It is one file with nothing to install.
4. **Run the printer doctor**, which checks and fixes the print queue: DS620 driver, paused queue, 4x6 glossy
   defaults, and creates the queue if none exists.

   ```sh
   node agent.mjs doctor          # check only
   node agent.mjs doctor --fix    # repair (prefix with sudo if it asks for admin rights)
   ```

5. **Start the agent** with the command from the event page (token and URL filled in). Try `--simulate` first, then
   replace `--simulate --out ./prints` with `--printer <queue>` (the queue name doctor printed).

The event page shows the printer's status. See the [print agent README](apps/print-agent/README.md) for flags and
troubleshooting.

## Tests

```sh
pnpm lint && pnpm typecheck
pnpm test                      # unit and integration (vitest)
pnpm test:e2e                  # Playwright, with in-memory Sync and Blob (no credentials)
```

Live tests are opt-in and use the real services in `.env.local`: `RUN_LIVE_AI_TESTS=1` (OpenAI, about $0.20),
`RUN_LIVE_SYNC_TESTS=1`, `RUN_LIVE_INBOUND_TESTS=1` and `RUN_LIVE_DELIVERY_TESTS=1`. The last two send **real**
messages to `LIVE_TEST_PHONE`, need `pnpm dev` (and the worker, plus the tunnel, for delivery), and never run in CI;
see the comment at the top of each file in `apps/web/tests/live/`.

### Real-life test checklist

Before an event, and after any major upgrade (SPEC §16):

- [ ] 5+ people from different regions, including the event's, on **WhatsApp and SMS**, several at the same time
- [ ] QR code opens the right number with the event's message; the first message lands in the right event
- [ ] Consent, lead collection with the email code (if on), style and background menus
- [ ] A portrait with the event's **uploaded background** and **frame**
- [ ] A group photo, and a photo that should be rejected (no face)
- [ ] A **flagged** portrait approved in the admin review
- [ ] **Print + show** prints on the DS620 and appears on the booth screen; also a `--simulate` run
- [ ] **Break** and **End**: the booth screen and the replies change
- [ ] A **deletion request** ("delete my data") removes the person's data
- [ ] The share page opens, downloads and shares on iOS and Android
