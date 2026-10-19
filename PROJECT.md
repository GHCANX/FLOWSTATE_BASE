# Project: Live Slippi Remote Spectator Integration

## Architecture
FlowState live remote spectator integration provisions a Slippi broadcast key, connects to a remote player's live gameplay stream via TCP, parses real-time match start metadata (`stageId`, characters, connect codes, nametags) via `@slippi/slippi-js/node` without writing `.slp` files to disk, and broadcasts live state updates to the UI.

- **Ingestion & Protocol Engine (`src/broadcast/broadcastService.js`)**:
  - `BroadcastService` singleton manages connection lifecycle across 4 canonical states: `IDLE`, `LISTENING`, `CONNECTED`, `IN_GAME`.
  - Provisions Slippi-compatible broadcast keys: `SLP-XXXX-XXXX`.
  - Runs direct fallback TCP listener on port 51441 (or configurable port / port 0 for tests).
  - Tracks client sockets in `activeSockets` Set, destroying all sockets and closing the server on `DELETE /api/broadcast/session` (guaranteeing zero port/socket leaking).
  - Pipes incoming TCP binary chunks directly to `SlpStream.process(chunk)` with zero disk writes (guaranteeing zero `.slp` accumulation).
  - Listens for `Command.GAME_START` (`0x36`), immediately extracting `stageId`, canonical `stageName` (via `getStageName`), and active players (`port`, `connectCode`, `displayName`, `characterId`, `characterName`, `costumeIndex`).
  - Emits events: `statusChange`, `gameStart`, `gameEnd`, `streamError`.
- **Server API & SSE Push Stream (`src/server/server.js`)**:
  - Native Node.js `node:http` server (zero new framework dependencies).
  - REST endpoints:
    - `POST /api/broadcast/session`: Start listener, provision key.
    - `GET /api/broadcast/session`: Query current status, key, remote peer, current game.
    - `DELETE /api/broadcast/session`: Tear down listener, destroy sockets, release ports.
  - Real-time SSE endpoint:
    - `GET /api/broadcast/events`: Push stream emitting `session`, `statusChange`, `gameStart`, `gameEnd`.
  - Static Asset Serving:
    - Maps `.jpg` and `.jpeg` in `MIME_TYPES`.
    - Serves Melee character portraits and stage images from `src/ui/assets/`.
- **Frontend SPA Integration (`src/ui/`)**:
  - Strict 1080p viewport containment (`overflow: hidden`, fixed `100vh`, zero page scrolling).
  - Left panel: "Live Spectate" tab (`data-tab="spectate"`) containing Spectator Connection Widget (`#form-spectate`) with active Broadcast Key, one-click copy button, step-by-step broadcaster setup instructions, TCP port config, and real-time status badge.
  - Right workspace: Live Match Card panel (`#live-match-panel`) toggling with `#dashboard-panel`. Renders stage backdrop artwork and legal badge, split Player 1 vs Player 2 layout with character portraits, nametags, connect codes, port badges, and radar pulse waiting state.
  - Resilient CSS fallback avatars (e.g. glowing circular initials like "FX", "MA") if images fail to load.
  - SSE client listener in `src/ui/app.js` with polling fallback.
- **Verification & Test Suite (`test/broadcast_spectator_test.js`)**:
  - Automated tests validating session provisioning, TCP stream simulation, $\le 100\text{ms}$ `GAME_START` extraction, resource cleanup via `DELETE`, and zero regressions across `npm test`.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | Broadcast Key Provisioning & State Machine | `BroadcastService` managing 4 states (`IDLE`, `LISTENING`, `CONNECTED`, `IN_GAME`), random `SLP-XXXX-XXXX` viewer key generation, session metadata | M1 | ORIGINAL_REQUEST §R1 |
