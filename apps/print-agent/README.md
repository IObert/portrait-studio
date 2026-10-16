# Portrait Studio print agent

Prints portraits at the booth on a DNP DS620 (4x6), or to a folder in simulator mode.
It runs on the booth computer, needs no installation, and is a plain Node.js script, never a
compiled binary or app bundle, so macOS Gatekeeper does not get in the way (SPEC §11.1).

## Requirements

- **Node.js 22 or newer** (`node --version`)
- For real printing: CUPS with the DNP DS620 queue set up (`lpstat -p`)
- The event's **printer token**, shown in the admin UI with a ready-to-copy command

## Run it

Simulator, no printer needed:

```sh
node agent.mjs --url https://<app> --token <event>.XXXX-XXXX-XXXX-XXXX --simulate --out ./prints
```

With a printer:

```sh
node agent.mjs --url https://<app> --token <event>.XXXX-XXXX-XXXX-XXXX --printer DNP_DS620
```

## Printer doctor

Run this first on a new booth computer, and whenever prints look wrong:

```sh
node agent.mjs doctor          # check only, changes nothing
node agent.mjs doctor --fix    # repair what it can
```

From the repo, the same as package scripts (they build the agent first):

```sh
pnpm --filter @portrait-studio/print-agent printer:doctor   # check
pnpm --filter @portrait-studio/print-agent printer:fix      # repair
```

(Not `pnpm doctor`: that is pnpm's own built-in command.)

It finds the DS620 queue (or pass `--printer <queue>`) and checks:

- **Driver.** macOS often sets the DS620 up with the *Generic PostScript Printer* driver, which prints wrong sizes.
  `--fix` switches the queue to the DNP DS620 driver (`lpadmin -m …/DNP-DS620.ppd.gz`). If that driver is not
  installed, install it from DNP first.
- **Queue state.** A paused queue is enabled again (`cupsenable`), and one that rejects jobs is set to accept them (`cupsaccept`).
- **Defaults**, so prints from the agent and from anything else match: `PageSize=dnp6x4`, `Cutter=Normal`,
  `Finish=Glossy`, `Resolution=300x300dpi`, `AdjustmentsEnabled=False` (no driver colour changes) and `BonusPrint=False`.
- **No queue yet.** With a DS620 on USB but no queue, `--fix` creates `Dai_Nippon_Printing_DP_DS620`.

It exits with 0 when everything is fine. If a fix needs admin rights, it says so; run the same command with `sudo`.

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
| Status shows `paused` | Run `node agent.mjs doctor --fix`, or `cupsenable <queue>`. |
| `Invalid CUPS queue name` | Use the exact queue name from `lpstat -p` (letters, digits, `_`, `.`, `-`). |
| Status shows `offline` | The queue does not exist or the printer is unreachable. Check `lpstat -p <queue>`. |
| Status shows `out_of_paper` | Replace the paper or ribbon. |
| Prints look wrong (cropped, bordered, wrong size) | Run `node agent.mjs doctor --fix`. Usually the queue uses the Generic PostScript driver. |

## Other platforms (beta)

**Linux** should work through CUPS, but is not supported yet. DNP's driver is for macOS and Windows only; with
Gutenprint the DS620 option names differ, so prints may use the wrong settings and `doctor` reports the driver as
missing. See the `TODO(linux)` notes in the code.

**Windows (beta)** is **untested on real hardware**; the agent and `doctor` say so when they start. On Windows the agent prints through the Windows
spooler with PowerShell instead of CUPS; `--printer` is the Windows printer name (`Get-Printer`), for example
`--printer "DP-DS620"`. Before using it at an event, work through every `CRITICAL(windows)` note in
[src/windows.ts](src/windows.ts). In short:

- Set cutter, glossy finish, resolution and no colour adjustment once in the printer's **Printing Preferences**:
  the agent cannot set them, and `doctor` cannot check them.
- Turn on **Keep printed documents** (`node agent.mjs doctor --fix` in an Administrator terminal). Without it the
  agent cannot tell a printed job from a cancelled one.

The protocol between the agent and the server is documented in [PROTOCOL.md](PROTOCOL.md).
