# Portrait Studio print agent

Prints portraits at the booth on a DNP DS620 or a Mitsubishi CP-D70DW (4x6), or to a folder in simulator mode.
It runs on the booth computer, needs no installation, and is a plain Node.js script, never a
compiled binary or app bundle, so macOS Gatekeeper does not get in the way (SPEC §11.1).

## Requirements

- **Node.js 24 or newer** (`node --version`)
- For real printing: CUPS with the printer's queue set up (`lpstat -p`)
- The event's **printer token**, shown in the admin UI with a ready-to-copy command

## Run it

```sh
node agent.mjs --url https://<app> --token <event>.XXXX-XXXX-XXXX-XXXX
```

That is the command the admin UI shows. It names no printer, so the agent asks:

```text
Which printer should this agent use?
  1) Simulator (nothing is printed; copies are saved to the output folder)
  2) Dai_Nippon_Printing_DP_DS620 (DNP DS620)
  3) MITSUBISHI_CP60D70D707D (Mitsubishi CP-D70DW)
Number [1]:
```

Enter the number; Enter alone picks the simulator. The agent logs the flag that skips the question next time. To skip it
now, or to start the agent without a terminal (it exits with an error there), name the choice:

```sh
node agent.mjs --url … --token … --simulate            # no printer needed, copies go to ./prints
node agent.mjs --url … --token … --printer DNP_DS620   # a CUPS queue (a Windows printer name on Windows)
```

## Supported printers

| Printer | Driver | What the agent sends |
|---|---|---|
| DNP DS620 | DNP's `DNP-DS620` PPD | `PageSize=dnp6x4`, `Cutter`, `Finish`, `Resolution`, portrait |
| Mitsubishi CP-D70DW | "MITSUBISHI CP70D Series" PPD | `PageSize=ME_10x15`, `fit-to-page`; CUPS turns the portrait picture onto its landscape page |

These two are what is supported now, and the list can be extended. The agent prints to any CUPS queue; what differs per
driver is the option names. It reads the queue's `lpoptions -p <queue> -l` once and picks the set that fits. A queue it does
not recognise gets the DS620 options, which a different driver ignores, so the print comes out on that queue's default page.
To add a printer:

1. Install its driver and look at the real option names: `lpoptions -p <queue> -l`.
2. In `src/cups.ts`, add an options constant, a name to `Driver`, a rule for it in `driverOf` and a branch in `lpArgs`.
3. Add a case to `tests/cups-queue.test.ts` with the real `lpoptions` output, and note it in [PROTOCOL.md](PROTOCOL.md) §5.
4. For the web app's "Printer calibration", the chart and `CALIBRATION_PAGE` are sized for the CP-D70DW; another model needs
   its own (D-45).
5. For `doctor`, add a profile to `PROFILES` in `src/doctor.ts` (how to recognise the printer, its driver, the queue
   defaults) and a case to `tests/doctor.test.ts`.

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

It finds the queue of a DS620 or CP-D70DW (or pass `--printer <queue>`), works out which of the two it is, and checks
that printer's setup. The output names it, for example `Queue: MITSUBISHI_CP60D70D707D (Mitsubishi CP-D70DW)`.
With queues for both printers, it lists them and asks for `--printer`. If it cannot tell what a queue is for (say a
generic driver on a network printer), pass `--model ds620` or `--model cp70`.

