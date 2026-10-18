---
name: melee-slp-parser
description: >-
  Parse, stream, and extract data from Super Smash Bros. Melee .slp replay files
  using slippi-js and low-level UBJSON byte-stream readers. Use when working with
  replays, extracting game metadata, reading frame data, handling rollbacks,
  implementing multi-threaded bulk processing, or persisting metrics to SQLite.
---

# Melee SLP Parser & Storage Engine Skill Guide

This skill provides comprehensive instructions, architectural guidelines, and code snippets for loading, streaming, bulk processing, and persisting metrics from `.slp` replay files into a normalized SQLite database.

---

## 1. File Structure Overview

Slippi `.slp` files follow the **Draft 12 UBJSON specification** with two primary elements:
1. `raw`: An optimized `uint8` byte stream containing discrete game events sent from the GameCube engine.
2. `metadata`: A standard UBJSON object containing post-game summary data (`startAt`, `lastFrame`, `players`, `playedOn`, `consoleNick`).

### Command Opcodes
The byte stream begins with opcode `0x35` (`MESSAGE_SIZES`), enumerating all payload lengths to ensure forward and backward compatibility.

| Code | Hex | Event | Purpose | Frequency |
|---|---|---|---|---|
| `0x35` | 53 | Message Sizes | Header describing payload byte sizes | Once (first byte) |
| `0x36` | 54 | Game Start | Characters, stage, UCF settings, player tags/codes | Once (start) |
| `0x3A` | 58 | Frame Start | Frame index, RNG seed, scene counter (pause detection) | Once per frame |
| `0x37` | 55 | Pre-Frame Update | Controller inputs collected before engine decision | Once per frame per character |
| `0x38` | 56 | Post-Frame Update | Position, action state, damage, collision, speeds | Once per frame per character |
| `0x3B` | 59 | Item Update | Projectiles (lasers, turnips, needles) and items | 0–15 per frame |
| `0x3C` | 60 | Frame Bookend | Frame boundary, `latestFinalizedFrame` (rollbacks) | Once per frame |
| `0x3F` | 63 | FoD Platform | Fountain of Dreams moving platform heights | On movement |
| `0x40` | 64 | Whispy Wind | Dream Land 64 Whispy blow direction | On change |
| `0x41` | 65 | Stadium Transform | Pokémon Stadium transformation type/phase | On change |
| `0x39` | 57 | Game End | End method (GAME, TIME, NO CONTEST), LRAS player | Once (end) |

---

## 2. High-Throughput Bulk Processing Strategies

### 1. Worker Thread Pooling
Partition replay file paths across a worker thread pool (matching CPU core count). Each worker reads `.slp` buffers into memory and executes a unified single-pass consumer.

### 2. Unified Single-Pass Frame Consumer
Rather than instantiating 6 independent stat computers that each iterate the full frame array, iterate over frames once ($t = -39 \dots \text{lastFrame}$) and pass the frame to compound state machines:

```typescript
function processReplaySinglePass(game: SlippiGame): ExtractedReplayMetrics {
  const settings = game.getSettings()!;
  const metadata = game.getMetadata()!;
  const frames = game.getFrames();
  
  const p0 = settings.players[0].playerIndex;
  const p1 = settings.players[1].playerIndex;

  // State machines initialized once
  const mechanicsState = initMechanicsTracker(settings);
  const conversionTracker = initConversionTracker(settings);
  const pressureTracker = initPressureTracker(settings);
  const stockTracker = initStockTracker(settings);

  const frameKeys = Object.keys(frames).map(Number).sort((a, b) => a - b);
  for (const f of frameKeys) {
    const frame = frames[f];
    if (!frame) continue;

    // Single-pass dispatch to all trackers
    mechanicsState.processFrame(frame);
    conversionTracker.processFrame(frame);
    pressureTracker.processFrame(frame);
    stockTracker.processFrame(frame);
  }

  return {
    settings,
    metadata,
    overall: generateOverallStats(...),
    mechanics: mechanicsState.fetch(),
    conversions: conversionTracker.fetch(),
    pressure: pressureTracker.fetch(),
    stocks: stockTracker.fetch(),
  };
}
```

### 3. ESM Import Resolution in Node.js
When developing in Node.js with ES modules (`"type": "module"`), `@slippi/slippi-js` defaults to the browser distribution which lacks Node `fs` bindings. Always import from the `/node` subpath:

