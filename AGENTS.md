# Super Smash Bros. Melee Replay Engine Guidelines

## 1. Scope & Execution Boundaries
- **Core Pipeline**: Offline `.slp` replay parsing, quantitative metrics extraction, SQLite storage, and query analytics.
- **Live Spectator Integration**: Supported via `BroadcastService` (`src/broadcast/broadcastService.js`) and `SlippiCloudRelayClient` (`src/broadcast/slippiCloudRelay.js`), exposing Official Slippi Cloud Broadcast authentication (`wss://spectate.slippi.gg` via Firebase UID Spectator IDs), direct TCP listening (default port 51441 / dynamic fallback), 10 Hz live stream telemetry, and real-time SSE push (`/api/broadcast/events`).
- **Out of Scope**: Do NOT implement external video broadcast capturing (OBS/Twitch) or Dolphin/FFmpeg video rendering pipelines unless explicitly requested.

## 2. Storage & Disk Hygiene (Zero Accumulation)
- **Dual-Storage Pattern**:
  - Relational indexes, aggregate metrics, and summary states belong in `analytics.db` (SQLite).
  - High-density timelines (conversions, shield pressure events, phantom hits) belong in date-sharded `.json.gz` payloads (`payloads/YYYY/MM/<id>.json.gz`).
- **Immediate Replay Purging**: Temporary `.slp` files downloaded for ingestion must be deleted immediately after a verified database transaction commit. Never allow raw `.slp` files to accumulate in `./temp_slp/`.

## 3. External API & Rate Limiting (Lunar Melee)
- **Endpoint**: Lunar Melee API is located at `https://api.lunarmelee.com` (documented in `docs/llms-full.txt`).
- **Throttling**: The external API limits downloads to 30 requests per minute. Batch workers must throttle to $\le 24\text{ downloads/min}$ using a sliding-window rate limiter.
- **Backoff**: Handle HTTP 429 and 503 responses with exponential backoff and jitter.

## 4. Pipeline Resilience
- **Corrupt File Handling**: When encountering invalid headers, truncated byte streams, or parser crashes in `.slp` files, record the error in `replay_status` as `FAILED_CORRUPT` and proceed with the remaining batch. Never let a single bad replay crash the batch pipeline.

## 5. Vendored Dependencies & Distribution Hygiene
- **Precompiled Bundles Must Be Tracked**: When referencing vendored upstream dependencies (such as `external/slippi-js-master`), never allow upstream `.gitignore` files to exclude precompiled `dist/` directories. All builds required for execution (`dist/node/index.esm.js`) must be committed to Git so that fresh clones or zip extractions are functional without manual compilation steps.
- **Node ESM Resolution**: Always import `@slippi/slippi-js` via its Node distribution (`@slippi/slippi-js/node`) to ensure access to native filesystem bindings.

## 6. Runtime Engine Flags & Stderr Cleanliness
- **V8 Advisory Warning Suppression**: The legacy Emscripten `enet` UDP library bundled within `@slippi/slippi-js` triggers harmless V8 advisory warnings (`Invalid asm.js: Invalid member of stdlib`) on Node 20+.
- **Execution Standards**:
  - Always execute CLI scripts with `node --no-warnings`.
  - Pass `{ env: { ...process.env, NODE_NO_WARNINGS: '1' } }` when spawning background or child CLI processes.
  - Server-Sent Events (SSE) streaming filters must strip advisory asm.js strings from stderr before forwarding output to browser consoles to avoid false positive error states.

## 7. UI Layout, Ingestion Telemetry & Scope Isolation
- **1080p Viewport Containment**:
  - The application interface must fit within a standard 1080p display viewport without page scrolling (`overflow: hidden` on viewport roots, fixed `100vh` bounding container).
  - The execution console must remain constrained to the lower screen boundary with internal scrolling and flexible tray sizing (minimized, default compact, maximized).
