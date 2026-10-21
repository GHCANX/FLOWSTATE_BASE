# Flowstate Melee Replay Analysis Engine

A high-throughput, offline Super Smash Bros. Melee `.slp` replay parsing and analytics engine. Flowstate extracts 20+ competitive mechanics frame-by-frame, stores structured metadata and aggregate metrics in SQLite, preserves granular match timelines in date-sharded compressed JSON payloads, and interfaces with the Lunar Melee API for sliding-window batch ingestion.

---

## 🏗️ Architecture & Storage Strategy

### 1. Dual-Store Topology
- **Relational Catalog (`analytics.db`)**: High-performance SQLite database (configured with WAL mode, `NORMAL` synchronous, and a 64MB cache) indexing game metadata, stage IDs, player character selections, match outcomes, stock counts, and scalar execution metrics (L-cancel %, wavedash counts, GALINT frame advantage, dash turns, shield drops).
- **Date-Sharded Compressed Payloads (`payloads/YYYY/MM/<gameId>.json.gz`)**: Level 6 `gzip` compressed payloads containing high-density event timelines (conversions, combo strings, shield pressure sequences, phantom hits, and stock lifespans). Yields ~88% disk reduction (~2.5KB per match), preventing multi-million row table bloat in SQLite while keeping granular data instantly accessible.

### 2. Zero-Accumulation Lifecycle
To process massive replay archives (~11TB total dataset) without filling local disks:
1. Replays are downloaded in batches of 100 into an ephemeral directory (`./temp_slp/`).
2. The single-pass frame consumer parses all mechanics and tactical states in one iteration ($t = -39 \dots \text{lastFrame}$).
3. Extracted scalar metrics are committed atomically to SQLite and payloads are written to `./payloads/YYYY/MM/`.
4. The downloaded `.slp` files are purged immediately from disk.

### 3. API Rate Limiting & Resilience
- **Lunar Melee Client**: Interacts with `https://api.lunarmelee.com` using a sliding-window rate limiter restricted to $\le 24\text{ downloads/minute}$ (below the external limit of 30 req/min).
- **Fault-Tolerant Ingestion**: Automatically applies exponential backoff with jitter on HTTP 429/503 responses, and flags corrupted `.slp` files as `FAILED_CORRUPT` in `replay_status` without halting batch execution.


---

## 📁 Repository Organization

```text
FLOWSTATE_BASE/
├── AGENTS.md                          # Workspace execution rules & scope boundaries
├── analytics.db                       # Active SQLite database
├── docs/                              # Technical reference specifications
│   ├── SPEC.md                        # Slippi replay format (Draft 12 UBJSON) specification
│   ├── llms-full.txt                  # Lunar Melee API complete schema documentation
│   └── competitive_mechanics_guide.md # Melee competitive mechanics calculation reference
├── external/                          # Third-party / vendored upstream repositories
│   ├── lm-clipper-master/             # Reference Lunar Melee desktop clipper engine
│   └── slippi-js-master/              # Vendored Slippi JS parser library
├── node_modules/                      # Node dependencies
├── package.json                       # Project manifests, dependencies, and npm scripts
├── payloads/                          # Date-sharded compressed JSON payloads (YYYY/MM/)
├── README.md                          # Engine documentation
├── src/                               # Engine source code
│   ├── analysis/                      # FrameConsumer, MechanicsDetector, TacticalDetector, PayloadBuilder
│   ├── cli.js                         # Unified command-line interface
│   ├── constants/                     # Action states, character aliases, stage geometry, recovery data
│   ├── database/                      # Native SQLite schema, connection singleton, ReplayRepository
│   ├── lunar/                         # Lunar Melee API client & sliding-window rate limiter
│   ├── orchestrator/                  # BatchPipeline, IngestionProgress, FileCleaner
│   └── query/                         # AnalyticsService (overview, matchup, scouting, export)
├── temp_slp/                          # Ephemeral replay buffer (purged after processing)
└── test/                              # Automated test suites
    ├── stage1_local_test.js           # Local replay verification test
    └── stage2_lunar_pilot.js          # Live Lunar API ingestion pilot
```

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: v22.5.0 or higher (v25.x recommended for native `node:sqlite` support)
- **npm**: v10+

### Installation
```bash
npm install
```

---

## 🧪 Testing & Verification

Run the local replay parser and storage engine test suite:
```bash
npm test
```
This tests:
1. Single-pass detection across test replays in `external/slippi-js-master/slp/` (L-cancels, wavedashes, wavelands, full games).
2. Compressed payload creation and on-the-fly decompression.
3. SQLite transactional ingestion and analytics queries.

## 🌐 Browser UI Console

Flowstate includes an interactive browser-based frontend for building, previewing, and executing CLI commands:

```bash
# Start the web UI on http://localhost:3000
npm run ui

# Or specify a custom port
node src/cli.js serve --port=8080
```

- **Interactive Command Builder**: Form controls with character dropdowns (26 Melee characters), batch sliders, continuous toggles, export format selectors, and recent replay selectors.
- **Live Command Preview**: Reactive command string preview box with 1-click clipboard copy.
- **Embedded Streaming Console**: Real-time ANSI colored terminal output streaming from the CLI process via Server-Sent Events (SSE).
- **Process Lifecycle & Abort**: Real-time timer and graceful `SIGINT` abort button.

---

## 💻 CLI Commands

The engine provides a unified CLI via `npm run cli -- <command>` (or `node src/cli.js <command>`):

### 1. Web UI Server
Launch the interactive web console:
```bash
npm run ui
# or: npm run cli -- serve
```

### 2. Global Dataset Overview
Display overall game counts, unique players, date coverage, top characters, and mechanical averages:
```bash
npm run cli -- overview
```

### 2. Head-to-Head Character Matchup Analysis
Query winrates, stage win distributions, and mechanical differentials between any two characters:
```bash
npm run cli -- matchup fox marth
```

### 3. Deep Replay Inspection
Decompress and inspect the granular payload for a specific match ID:
```bash
npm run cli -- game <gameId>
```

### 4. Player Scouting Report
Query match history, character usage, winrates, and execution averages for a specific Slippi connect code:
```bash
npm run cli -- player MANG#0
```

### 5. Bulk Ingestion Pipeline
Launch the batch ingestion daemon from Lunar Melee:
```bash
# Ingest a single batch of 100 replays
npm run cli -- batch --size=100 --batches=1

# Run continuously with automatic cursor checkpointing
npm run cli -- batch --size=100 --continuous
```

### 6. Pipeline Progress Status
Check current ingestion progress and cursor checkpoints:
```bash
npm run cli -- status
```

### 7. Dataset Export
Export indexed match records to JSON or CSV:
```bash
# Export to CSV
npm run cli -- export --format=csv --out=./export.csv

# Export to JSON
npm run cli -- export --format=json --out=./export.json
```
