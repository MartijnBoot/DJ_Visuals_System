# SDR: DJ Visuals System

Date: 2026-11-11 · Tech owner: Martijn Boot · Product owner: Martijn Boot · Status: Approved

The Setup Decision Record (way-of-working 3.1, Appendix A). Nothing is provisioned and no
feature code is written until it is approved. **The default answer to every question is "no" —
the burden of proof is on adding a component.** For an existing product (`/adopt`), record what
is already decided, with "inherited" as the reason where nobody knows why.

## 1. What we are building

DJs and VJs have no simple way to turn a live set's audio and a live camera into visuals that
move with the beat on the venue screen. DJ Visuals System is a web app that renders those visuals
in the browser of the screen machine from live audio and camera input, shaped by saved visual
profiles; its users are the owner as DJ, or a VJ, on a single screen machine. The first release
is self-hosted on the owner's machine for testing, covering B-01 to B-04, with no public users.

## 2. Decisions

Framing decisions, settled before the ten questions because they shape them:

- **A · Rendering location: in the browser on the screen machine** (WebGL2 + Web Audio API,
  AudioWorklet for analysis). Audio and the local camera are captured on that machine, so
  analysis-to-frame stays in one process (~20–50 ms) with no network in the path; server
  rendering adds encode/network/decode (≥100 ms plus jitter) and a GPU VM (~€300–700/mo).
  Server-side rendering is deferred (§7).
- **B · Stack: TypeScript end to end.** Framework-free renderer (`engine/`), React SPA
  built with Vite for screen, builder and control UI (`web/`), Node.js server for the profiles
  API, the control WebSocket and WebRTC signalling (`server/`). One language so the profile
  schema is defined once and validated identically in builder, server and B-03 import; Node also
  drives headless Chromium, which keeps the server-render path open. Specific libraries
  (WebGL wrapper, ORM, HTTP framework, logger) are dependency decisions for `/spec 0`.

| # | Question | Decision | Reason | Est. cost/mo | Owner |
|---|---|---|---|---|---|
| 1 | Database? | **Yes — SQLite** (one file on the screen machine) | B-02's in-app builder creates profiles at runtime that must survive restarts and redeploys; SQLite is the lowest operational load for one user on one machine (no Docker beside the renderer). Hosted database is decided with hosting (§7); profile export/import is the migration path. | €0 | Martijn Boot |
| 2 | Hosting? | **Self-hosted on the screen machine** — one Node process serves the web app, API, WebSocket and SQLite file. Cloud hosting deferred. | Browsers allow microphone and camera only on a secure context; `http://localhost` is one, a LAN address is not. Same machine means audio never crosses a network and nothing at a gig needs venue internet. | €0 | Martijn Boot |
| 3 | Auth? | **No** (server listens on `localhost`). Pairing token once a second device connects; buy, do not build, when hosted. | One user on their own machine; nothing else can reach the server. Bought auth (Entra External ID or Clerk) arrives with hosting or a second person with own profiles. | €0 | Martijn Boot |
| 4 | File storage? | **Yes — local disk** (`assets/` folder beside the SQLite file) | Profiles may carry images or textures. No upload/asset code is built until the first spec that uses it. Hosted: Azure Blob Storage (~€1/mo). Never blobs in the database. | €0 | Martijn Boot |
| 5 | Cache / queue / search? | **No** | No measured need: one user, a handful of profiles. The B-04 control channel is a WebSocket held by the single Node process, not a broker. Revisit with evidence. | — | Martijn Boot |
| 6 | Background jobs? | **No** | Nothing runs on the server outside a request: analysis and rendering are client-side, B-03 authoring happens in Claude Code, saves are single requests. | — | Martijn Boot |
| 7 | Email? | **No** | No accounts, invitations, resets or notifications. A bought auth provider sends its own auth mail when hosted. | — | Martijn Boot |
| 8 | Observability? | **Minimal and local:** structured JSON logs to the terminal (log level from config) + toggleable on-screen overlay with fps, frame time and estimated audio-to-pixel latency | Mandatory before go-live. Latency is the hard constraint and cannot be held without a number on screen. Application Insights + Log Analytics at hosting (~€0–5/mo). | €0 | Martijn Boot |
| 9 | Feature flags? | **No** | One user; unfinished work stays on its branch. Choice of transformer tools is profile configuration, not a flag. | — | Martijn Boot |
| 10 | WAF / CDN? | **No** | No public surface (localhost, later LAN behind a pairing token); a CDN would add a hop to a bundle served from the same machine. | — | Martijn Boot |

### Constraints carried into specs

These follow from the decisions above; each spec that touches the area must honour them.

- **Renderer is a framework-free module:** canvas + audio features + profile in, frames out; no
  UI or server dependencies. Keeps server-side rendering (headless GPU Chromium) possible later.
- **Assets are referenced by ID, never by file path,** and the profile export/import format
  includes assets. Keeps the move to Blob Storage and to a hosted database cheap.
