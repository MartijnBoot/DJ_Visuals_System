# Runbooks

How to operate the product, written before they are needed (way-of-working 10.1: deploy,
rollback, restore, incident, common failures). Each one is a numbered list someone can follow
at 23:00 without the author present.

| Runbook | Covers | Last rehearsed |
|---|---|---|
| `deploy.md` | Shipping a tagged artifact to each environment | — |
| `rollback.md` | Back to the previous artifact, and the target time | — |
| `restore.md` | A backup into a scratch database, end to end | — |
| `incident.md` | Detect, declare, mitigate, communicate, resolve, post-mortem | — |

A rollback that has not been rehearsed does not exist (non-negotiable 13). Every rehearsal leaves
a record in [rehearsals/](rehearsals/).

## The gate under load

`pnpm check:load` runs `bash scripts/check.sh` while the machine is busy: busy-loop worker
threads on half the cores and a second headless Chromium rendering a started set from its own
server on `127.0.0.1:8124` (`scripts/under-load.ts`). It exits with the gate's code, or 1 with
`load died: this run proves nothing` when the load stopped during a green run. Run it when a
check is suspected of being a timing flake: a check it turns red on a tree whose gate is green
is a defect to fix, never to re-run. It is not the gate and CI does not run it (B-08 SD8); it
takes roughly twice as long as `bash scripts/check.sh`.

## External control: latency check and venue networks

External control (B-04) lets a phone, tablet or laptop on the screen machine's network drive the
set. The gate proves it on `127.0.0.1` only; a real network is checked by hand.

**Before a set, on the venue's network (the latency check, B-04 H3):**

1. `pnpm start` on the screen machine; open `http://127.0.0.1:<PORT>/`, press Start, press `s`.
2. Switch External control on. The first time, Windows Defender Firewall asks whether Node.js may
   communicate: tick **Private networks**, and check the Wi-Fi's network profile is **Private**
   (Settings → Network → Wi-Fi → the network → Network profile type). Denied, dismissed, or on a
   Public profile, the listener binds but no device reaches it.
3. Pick the address of the venue's network in the panel's address picker (the adapter name says
   which), scan the QR code with a phone and press Accept.
4. On a tablet or laptop, pair a second device and switch it to **VJ**. Drag a colour and read the
   status strip: **round trip … / p95 …** must stay at or under 100 ms. Above it, move the screen
   machine closer to the access point or onto a cable, or use a travel router (below).
5. Press `o` on the screen machine: the overlay's audio latency p95 must stay at or under 50 ms
   while both controllers drag.

**When a phone cannot reach the page:**

- *The page does not load at all.* Is External control on, and is the phone on the same network
  as the address in the QR code? Many venue and guest Wi-Fi networks isolate clients from each
  other: then nothing on that network can reach the screen machine. Bring a travel router, join
  the screen machine and the phones to it, and pick its address in the panel.
- *"Port <n> is in use".* Another program holds `CONTROL_PORT`. Stop it, or set another free
  `CONTROL_PORT` in `.env.local` and restart the server.
- *"No local network address found".* The screen machine has no private IPv4 address (no Wi-Fi
  or cable, or only a public or IPv6 address). Join a network and switch on again.
- *It loaded once, then never again.* Check the firewall prompt and the Private profile above.
- *"Pairing ended — scan the code again".* The server restarted, External control was switched
  off, a new code was issued or the device was disconnected: scan the code again and accept.

Nothing about External control is saved: a server restart ends every pairing, and live colour
changes go back to the profile's stored colours on the next pick.
