#!/bin/sh
# Container entry point for the worker process (SPEC §3.2). `exec` hands
# SIGTERM straight to Node so the worker can shut down cleanly.
cd "$(dirname "$0")/.." && exec node --import tsx worker/main.ts
