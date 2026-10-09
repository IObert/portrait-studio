# Print agent ↔ server protocol

This file is the contract between `apps/print-agent` and `apps/web` (SPEC §3.1, §11).
The two projects share no code; both sides test against the examples here.

> Status: placeholder. The protocol is designed and documented in milestone i.

Planned surface:

- `POST /api/agent/token`: exchange the event printer token for a short-lived, scoped credential.
- Print queue `ev_<slug>_print` and status document `ev_<slug>_printer` (§11.3).
- Heartbeat and printer status every 15 s.