| F2 | Fallback Direct TCP Listener (Port 51441) | Node.js `net.Server` listener on port 51441 or configurable port, client socket tracking in `activeSockets` Set | M1 | ORIGINAL_REQUEST §R1 |
| F3 | REST Lifecycle API Endpoints | `POST /api/broadcast/session`, `GET /api/broadcast/session`, `DELETE /api/broadcast/session` in `server.js` | M1 | ORIGINAL_REQUEST §R1 |
| F4 | Lightweight SlpStream Ingestion & GameStart Parsing | Direct binary chunk piping into `@slippi/slippi-js/node` `SlpStream`, extract `stageId`, canonical `stageName`, and active players (`port`, `connectCode`, `displayName`, `characterId`, `characterName`, `costumeIndex`) in $\le 100\text{ms}$, zero `.slp` disk accumulation | M1 | ORIGINAL_REQUEST §R2 |
| F5 | Zero Port & Socket Leak Cleanup | Disconnect handlers, `DELETE /api/broadcast/session` closes TCP server and destroys active sockets cleanly | M1 | ORIGINAL_REQUEST §R4 |
| F6 | Real-Time SSE Event Broadcasting | `GET /api/broadcast/events` SSE endpoint in `server.js` broadcasting `statusChange`, `gameStart`, `gameEnd` events to clients | M1 | ORIGINAL_REQUEST §R2 |
| F7 | Character & Stage Visual Asset Integration | Copy/link Melee character icons and stage images to `src/ui/assets/`, add `.jpg` / `.jpeg` to `MIME_TYPES` in `server.js` | M2 | ORIGINAL_REQUEST §R3 |
| F8 | Spectator Connection Widget (UI) | Left panel tab `Live Spectate`, copyable Broadcast Key, setup instructions ("Open Slippi Launcher → Gameplay Broadcasts → Paste Broadcast Key → Start"), real-time status badge | M2 | ORIGINAL_REQUEST §R3 |
| F9 | Live Match Card (UI) | Upper right workspace panel showing stage backdrop/name/tag, Player 1 vs Player 2 layout with character portraits, nametags, connect codes, and reset on match termination | M2 | ORIGINAL_REQUEST §R3 |
| F10 | 1080p Viewport Compliance & Resilience | `overflow: hidden`, fixed `100vh`, resilient fallback avatar rendering (initials + port colors) on missing image | M2 | ORIGINAL_REQUEST §R3, AGENTS.md |
| F11 | Dedicated Automated Test Suite | `test/broadcast_spectator_test.js` validating lifecycle APIs, simulated client TCP binary stream, $\le 100\text{ms}$ extraction, socket cleanup | M3 | ORIGINAL_REQUEST Acceptance Criteria |
| F12 | Zero Regression & Runtime Compliance | Full `npm test` passing cleanly, `node --no-warnings`, `NODE_NO_WARNINGS=1` child env, imports via `@slippi/slippi-js/node` | M3 | ORIGINAL_REQUEST Acceptance Criteria |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Ingestion Service & REST/SSE APIs | `src/broadcast/broadcastService.js`, `src/server/server.js` (broadcast routes & SSE) | none | DONE (`challenge_live_m1.js` & `challenge_m1_empirical.js` passed, 1B/7B/32B chunk buffering verified, zero leaks, clean audit) |
| M2 | UI Integration & Visual Assets | `src/ui/assets/`, `src/ui/index.html`, `src/ui/styles.css`, `src/ui/app.js`, `src/server/server.js` (MIME_TYPES) | M1 | DONE (`test/m2_ui_spectator_test.js` passed, all 26 character icons and 7 stages served, 1080p viewport strictly preserved, SSE wired) |
| M3 | Comprehensive Test Suite & Verification | `test/broadcast_spectator_test.js`, regression verification (`npm test`), audit | M1, M2 | DONE (`test/broadcast_spectator_test.js` 6/6 passed, extraction latency ~2-4ms <= 100ms, zero regressions on `npm test`, reviewer APPROVE, challenger APPROVE, forensic audit CLEAN) |

## Interface Contracts

### M1 ↔ M2 (`BroadcastService` / Server ↔ UI Client)
- `POST /api/broadcast/session`:
  - Request body (optional): `{ port: 51441, host: '0.0.0.0' }`
  - Response (200 JSON):
    ```json
    {
      "sessionId": "UUID",
      "broadcastKey": "SLP-A8F2-3B1C",
      "status": "LISTENING",
      "port": 51441,
      "host": "0.0.0.0",
      "remotePeer": null,
      "currentGame": null,
      "sessionStartTime": "2026-10-19T...",
      "instructions": "Open Slippi Launcher → Gameplay Broadcasts → Paste Broadcast Key → Start"
    }
    ```
- `GET /api/broadcast/session`:
  - Response (200 JSON): Same structure as above.
- `DELETE /api/broadcast/session`:
  - Response (200 JSON): `{ "status": "IDLE", "message": "Session stopped and resources released." }`
- `GET /api/broadcast/events` (SSE):
  - Stream `text/event-stream` with events:
    - `type: "session"`, data: session object
    - `type: "statusChange"`, data: `{ status, previousStatus, broadcastKey, ... }`
    - `type: "gameStart"`, data:
      ```json
      {
        "stageId": 31,
        "stageName": "Battlefield",
        "players": [
          {
            "port": 1,
            "playerIndex": 0,
            "connectCode": "NIKK#513",
            "displayName": "Nikki Dev1",
            "characterId": 20,
            "characterName": "Falco",
            "costumeIndex": 0
          },
          {
            "port": 2,
            "playerIndex": 1,
            "connectCode": "NIKK#142",
            "displayName": "Nikki Dev2",
            "characterId": 20,
            "characterName": "Falco",
            "costumeIndex": 1
          }
        ],
        "startedAt": "2026-10-19T..."
      }
      ```
    - `type: "gameEnd"`, data: `{ previousGame, endPayload }`

### M2 ↔ Assets
- Character portraits: `/assets/character-icons/<alias>/<Costume>.png`
- Stage images: `/assets/stages/<stage_file>.jpg`

## Code Layout & File Ownership
| File | Owning Milestone / Worker |
|------|---------------------------|
| `src/broadcast/broadcastService.js` | M1 |
| `src/server/server.js` | M1 & M2 (M1 for routes, M2 for MIME types) |
| `src/ui/assets/` | M2 |
| `src/ui/index.html` | M2 |
| `src/ui/styles.css` | M2 |
| `src/ui/app.js` | M2 |
| `test/broadcast_spectator_test.js` | M3 |
| `package.json` | M3 (add test script if applicable) |
