#!/bin/sh
# Container entry point for the worker process (SPEC §3.2). `exec` hands
# SIGTERM straight to Node so the worker can shut down cleanly.
# --conditions=react-server: same module resolution as the Next.js server, so
# shared `server-only` modules load in the worker.
cd "$(dirname "$0")/.." && exec node --conditions=react-server --import tsx worker/main.ts
