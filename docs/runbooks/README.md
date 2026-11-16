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
   A device that has not paired since B-06 trusts the screen machine first (below, "Trust a
   device once").
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
- *The browser warns that the connection is not private.* The device does not trust the screen
  machine's root yet, or trusts an older one: see "Trust a device once" below.
- *"Certificate store unreadable — see the runbook".* See "Start the certificates over" below.

Nothing about External control is saved: a server restart ends every pairing, and live colour
changes go back to the profile's stored colours on the next pick.

## Trust a device once (B-06)

The External control listener serves HTTPS only, under a root the screen machine makes for
itself at the first switch-on (`DATA_DIR/tls/`). Every phone, tablet or laptop that opens
`/control` or `/send` trusts that root once; after that no page warns.

1. Switch External control on. The first QR code in the panel, under "Install once per device",
   opens `/trust`. The browser warns once on this page: continue to it (the page has no script).
2. Check that the fingerprint on the page equals the one in the panel. If not, stop: the device
   is talking to another machine.
3. Tap **Download certificate** and follow the steps for the device on the page:
   - *iPhone and iPad:* Allow the download; Settings → General → VPN & Device Management → the
     downloaded profile → Install; then Settings → General → About → Certificate Trust Settings →
     turn on full trust for "DJ Visuals System local root …".
   - *Android:* Settings → Security → More security settings → Encryption & credentials → Install
     a certificate → CA certificate, and choose the downloaded file.
   - *Windows:* open the file → Install Certificate → Current User → Place all certificates in the
     following store → Trusted Root Certification Authorities → Finish → Yes; restart the browser.
   - *macOS:* open the file (Keychain Access adds it to the login keychain); double-click the root,
     open Trust and set **When using this certificate** to **Always Trust**; restart the browser.
4. Scan the `/control` or `/send` QR code: the page opens with no warning.

These steps are the builder's draft until the owner's H1 confirms them on real devices; the
menu names differ between OS versions.

## Remote input: sending video or audio from a device (B-06)

`/send` sends a device's camera, its audio, or both, to the screen machine, peer to peer on the
network (ADR 0002). The server relays only the setup.

1. On the screen machine: Start, `s`, External control on. The device trusts the root (above).
2. Scan the panel's `/send` QR code. Tick **Camera**, **Audio** or both, pick the devices
   ("System audio" on a laptop sends what it plays), press **Send**, then **Accept** on the panel
   or on a controller. The panel lists it under "senders".
3. Audio becomes the main audio by itself; the panel's "main audio" row and the controllers'
   "Main audio" switch set it back to local. A camera waits until someone picks it in the camera
   picker or on a controller.
4. Keep `/send` open and in front: it holds the screen awake while sending.

**When a sender does not connect:**

- *"Could not reach the screen machine — the network may block devices from talking to each
  other"* (on `/send` and on the panel's sender row, after 10 s). The page loaded and paired over
  TCP, but the two browsers cannot reach each other over UDP. On a guest or venue Wi-Fi with
  client isolation, use a travel router (above). On the screen machine, check the Windows
  firewall next.
- *Windows Defender Firewall and UDP.* The media arrives at the screen machine's browser, not at
  Node.js. If the browser's own firewall prompt was dismissed, or the network profile is Public,
  allow Chrome (or Edge) on **Private networks** in Windows Security → Firewall & network
  protection → Allow an app through firewall, and check the profile is **Private**.
- *System audio connects only after Start, or not at all.* A browser that has no capture
  permission yet hides its address behind a `.local` name. Press Start on the screen machine
  first, or tick Camera too on the sender.
- *"Another device is sending audio".* One audio sender at a time: disconnect the other in the
  panel first. *"Too many devices"*: four video senders at most.
- *"Screen reconnecting…"* The screen page was reloaded or another tab took over; the sender
  keeps its capture and connects again by itself. After a reload, press Start on the screen.
- *"Pairing ended — scan the code again"* stops the sender's capture: scan the code again.

The overlay (`o`) shows `network ms` while the remote audio plays and `video ms` while a remote
camera is on screen, with `audio:` and `camera:` naming the sender.

## Start the certificates over

"Certificate store unreadable — see the runbook" means the root in `DATA_DIR/tls/` is missing a
file, unreadable, or does not match its key. The listener stays off.

1. Stop the server.
2. Delete the folder `DATA_DIR/tls/` (by default `data/tls/` in the repository). Nothing else is
   kept there.
3. Start the server and switch External control on: a new root is made.
4. On every device, remove the old "DJ Visuals System local root" profile or certificate first
   (two roots made on the same day carry the same name), then trust the new one (above).

## Human checks for remote input (B-06 H1 to H8)

The gate proves the structure on `127.0.0.1`; these run on the owner's network and are recorded
in [the plan](../plans/phase-b-06-remote-input-devices.md#human-steps) when done.

1. **H1 — Trust:** iPhone, iPad and the laptop trust the root; `/control` and `/send` open with
   no warning.
2. **H2 — The laptop's audio path:** send audio by an input and by System audio, before and after
   Start.
3. **H3 — Network leg:** laptop wired, `network ms` p95 ≤ 30 over 10 s of music and `latency ms`
   p95 ≤ 50; the Wi-Fi number without a bound.
4. **H4 — End to end:** a slow-motion film of speaker and screen with the laptop as main audio,
   ≤ 100 ms.
5. **H5 — Remote video:** an iPhone and a wired webcam film one stopwatch; the remote trails by
   ≤ 100 ms on Wi-Fi.
6. **H6 — Fallback:** pull the laptop's cable mid-track and plug it back; lock and unlock a phone.
7. **H7 — Four phones:** four video senders switched from a controller, no black frame.
8. **H8 — Isolation:** on a guest network, record what a sender shows.
