# Portrait Studio print agent

Prints portraits at the booth on a DNP DS620 (4x6), or to a folder in simulator mode.
It runs on the booth computer, needs no installation, and is a plain Node.js script, never a
compiled binary or app bundle, so macOS Gatekeeper does not get in the way (SPEC §11.1).

## Requirements

- **Node.js 22 or newer** (`node --version`)
- For real printing: CUPS with the DNP DS620 queue set up (`lpstat -p`)
- The event's **printer token**, shown once in the admin UI with a ready-to-copy command

## Run it

Simulator, no printer needed:

```sh
node agent.mjs --url https://<app> --token pst_<event>_<secret> --simulate --out ./prints
```

With a printer:

```sh
node agent.mjs --url https://<app> --token pst_<event>_<secret> --printer DNP_DS620
```

| Flag | Meaning |
|---|---|
| `--url` | The app's public URL |
| `--token` | The event's printer token (admin UI → event → Print agent) |
| `--printer` | CUPS queue name; required unless `--simulate` |
| `--simulate` | Do not print; only save the copy in `--out` |
| `--out` | Folder that keeps a copy of **every** print, in both modes, for manual reprints (default `./prints`). Files are named `<time>_<jobId>.png`. |
| `--help`, `--version` | Print usage or the version |

Logs go to the console as readable lines. Stop it with Ctrl-C.

## What it does

1. Exchanges the printer token for a short-lived Twilio Sync token, and refreshes it before it expires.
2. Watches the event's print queue and claims one job at a time, so several agents never print the same job.
3. Downloads the 1200×1800 PNG from a signed link and prints it, waiting for CUPS to finish.
4. Reports the printer's status and a heartbeat every 15 seconds; the admin UI shows both.
5. Retries a failed print up to 3 times, then marks it failed. The attendee already has their image, so nothing is
   sent to them.
6. Reconnects by itself after a network drop and carries on with what is still queued.

The agent never messages attendees. The server counts prints and sends the promo (SPEC §5.9).

## Build

`dist/agent.mjs` is a single self-contained file (about 870 KB), so there is nothing to install on the booth computer:

```sh
pnpm --filter print-agent build
```

## Troubleshooting

| Symptom | What to do |
|---|---|
| `The printer token was rejected` | The token was rotated, or printing is off for the event. Copy the new command from the admin UI. |
| `Node.js 22 or newer is required` | Install a newer Node.js. |
| `Invalid CUPS queue name` | Use the exact queue name from `lpstat -p` (letters, digits, `_`, `.`, `-`). |
| Status shows `offline` | The queue does not exist or the printer is unreachable. Check `lpstat -p <queue>`. |
| Status shows `out_of_paper` | Replace the paper or ribbon. |
| Prints look wrong (cropped, bordered) | The DS620 options need checking on real hardware: run `lpoptions -p <queue> -l` and compare with PROTOCOL.md §5. The agent logs these options at start-up. |

The protocol between the agent and the server is documented in [PROTOCOL.md](PROTOCOL.md).