```javascript
// ❌ WRONG (fails with Cannot read properties of undefined 'openSync'):
import { SlippiGame } from "@slippi/slippi-js";

// ✅ CORRECT:
import { SlippiGame } from "@slippi/slippi-js/node";
```

### 4. Native Node SQLite Configuration (Node 22.5+)
Use the built-in `node:sqlite` module to avoid native compilation issues with `better-sqlite3`:

```javascript
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("analytics.db");
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA synchronous = NORMAL;");
db.exec("PRAGMA cache_size = -64000;"); // 64MB cache
db.exec("PRAGMA temp_store = MEMORY;");
```

Wrap multi-file ingestion in batched transactions:
```javascript
const insertGameStmt = db.prepare(`INSERT INTO games (...) VALUES (...)`);
const insertPlayerStmt = db.prepare(`INSERT INTO game_players (...) VALUES (...)`);
const insertMechanicsStmt = db.prepare(`INSERT INTO player_mechanics_stats (...) VALUES (...)`);

function insertBatch(replays) {
  db.exec("BEGIN TRANSACTION;");
  try {
    for (const replay of replays) {
      insertGameStmt.run(...);
      insertPlayerStmt.run(...);
      insertMechanicsStmt.run(...);
    }
    db.exec("COMMIT;");
  } catch (err) {
    db.exec("ROLLBACK;");
    throw err;
  }
}
```

### 5. Dual-Storage Architecture (SQLite + Compressed JSON)
To prevent SQLite table explosion across hundreds of thousands of games:
1. **SQLite (`analytics.db`)**: Store match metadata, character winrates, player stocks, and scalar mechanics (L-cancel %, wavedashes, GALINT frames).
2. **Date-Sharded Compressed Payloads (`payloads/YYYY/MM/<id>.json.gz`)**: Store granular frame-by-frame conversions, shield pressure sequences, and phantom hit events.
3. Level 6 `gzipSync` achieves ~88% space reduction (~2.5KB per game), enabling multi-million game storage on commodity disks.

### 6. Vendored Precompiled Distributions & Git Hygiene
When vendoring `@slippi/slippi-js` from source in `external/slippi-js-master`, ensure the precompiled `dist/node/index.esm.js` bundle is tracked in Git. Check upstream `.gitignore` files to ensure `dist/` is not excluded, avoiding runtime `ERR_MODULE_NOT_FOUND` errors on fresh clones.

---

## 3. External API Interoperability (Lunar Melee)

The Lunar Melee API (`https://api.lunarmelee.com`) provides bulk tournament and ranked Melee replays. Reference `docs/llms-full.txt` for full schema specifications.

### Key Endpoints
- **Search Replays**: `POST https://api.lunarmelee.com/replays/search`
  - Body: `{ "years": [2018], "page": 1, "pageSize": 100 }`
  - Response: `{ "replays": [...], "pagination": { "page": 1, "pageSize": 100, "total": ... } }`
- **Download Replay**: `GET https://api.lunarmelee.com/replays/{id}/download`
  - Returns raw binary `.slp` stream.

### Rate Limiting & Sliding Window Protocol
- Lunar Melee enforces a rate limit of **30 requests/minute**.
- Ingestion pipelines must enforce $\le 24\text{ req/min}$ (one download per 2500ms sliding window).
- Handle HTTP 429 and 503 responses with exponential backoff and jitter.
- Maintain an `ingestion_progress` table in SQLite to track pagination cursors (`year`, `page`, `pageSize`, `total_processed`).

---

## 4. Browser Frontend & Streaming Execution

Flowstate provides a zero-dependency web UI (`src/ui/`) served by `src/server/server.js` using native `node:http`.

### Starting the Server
```bash
npm run ui          # Launches on port 3000
npm run serve       # Alias for ui
node src/cli.js serve --port=8080  # Custom port
```

### Server Architecture & Streaming Protocol
- **Endpoint `/api/execute`**: Executes CLI subcommands via `child_process.spawn` with `--no-warnings` and `FORCE_COLOR: '1'`.
- **Server-Sent Events (SSE)**: Streams `stdout` and `stderr` chunks formatted with ANSI escape sequences to the browser terminal in real time.
- **Process Abort (`/api/abort`)**: Dispatches `SIGINT` to the running child process with a fallback `SIGKILL` timer.
- **Advisory Filtering**: The server filters out `Invalid asm.js` warnings from the stderr stream to maintain clean output in the frontend log viewer.