| Check | DNP DS620 | Mitsubishi CP-D70DW |
|---|---|---|
| **Driver.** macOS often sets a printer up with the *Generic PostScript Printer* driver, which prints wrong sizes. `--fix` switches the queue to the printer's own driver (`lpadmin -m …`). If it is not installed, install it first. | DNP's `DNP-DS620` PPD (dnpphoto.com) | the "MITSUBISHI CP70D Series" PPD (Mitsubishi's CP-D70 series driver) |
| **Defaults**, so prints from the agent and from anything else match. | `PageSize=dnp6x4`, `Cutter=Normal`, `Finish=Glossy`, `Resolution=300x300dpi`, `AdjustmentsEnabled=False` (no driver colour changes), `BonusPrint=False` | `PageSize=ME_10x15` only. The other option names of this driver were not checked yet. |
| **No queue yet.** With the printer on USB but no queue, `--fix` creates one. | `Dai_Nippon_Printing_DP_DS620` | `Mitsubishi_CP_D70DW` |

For both, a paused queue is enabled again (`cupsenable`), and one that rejects jobs is set to accept them (`cupsaccept`).
The CP-D70DW's driver file name was not checked on a real Mac, so `doctor` recognises it by its description
("Mitsubishi … CP70D"); if it reports the driver as missing although it is installed, check `lpinfo -m`.

It exits with 0 when everything is fine. If a fix needs admin rights, it says so; run the same command with `sudo`.

| Flag | Meaning |
|---|---|
| `--url` | The app's public URL |
| `--token` | The event's printer token (admin UI → event → Print agent) |
| `--printer` | CUPS queue name (Windows printer name on Windows). Without it and without `--simulate`, the agent asks (see "Run it") |
| `--simulate` | Do not print; only save the copy in `--out` |
| `doctor --model` | `ds620` or `cp70`: which printer a queue is for, when `doctor` cannot tell |
| `--out` | Folder that keeps a copy of **every** print, in both modes, for manual reprints (default `./prints`). Files are named `<time>_<jobId>.png`. |
| `--help` (`-h`), `--version` | Print usage or the version |

Logs go to the console as readable lines. Stop it with Ctrl-C.

## What it does

1. Exchanges the printer token for a short-lived Twilio Sync token, and refreshes it before it expires.
2. Watches the event's print queue and claims one job at a time, so several agents never print the same job.
3. Downloads the 1200×1800 PNG from a signed link and prints it, waiting for CUPS to finish.
4. Reports the printer's status and a heartbeat every 15 seconds; the admin UI shows both.
5. Retries a failed print up to 3 times, then marks it failed. The attendee already has their image, so nothing is
   sent to them.
6. Reconnects by itself after a network drop (or when Sync has been silent for 60 s) with a fresh token and carries on
   with what is still queued. A print already at the printer is waited for, never printed again.

The agent never messages attendees. The server counts prints and sends the promo (SPEC §5.9).

## Build

`dist/agent.mjs` is a single self-contained file (about 870 KB), so there is nothing to install on the booth computer:

```sh
pnpm --filter @portrait-studio/print-agent build
```

## Troubleshooting

| Symptom | What to do |
|---|---|
| `The printer token was rejected` | The token was rotated, or printing is off for the event. Copy the new command from the admin UI. |
| `Node.js 24 or newer is required` | Install a newer Node.js. |
| Status shows `paused` | Run `node agent.mjs doctor --fix`, or `cupsenable <queue>`. |
| `Invalid CUPS queue name` | Use the exact queue name from `lpstat -p` (letters, digits, `_`, `.`, `-`). |
| Status shows `offline` | The queue does not exist or the printer is unreachable. Check `lpstat -p <queue>`. |
| Status shows `idle` with "the last print failed (Filter failed)" | CUPS keeps that message after a failed print. The queue still takes the next print. If prints keep failing, `lpstat -l -p <queue>` shows the printer's own alert (e.g. `com.mitsubishi-error0023`): look that code up for your printer. |
| Status shows `out_of_paper` | Replace the paper or ribbon. |
| Prints look wrong (cropped, bordered, wrong size) | Run `node agent.mjs doctor --fix`. Usually the queue uses the Generic PostScript driver. |
| `Say which printer to use` | The agent only asks in a terminal. Add `--printer <queue>` or `--simulate`. |
| The question lists no printers | Set one up with `node agent.mjs doctor --fix`, or check `lpstat -p`. |

## Other platforms (beta)

**Linux** should work through CUPS, but is not supported yet. DNP's driver is for macOS and Windows only; with
Gutenprint the DS620 option names differ, so prints may use the wrong settings and `doctor` reports the driver as
missing. See the `TODO(linux)` notes in the code.

**Windows (beta)** is **untested on real hardware**; the agent and `doctor` say so when they start. On Windows the agent prints through the Windows
spooler with PowerShell instead of CUPS; `--printer` is the Windows printer name (`Get-Printer`), for example
`--printer "DP-DS620"`. Before using it at an event, work through every `CRITICAL(windows)` note in
[src/windows.ts](src/windows.ts). In short:

- `doctor` on Windows only knows the DS620. The start-up question lists every Windows printer.
- Set cutter, glossy finish, resolution and no colour adjustment once in the printer's **Printing Preferences**:
  the agent cannot set them, and `doctor` cannot check them.
- Turn on **Keep printed documents** (`node agent.mjs doctor --fix` in an Administrator terminal). Without it the
  agent cannot tell a printed job from a cancelled one.

If `pnpm` does not work on Windows (for example it fails with a missing `@pnpm/exe` native binary), use `npm` instead:
`npm install`, then `npm run build` in `apps/print-agent`, then `node dist\agent.mjs`. Or build `agent.mjs` on another
computer and copy it over: it needs only Node.js 24 or newer.

Tips if the driver will not install on Windows 10:

- Right-click the downloaded zip → Properties → **Unblock** (if shown), then Extract All. Running the installer from
  inside the zip does nothing. Run `setup.exe` from the extracted folder as administrator.
- The printer often does not show up under "Add a printer or scanner" until its driver is installed. In Device
  Manager (Win+X) it appears as an unknown device or one with a yellow triangle. Plug it straight into the PC, not a hub.
- **Install the driver by hand if the installer still fails:**
  - Open Device Manager, right-click the unknown device and choose Update driver → Browse my computer → Let me pick,
    or point it at the extracted folder.
  - Or go to Settings → Printers & scanners → Add a printer or scanner → The printer that I want isn't listed → Add a
    local printer → Use an existing port (USB001) → Have Disk…, then browse to the `.inf` file in the extracted
    driver folder.

The protocol between the agent and the server is documented in [PROTOCOL.md](PROTOCOL.md).