- **Processing Scope Isolation (No In-Game Mechanics in Pipeline Views)**:
  - Ingestion and pipeline processing views must strictly render operational infrastructure telemetry: throughput ($RPM$), batch completion $\%$, discovered totals, parse integrity errors, cache hit/dedup ratio, storage footprint (compressed `.json.gz` MBs), and zero `.slp` buffer verification.
  - In-game player-mechanics stats (*L-cancel rate, wavedash counts, dash turns, IPM*) must NEVER be displayed on the ingestion/processing dashboard view. They belong strictly to downstream tactical scouting and replay review views.
- **Multi-Batch Lifecycle Invariants**:
  - All ingestion operations must be tracked in SQLite (`batch_runs`) across the 5 canonical lifecycle stages: `queued` → `ingesting` → `parsing` → `storing` → `caching` → `completed` / `failed`.
  - The primary dashboard must auto-follow the latest active or completed batch by default, but support sticky selection of historical runs with an explicit context indicator and a one-click return to live auto-follow.

## 8. Live Spectator & Stream Lifecycle Invariants
- **In-Memory Streaming Only (Zero Disk Accumulation)**:
  - Live broadcast streams must be piped directly into `SlpStream` / `SlpParser` in memory. Never write live incoming stream bytes to `./temp_slp/` or disk; completed matches are archived strictly via Dual-Storage (`analytics.db` + `payloads/YYYY/MM/<id>.json.gz`) on `GAME_END` (`0x39`).
- **Multi-Format Relay & Pre-Game Byte Isolation**:
  - Normalize all Slippi cloud and local relay envelopes (`game_event`, batched `events`, `menu_event`) across raw `Buffer`, `Uint8Array`, byte array, and base64 formats, as well as broadcast target schemas (`id`/`broadcastId`, `target`/`viewerKey`/`spectatorId`).
  - Accumulate fragmented pre-`0x35` (`GAME_START`) chunks in an isolated `_preGameBuffer` (capped at 64 KB). Never append pre-game menu bytes to the match `.slp` archive buffer (`_matchBuffer`); only record match bytes from `0x35` through `0x39`.
- **10 Hz Telemetry Throttling & Immediate State Transitions**:
  - Ingest stream chunks synchronously in memory, but throttle SSE `telemetry` emissions (`chunkCount`, `bytesIngested`, `throughputKbps`) to 10 Hz (`100ms`) with an automatic idle decay timer to prevent event-loop and DOM saturation.
  - Discrete state transitions (`LISTENING`, `CONNECTED_TO_STREAM`, `MENUS_ACTIVE`, `IN_GAME`, `GAME_END`) must dispatch immediately without throttling.
- **Parser State Reset Across Consecutive Games & Disconnects**:
  - Upon `GAME_END` (`0x39`), cleanly discard and re-instantiate `SlpStream` to prevent byte-alignment corruption on the next game while preserving overall broadcast session and uptime continuity (`MENUS_ACTIVE` / `CONNECTED_TO_STREAM`).
- **Socket, Timer & Port Lifecycle Hygiene**:
  - Maintain an active `Set<net.Socket>` of connected client streams and track all telemetry throttle/decay timers. On `DELETE /api/broadcast/session` or server shutdown, clear all timers and destroy all sockets before closing the server to prevent lingering handles and `EADDRINUSE` port collision errors.

## 9. Test Concurrency & Database Tracking Hygiene
- **Serial Test File Execution**:
  - Always execute automated test suites with serial file concurrency (`node --test --test-concurrency=1 ...`).
  - Concurrent test processes can cause port collision (`EADDRINUSE`) on dynamic TCP/HTTP listeners or lock SQLite databases.
- **Tracked Database Cleanliness**:
  - When running tests or local CLI commands that interact with `analytics.db`, ephemeral test entries may modify the tracked database file.
  - Before staging and committing feature branches, inspect `git status` and restore `analytics.db` to clean HEAD (`git checkout analytics.db`) unless schema or seed updates are explicitly intended.

## 10. Behavioral Habit & Vulnerability Profiling Invariants
- **Action State Numeric Comparisons**:
  - `post.actionStateId` values from `@slippi/slippi-js` are integer numbers. Always compare using raw numeric values: grounded attacks, tilts, smashes, dash attacks, and aerials fall in the integer range `44` to `69` (hex `0x2C` through `0x45`), with character specials at $ID \ge 341$.
