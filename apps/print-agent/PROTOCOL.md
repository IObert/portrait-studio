# Print agent ↔ server protocol

This is the contract between `apps/print-agent` and `apps/web` (SPEC §3.1, §11). The two projects share no code,
and both have contract tests against the examples here (`docs/decisions.md`, Q7).

## 1. Starting the agent

```
node agent.mjs --url https://<app> --token <event printer token> [--printer <CUPS queue>] [--simulate --out ./prints]
```

The printer token looks like `pst_<slug>_<43 chars>`. The admin UI shows it once, together with this command.

## 2. Token exchange: `POST /api/agent/token`

The agent swaps its printer token for a short-lived Twilio Sync token (SPEC §11.2).

```http
POST /api/agent/token
Authorization: Bearer pst_sp-london_xxxxxxxx…
```

| Response | Meaning |
|---|---|
| `200 {"token":"<Sync JWT>","ttl":3600,"slug":"sp-london","objects":{"print":"ev_sp_london_print","printer":"ev_sp_london_printer"}}` | Use `token` with the `twilio-sync` SDK |
| `401` | Unknown or rotated printer token. Stop and tell the operator. |
| `503` | Server or Sync unavailable. Retry with back-off. |

- The Sync identity is `printer:<slug>`. Its ACLs grant **read and write on `objects.print` and `objects.printer`
  only**. Every other object is denied (error 54007).
- The agent asks for a new token before `ttl` runs out (the SDK's `tokenAboutToExpire`). It also does so on `401`
  from Sync.

## 3. Print queue: Sync Map `ev_<slug>_print`

Key: `jobId`. Value (SPEC §11.3). It holds no personal data; `who` is a masked address at most.

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
  storage credentials.

### State machine

```
queued ──claim──▶ claimed ──▶ printing ──▶ printed
   ▲                │            │
   └────retry───────┴────────────┘   (attempts < 3)
                                 └──▶ failed   (attempts = 3)
```

| Transition | Who | How |
|---|---|---|
| `queued → claimed` | agent | `map.mutate(jobId, …)`: only if `state === "queued"` and `leaseUntil` has passed. Sets `attempts += 1` and `leaseUntil = now + 2 min`. Returning `null` cancels, so a lost race is harmless. |
| `claimed → printing` | agent | After the PNG has downloaded and been handed to CUPS (or the simulator) |
| `printing → printed` | agent | The CUPS job completed (`lpstat -W completed`). Sets `timestamps.printed`. |
| `→ queued` (retry) | agent | A print error with `attempts < 3`. Sets `error` and `leaseUntil = now + backoff` ("not before"). |
| `→ failed` | agent | A print error with `attempts = 3`. The attendee already has the image, so nothing is sent to them (SPEC §11.2). |
| expired lease → `queued` | worker | A `claimed` or `printing` item whose `leaseUntil` is more than 5 min old goes back to `queued`, or to `failed` once attempts are used up (SPEC §11.2 "stuck jobs") |

- The agent renews `leaseUntil` every 30 s while an item is `printing`.
- **After `printed`**, the server worker counts the print (SPEC §4.3), updates the stats and sends the promo once
  (SPEC §5.9). The agent never contacts attendees.

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

`mode` is `cups` or `simulate`. `status` is one of:

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

The option names come from the spec and are **to be verified on a real DS620** with `lpoptions -p <queue> -l`
(SPEC §11.2). The agent logs that command's output at start-up so the values can be checked.
