# Portrait Studio

An AI photo booth for events. Attendees scan a QR code, send a selfie over WhatsApp or SMS,
and get back a stylized AI portrait, printed at the booth if the event has a printer.

> This README grows with each milestone. The sections marked *(coming)* are filled in as those parts are built.

## Repository layout

| Path | What it is |
|---|---|
| `apps/web` | Next.js app (App Router): admin, booth screen, share page, privacy page, webhooks, agent API |
| `apps/web/worker` | Background worker (same codebase and image, separate process) |
| `apps/print-agent` | Standalone Node.js print agent for the booth computer, see [`PROTOCOL.md`](apps/print-agent/PROTOCOL.md) |
| `Dockerfile` | One image for web and worker |
| `compose.yaml` | Local stack: web, worker, Azurite (Blob Storage emulator) |

## Data layer

- **Twilio Sync** holds all application state (SPEC §3.4). `apps/web/lib/sync/` has a typed store that validates every
  item with zod, rejects payloads over 15 KiB, retries 429/5xx with backoff, and does read-modify-write with
  `If-Match` revisions. Every Sync rate-limit response logs a `WARN` with `event: "sync_rate_limited"` and the
  object name. Hot objects (`dedup`, per-event `stats`) are sharded across several maps
  ([decision D-03](docs/decisions.md)).
- **Azure Blob Storage** holds images (SPEC §7) in a private container. Outside readers get short-lived, read-only SAS URLs.
  Locally, compose runs Azurite.
- `/healthz` is liveness. `/healthz/ready` returns 503 unless Sync and Blob Storage are reachable.

## Prerequisites

- Node.js 24 (see `.nvmrc`); the print agent supports Node 22+
- pnpm 10 (`corepack enable`)
- Docker or Podman with a Compose provider (for Podman on macOS: `brew install docker-compose`)

## Local development

```sh
pnpm install
pnpm dev                       # web app on http://localhost:3000
pnpm --filter web worker       # worker in a second terminal
```

All processes read one file, the repo-root `.env.local` (copy it from `.env.example`).

With containers:

```sh
cp .env.example .env.local
docker compose up --build      # or: podman compose up --build
curl localhost:3000/healthz
```

## Deployment

Azure Container Apps via `./deploy.sh`. CI deploys automatically on every push to `main`.
See [docs/deployment.md](docs/deployment.md).

## Decisions

Product decisions made after SPEC.md are recorded in [docs/decisions.md](docs/decisions.md).

## Tests

```sh
pnpm lint
pnpm typecheck
pnpm test                      # unit tests (vitest)
pnpm test:e2e                  # Playwright (builds and starts the web app)
```

Live tests are opt-in and use real services from `.env.local`:

```sh
RUN_LIVE_AI_TESTS=1 pnpm test      # OpenAI (costs money)
RUN_LIVE_SYNC_TESTS=1 pnpm test    # Twilio Sync (throwaway map, deleted afterwards)
```

## Print agent

```sh
pnpm --filter print-agent build
node apps/print-agent/dist/agent.mjs --url http://localhost:3000 --token <token> --simulate --out ./prints
```

## Coming in later milestones

Architecture overview, webhook tunnel setup,
Twilio resource setup (`pnpm --filter web setup:twilio`), the full environment variable table,
and the real-life test checklist.
