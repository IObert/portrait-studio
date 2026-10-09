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

With containers:

```sh
cp .env.example .env
docker compose up --build      # or: podman compose up --build
curl localhost:3000/healthz
```

## Tests

```sh
pnpm lint
pnpm typecheck
pnpm test                      # unit tests (vitest)
pnpm test:e2e                  # Playwright (builds and starts the web app)
```

Live AI tests run only with `RUN_LIVE_AI_TESTS=1`.

## Print agent

```sh
pnpm --filter print-agent build
node apps/print-agent/dist/agent.mjs --url http://localhost:3000 --token <token> --simulate --out ./prints
```

## Coming in later milestones

Architecture overview, webhook tunnel setup, Azure Container Apps deployment (both topologies),
Twilio resource setup (`pnpm --filter web setup:twilio`), the full environment variable table,
and the real-life test checklist.
