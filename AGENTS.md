# Super Smash Bros. Melee Replay Engine Guidelines

## 1. Scope & Execution Boundaries
- **Local Analysis Only**: Focus strictly on offline `.slp` replay parsing, quantitative metrics extraction, SQLite storage, and query analytics.
- **Out of Scope**: Do NOT implement live broadcast capturing (OBS/Twitch), live Slippi relay listeners, or Dolphin/FFmpeg video rendering pipelines unless explicitly requested.

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

