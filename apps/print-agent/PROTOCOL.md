# Print agent ↔ server protocol

This is the contract between `apps/print-agent` and `apps/web` (SPEC §3.1, §11). The two projects share no code
(`docs/decisions.md`, Q7). Each side has its own tests for its half of this contract, and the web app has a live test
for the Sync token scope; no test reads this file or its JSON examples, so keep them in step by hand.

## 1. Starting the agent

```
node agent.mjs --url https://<app> --token <event printer token> [--printer <CUPS queue>] [--simulate --out ./prints]
```

The printer token looks like `<event id>.XXXX-XXXX-XXXX-XXXX` (docs/decisions.md D-33). The admin UI keeps showing it, together with this command.

## 2. Token exchange: `POST /api/agent/token`

The agent swaps its printer token for a short-lived Twilio Sync token (SPEC §11.2).

```http
POST /api/agent/token
Authorization: Bearer sp-london.K7QM-2XHD-9RTB-W4PZ
```

| Response | Meaning |
|---|---|
| `200 {"token":"<Sync JWT>","ttl":3600,"slug":"sp-london","objects":{"print":"ev_sp_london_print","printer":"ev_sp_london_printer"}}` | Use `token` with the `twilio-sync` SDK |
| `401` | Unknown or rotated printer token, or printing is off for the event (all the same response). Stop and tell the operator. |
| `503` | Server or Sync unavailable. Retry with back-off. |

- The Sync identity is `printer:<slug>`. Its ACLs grant **read and write on `objects.print` and `objects.printer`
  only**. Every other object is denied (error 54007).