- **Pairing token for any second device:** when the server first accepts connections from
  another device (B-04 control surface, B-01 phone camera), those connections require a random
  token generated at start-up and shown on the screen (e.g. as a QR code); not stored, not
  reused. Design belongs to the B-04 spec.
- **Performance and latency overlay:** every renderer spec states a latency budget and checks it
  against the overlay.
- **Live changes are never saved into profiles** (answers B-04's open question): live tweaks
  are the VJ playing and are discarded when the set ends.

## 3. Environments

**Local only.** The screen machine runs the app at `localhost` with a SQLite file. During the
pilot, local is also where gigs are played, so its profiles are real data: back them up through
profile export. **Dev and prod are deferred** until the hosting trigger (§7); when they come,
both are provisioned from the same infrastructure template with different parameter files
(way-of-working 3.1). No additional environment is justified.

## 4. Regions and residency

Primary: none now — everything runs on the screen machine. At hosting: the Azure region closest
to where the screens are, decided then. Reason: latency.

## 5. Naming and tags

Nothing to name now. From the first Azure resource: way-of-working Appendix I, workload name
`djvisuals`, tags env, workload, owner, costCentre, managedBy=bicep.

## 6. Total estimate

local €0/mo · dev not provisioned · prod not provisioned. Indicative once hosted: ~€20–35/mo
(Container Apps, Container Registry, database, Blob Storage, Application Insights). Budget alerts
at 50/80/100% are created together with the first Azure resource.

## 7. Explicitly deferred

| Deferred | Trigger | Then |
|---|---|---|
| Cloud hosting | The pilot works and someone other than the owner, or a machine other than the owner's, needs to run it | Azure Container Apps (consumption, ~€0–10/mo) + Container Registry Basic (~€5/mo) |
| Hosted database | Hosting | Postgres (Flexible Server B1ms, ~€15/mo) or a host with a real local disk for SQLite — SQLite on an SMB file share has unreliable locking. Migrate via profile export/import. |
| Server-side rendering | Hosted users whose PCs cannot render the visuals | Renderer in headless GPU Chromium. Evaluate per-profile quality tiers first: remote rendering sends audio up and frames down, bringing latency back. |
| Bought auth | Hosting, or a second person with their own profiles | Microsoft Entra External ID (free to 50k MAU) or Clerk |
| Blob Storage | Hosting with profile assets | Azure Blob Storage (~€1/mo) |
| Pub/sub | Hosting with more than one server instance | Postgres LISTEN/NOTIFY or Redis |
| Background jobs | Asset processing too slow for a request; scheduled hosted backups; server-side rendering | Container Apps Jobs |
| Email | Hosting with user accounts and app-originated mail (e.g. sharing a profile) | Azure Communication Services |
| Application Insights | Hosting — mandatory before go-live | Application Insights + Log Analytics (~€0–5/mo) |
| Feature flags | First hosted release used by someone other than the owner | Boolean in validated config first; Azure App Configuration (free tier) only if flags must flip without a redeploy |
| WAF | Public hosted product open to unknown users | Azure Front Door Standard (~€30+/mo) |
| CDN | Hosted users across regions and heavy profile assets with noticeable load times | CDN in front of Blob Storage |
| Dev/prod environments, IaC (`infra/`), Key Vault, GitHub OIDC, budgets | Hosting | Way-of-working 3.2 foundation setup |
| Saving live changes back into profiles | The owner asks for it | A new backlog item; not part of B-04 |

## 8. Open risks

| Risk | Impact | Mitigation | Owner |
|---|---|---|---|
| Audio-to-pixel latency feels out of sync with the beat | Product fails its core promise (B-01 "Not this") | Browser-side rendering; on-screen latency overlay; a latency budget in the B-01 spec; slow-motion phone film of speaker and screen as ground truth | Martijn Boot |
| Device audio capture differs per OS and browser — system-audio sharing is uneven across Windows, macOS and Linux | Audio input unavailable or unreliable on some machines | Treat mixer line-out into an audio interface (seen by the browser as a microphone) as the dependable default; microphone as fallback; per-OS spike in B-01 | Martijn Boot |
| Phone camera pairing: the phone's browser needs HTTPS on a LAN address, and venue Wi-Fi often blocks device-to-device traffic (client isolation) | Phone camera unusable at a venue | Own travel router or hotspot; locally trusted certificate; wired webcam fallback; spike in B-01 | Martijn Boot |
| The screen machine's GPU caps visual quality or frame rate | Dropped frames, visuals that stutter | fps in the overlay; per-profile quality tiers | Martijn Boot |
| Browser throttling or screen sleep during a set | Visuals freeze or slow mid-set | Fullscreen, Screen Wake Lock API, OS power settings | Martijn Boot |
| Future server-side rendering brings latency back for remote users | Hosted experience worse than self-hosted | Renderer kept a separate module; evaluate quality tiers first | Martijn Boot |
| Moving from SQLite to a hosted database | Migration work and data-loss risk at hosting | Profile export/import format, assets included, is the migration path | Martijn Boot |
| The single screen machine is a single point of failure at a gig | Profiles lost with the machine | Export profiles before each gig | Martijn Boot |