- **Ledgedash Heuristic Boundary**:
  - Ledgedash is not a discrete action state. Detect via transition from `CLIFF_WAIT` (`0xFD` / 253) to `LANDING_FALL_SPECIAL` (`0x29` / 41) on the stage surface ($|X| \le \text{ground.xMax}$) within $\le 35$ frames.
  - Permissive intermediate airborne states (`FALL` `0x1D`, `JUMP_F`/`JUMP_B` `0x19`/`0x1A`, `AIR_DODGE` `0xEC`) are permitted between `CLIFF_WAIT` and landing. Invalidate the ledgedash candidate if the player re-grabs the ledge (`CLIFF_CATCH` `0xFC`), lands on another surface, or enters damage states (`isDamage`).
- **Ground Tech vs. Downed Wakeup Distinction**:
  - Never conflate ground tech options (`TECH_NEUTRAL` `0xC7`, `TECH_F` `0xC8`, `TECH_B` `0xC9`, `WALL_TECH` `0xCA`) with missed-tech wakeups from downed states (`DOWN_WAIT_U` `0xB8` / `DOWN_WAIT_D` `0xC0`).
  - Track missed-tech wakeups distinctly: neutral stand (`0xB9`/`0xC1`), roll forward (`0xBA`/`0xC2`), roll backward (`0xBB`/`0xC3`), and getup attack (`0xBC`/`0xC4`).
- **Punish & Advantage Windows**:
  - *Strict 30-Frame Punish Window*: A getup, tech, or wakeup is classified as punished if the player takes damage or enters hitstun (`isDamage`) during vulnerable animation frames or within 30 frames (0.5s) of returning to stage, pre-empted if the player lands a counter-hit.
  - *45-Frame Advantage Neutralization Window*: Following dropped advantage or blocked attacks ($\le 0$ frame advantage), evaluate the next 45 frames: classify as *Neutral Reset* if horizontal separation grows ($\Delta D > 0$) or player retreats/guards; classify as *Over-Extension* if player commits to active attacks (`44`–`69` or $\ge 341$) or forward dash into an actionable opponent, resulting in a whiff or counter-hit damage.
- **Grab Context Triggers**:
  - *Shield-Pressure Grab*: Initiated within 15 frames of an attack connecting with opponent's shield.
  - *Scramble Grab*: Initiated when both players are actionable within Euclidean distance $D \le 18.0$ world units, and neither player has been in hitstun or shield within the preceding 30 frames.
  - *Neutral Setup Grab*: Initiated from neutral spacing ($D > 18.0$) via dash-grab or jump-in.
- **Dual-Storage Schema & Aggregation Hygiene**:
  - `player_habits_stats` requires composite primary key `(game_id, player_index)` with foreign key cascade to `games(game_id)`.
  - Always denormalize `connect_code` and `character_id` with dedicated indexes (`idx_habits_connect_code`, `idx_habits_char`) for instant player queries, joining `game_players opp` and `games g` for opponent-specific and stage-specific filters.
  - Always store raw integer counters (numerators and denominators) so rolling aggregations use `SUM(punished) * 1.0 / NULLIF(SUM(count), 0)` rather than averaging pre-computed percentages.
  - Exclude aborted/incomplete games (< 30s or LRAS / No Contest `end_method === 7`) from player rolling averages using `WHERE is_complete = 1`.

## 11. Swarm Coordination & Verification Harness Hygiene
- **Deterministic Test Fixtures**:
  - Real sample replays (`unranked_game1.slp`) cannot be assumed to contain all tactical interactions. Automated test suites for complex metrics must combine real replay parsing with deterministic synthetic/mocked frame fixtures to ensure non-empty assertion of all metric pathways without false passes on empty arrays.
- **Swarm Metadata Exclusion**:
  - Coordination and task lifecycle artifacts generated by multi-agent swarms (e.g., `.agents/teamwork/`) must always be excluded in `.gitignore` to prevent polluting the repository history.