- The agent asks for a new token before `ttl` runs out (the SDK's `tokenAboutToExpire`). If the token has expired
  (`tokenExpired`), the connection is `denied` or `error`, or no heartbeat has been written successfully for 60 s
  (docs/decisions.md D-32), it ends the session and starts a new one with a fresh token. A print at the printer is
  resumed, not printed again.
- Reconnecting waits 1 s, doubling up to 60 s while connecting keeps failing quickly. After a session that lasted at
  least 60 s the wait starts over at 1 s. A `401` from this endpoint is final: the agent stops.

## 3. Print queue: Sync Map `ev_<slug>_print`

Key: `jobId`. The server adds an item when an attendee asks for a print, or an admin reprints (docs/decisions.md D-24).
Value (SPEC §11.3). It holds no personal data; `who` is a masked address at most.

```json
{
  "jobId": "5sRwSOWWpPI_Ho3L",
  "blobPath": "events/sp-london/generated/5sRwSOWWpPI_Ho3L.print.png",
  "url": "https://<app>/m/<signed token>",
  "who": "whatsapp:+44…23",
  "state": "queued",
  "attempts": 0,
  "leaseUntil": null,
  "error": null,
  "reprint": false,
  "timestamps": { "queued": "2026-10-13T12:00:00.000Z" }
}
```

- `url` is a signed, expiring link to the 1200×1800 PNG (`/m/<token>`). The agent downloads from it and needs no
  storage credentials. Items from before it existed may lack it; the server adds one to queued items, and the agent
  skips an item without one.
- `printerJobId` (string or `null`, optional) is set while printing. `settledAt` is set by the server once a
  `printed` or `failed` item is counted; the agent leaves it alone. `reprint` is `true` for an admin reprint, which
  does not count toward the person's print limit and sends no promo. `error` is at most 300 characters.
- The agent reads only the first 100 items of the map each time it looks for work. Settled items stay for 7 days, so
  on a long, busy event a new print can be missed (known limit, `TODO(print-queue-pagination)` in `src/agent.ts`).

### State machine

```
queued ──claim──▶ claimed ──▶ printing ──▶ printed
   ▲                │            │
   └────retry───────┴────────────┘   (attempts < 3)
                                 └──▶ failed   (attempts = 3)
```

| Transition | Who | How |
|---|---|---|
| `queued → claimed` | agent | `map.mutate(jobId, …)`: only if `state === "queued"`, `url` is set and `leaseUntil` has passed. Sets `attempts += 1` and `leaseUntil = now + 2 min`. Returning `null` cancels, so a lost race is harmless. |
| `claimed → printing` | agent | After the PNG has downloaded and been handed to CUPS (or the simulator). Sets `printerJobId`, the CUPS request id. |
| `printing → printed` | agent | The CUPS job's IPP `job-state` is `completed` (read with `ipptool`; `lpstat -W completed` also lists cancelled jobs). Sets `timestamps.printed`. If the write fails, the agent tries up to 5 times; if it never goes through, the item stays `printing` with its `printerJobId` and the next start records it (it is not failed or requeued, which would print a second copy). |
| `→ queued` (retry) | agent | A print error with `attempts < 3`, **after cancelling the CUPS job**. Clears `printerJobId`, sets `error` and `leaseUntil = now + backoff` ("not before"). |
| `→ failed` | agent | A print error with `attempts = 3`, after cancelling the CUPS job. The attendee already has the image, so nothing is sent to them (SPEC §11.2). |
| expired lease → `queued` | worker | A `claimed` item, or a `printing` item **without** `printerJobId`, whose `leaseUntil` is more than 5 min old goes back to `queued`, or to `failed` once attempts are used up (SPEC §11.2 "stuck jobs") |
| expired lease, resumed | agent | A `printing` item **with** `printerJobId` is never requeued. The next agent takes it over and waits for that same CUPS job. |

**One print, one copy (docs/decisions.md D-25).** A print is submitted to CUPS once. While the printer is off, paused
or out of paper, the agent keeps the lease and waits: CUPS holds the job and prints it when the printer is back.
The agent claims nothing new while the printer is not ready. A job that makes no progress for 10 min while the
printer says it is ready is cancelled and retried.

- The agent renews `leaseUntil` every 30 s while an item is `claimed` or `printing`, including while it waits for
  the printer.
- The server skips an item that does not match the schema (and logs it) instead of failing for the whole event.
- **After `printed`** (or `failed`), the server worker counts the print (SPEC §4.3), updates the stats and sends the promo once
  (SPEC §5.9). After `failed` it only releases the reservation. The agent never contacts attendees.

## 4. Printer status: Sync Document `ev_<slug>_printer`

The agent writes this every 15 s (SPEC §11.2). The admin UI shows it.

```json
{
  "agentVersion": "0.1.0",
  "mode": "cups",
  "queue": "DNP_DS620",
  "status": "idle",
  "detail": "",
  "heartbeatAt": "2026-10-13T12:00:15.000Z"
}
```

`mode` is `cups`, `windows` (Windows print spooler, beta) or `simulate`. `status` is one of:

| `status` | Meaning |
|---|---|
| `idle` | Ready, nothing printing |
| `printing` | A job is printing |
| `offline` | The CUPS queue is missing or the printer is unreachable |
| `paused` | The CUPS queue is disabled or paused |
| `out_of_paper` | The printer reports no media / ribbon |
| `error` | Any other CUPS error; `detail` holds the short `lpstat` text |

The admin treats a `heartbeatAt` older than 45 s as **agent offline**.

## 5. Print command (DNP DS620, 4x6)

```
lp -d <queue> -o PageSize=dnp6x4 -o Cutter=Normal -o Finish=Glossy -o Resolution=300x300dpi \
   -o fit-to-page -o print-scaling=fill -o orientation-requested=3 <file.png>
```

The option names were verified on a real DS620 with the DNP-DS620 PPD (`lpoptions -p <queue> -l`); they live in
`DS620_OPTIONS` in `src/cups.ts`. The agent logs that command's output at start-up. `node agent.mjs doctor --fix`
switches a queue to the DS620 driver and sets these values as the queue defaults (see README, "Printer doctor").
