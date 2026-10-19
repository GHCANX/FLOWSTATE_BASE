# Project: Melee Behavioral Habit & Vulnerability Profiling Engine

## Architecture
FlowState is a local Super Smash Bros. Melee replay analytics engine operating on frame-by-frame Slippi replay data (`@slippi/slippi-js/node`).
- **Data Ingestion & Detection**: `src/analysis/frameConsumer.js` drives frame loops, invoking `MechanicsDetector` and `TacticalDetector` (`src/analysis/tacticalDetector.js`) using Melee action state constants (`src/constants/actionStates.js`) and stage geometry (`src/constants/stages.js`).
- **Dual-Storage Contract**:
  - Relational indexes and aggregate metrics are stored in `analytics.db` via `node:sqlite` (`src/database/db.js`, `src/database/repository.js`, `src/database/schema.sql`).
  - High-density timelines are stored in date-sharded `.json.gz` payloads (`payloads/YYYY/MM/<id>.json.gz`) via `src/analysis/payloadBuilder.js`.
  - Zero `.slp` disk accumulation ensures temporary `.slp` files are purged immediately upon transaction commit in `src/orchestrator/batchPipeline.js`.
- **Query & Presentation Layer**: `src/query/analyticsService.js` provides analytical SQL queries and rolling aggregations. `src/server/server.js` exposes native Node.js HTTP REST endpoints (`/api/games/:id/habits`, `/api/players/:connectCode/habits`).
- **Agent Skills**: Mathematical formulas and heuristic thresholds are documented in `.agents/skills/`.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | Action State Definitions & Predicates | Add missed-tech wakeup states (0xB8-0xBC, 0xC0-0xC4) and helper predicates (`isAttack`, `isWakeup`, `isDownWait`, `isStandardLedgeOption`) to `src/constants/actionStates.js` | M1 | ORIGINAL_REQUEST §R1 |
| F2 | Defensive Recovery & Getup Habits | Detect standard ledge options and 35f ledgedash heuristic to stage surface with intermediate states | M1 | ORIGINAL_REQUEST §R1 |
| F3 | Ground Tech & Missed-Tech Wakeup Options | Detect tech neutral/forward/back/wall and missed-tech wakeups (stand, roll fwd/back, getup attack) | M1 | ORIGINAL_REQUEST §R1 |
| F4 | Punish Classification Rule | Flag getup/tech/wakeup as punished if taking damage/hitstun in end-lag or within strict 30f recovery window before counter-hit | M1 | ORIGINAL_REQUEST §R1 |
| F5 | Action State Number Matching | Match offensive moves using raw numeric values `(id >= 0x2C && id <= 0x45) || id >= 341` | M1 | ORIGINAL_REQUEST §R1 |
| F6 | Grab Initiation Context | Categorize grabs into shield-pressure (within 15f), scramble (simultaneous actionable, D <= 18.0, 30f clean), or neutral setup (D > 18.0) | M1 | ORIGINAL_REQUEST §R1 |
| F7 | Neutral Reset vs Over-Extension | Over 45f advantage neutralization window: classify neutral reset (separation delta D > 0, retreat) vs over-extension (attack/dash/grab resulting in whiff/counter-hit) | M1 | ORIGINAL_REQUEST §R1 |
| F8 | Defensive Vulnerabilities & Escape Routes | Track OOS choices (grab, up-smash, aerials 0x41-0x45 / jumpsquat 0x18, roll, spotdodge, wavedash) and corner drift (|X| -> ground.xMax under D <= 20.0) | M1 | ORIGINAL_REQUEST §R1 |
| F9 | SQLite Schema `player_habits_stats` | Create table with composite PK `(game_id, player_index)`, FK CASCADE, denormalized `connect_code`/`character_id`, indexes `idx_habits_connect_code`, `idx_habits_char`, 40 counters, and `is_complete` flag | M2 | ORIGINAL_REQUEST §R2 |
| F10 | Repository Persistence | Add prepared statements and `saveProcessedGame` persistence for `player_habits_stats` in `ReplayRepository` | M2 | ORIGINAL_REQUEST §R2 |
| F11 | Granular Payload Serialization | Add `habits: { getupEvents, grabTriggers, transitionDecisions, escapeSequences }` to date-sharded gzip payloads | M2 | ORIGINAL_REQUEST §R2 |
| F12 | Immediate Replay Purging | Ensure temporary `.slp` files are deleted immediately after transaction commit in `batchPipeline.js` (zero accumulation) | M2 | ORIGINAL_REQUEST §R2, AGENTS.md |
| F13 | Match Habits Endpoint | Implement `GET /api/games/:id/habits` in `AnalyticsService` and `server.js` with `?playerIndex=` and `?port=` fallback | M3 | ORIGINAL_REQUEST §R3 |
| F14 | Player Rolling Habit Profile Endpoint | Implement `GET /api/players/:connectCode/habits` with SQL sums, `WHERE is_complete = 1`, relational JOIN with `game_players opp` and `games g`, query filters (`?opponentConnectCode=`, `?characterId=`, `?opponentCharacterId=`, `?stageId=`) | M3 | ORIGINAL_REQUEST §R3 |
| F15 | Scope Isolation | Guarantee ingestion telemetry routes do not leak player habit metrics | M3 | ORIGINAL_REQUEST §R3, AGENTS.md |
| F16 | Agent Skill Definitions Update | Document formulas, action states, and heuristic windows in `melee-tactical-interpreter` and `melee-mechanics-analyzer` skills | M4 | ORIGINAL_REQUEST §R4 |
| F17 | Comprehensive Test Suite & Fixtures | Implement `test/habit_analysis_test.js` with real replay (`unranked_game1.slp`), synthetic fixtures, SQLite/PK/index verification, payload validation, API checks, zero regressions on `npm test`, runtime compliance | M5 | ORIGINAL_REQUEST Acceptance Criteria |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Habit Detection Engine | `src/constants/actionStates.js`, `src/analysis/tacticalDetector.js`, `src/analysis/mechanicsDetector.js` | none | DONE (`m1_habit_detector_test.js` passed, 40 counters extracted, heuristics verified) |
| M2 | Dual-Storage Schema & Payloads | `src/database/schema.sql`, `src/database/repository.js`, `src/analysis/frameConsumer.js`, `src/orchestrator/batchPipeline.js` | M1 | DONE (`player_habits_stats` created, zero `.slp` accumulation verified, payload sharding verified) |
| M3 | Query Service & REST APIs | `src/query/analyticsService.js`, `src/server/server.js` | M2 | DONE (`/api/games/:id/habits` and `/api/players/:connectCode/habits` returning HTTP 200, scope isolation verified) |
| M4 | Agent Skills Documentation | `.agents/skills/melee-tactical-interpreter/SKILL.md`, `.agents/skills/melee-mechanics-analyzer/SKILL.md` | M1 | DONE (complete mathematical formulas and heuristic windows documented) |
| M5 | E2E Test Suite & Adversarial Verification | `test/habit_analysis_test.js`, regression verification (`npm test`), integrity checks | M1, M2, M3, M4 | DONE (8/8 sections passed, zero regressions on `npm test`, stress suites clean, forensic audit clean) |

## Interface Contracts

### M1 ↔ M2 (`TacticalDetector` ↔ `FrameConsumer` / `ReplayRepository`)
- `TacticalDetector.getHabitStats(playerIndex)`:
  - Returns raw counters matching table columns: `climb_count`, `climb_punished`, `attack_count`, `attack_punished`, `roll_count`, `roll_punished`, `jump_count`, `jump_punished`, `ledgedash_count`, `ledgedash_punished`, `tech_neutral_count`, `tech_neutral_punished`, `tech_forward_count`, `tech_forward_punished`, `tech_back_count`, `tech_back_punished`, `tech_miss_count`, `tech_miss_punished`, `wakeup_stand_count`, `wakeup_stand_punished`, `wakeup_forward_count`, `wakeup_forward_punished`, `wakeup_back_count`, `wakeup_back_punished`, `wakeup_attack_count`, `wakeup_attack_punished`, `grabs_shield_pressure`, `grabs_scramble`, `grabs_neutral`, `neutral_resets`, `over_extensions`, `oos_roll_count`, `oos_roll_punished`, `oos_spotdodge_count`, `oos_spotdodge_punished`, `oos_grab_count`, `oos_grab_punished`, `oos_aerial_count`, `oos_aerial_punished`, `corner_drift_count`.
- `TacticalDetector.getHabitPayload()`:
  - Returns `{ getupEvents: [...], grabTriggers: [...], transitionDecisions: [...], escapeSequences: [...] }`.
  - Each event contains `{ frame, playerIndex, x, y, type, punished, ... }`.

### M2 ↔ M3 (`ReplayRepository` / `analytics.db` ↔ `AnalyticsService`)
- SQLite Table: `player_habits_stats`
  - Composite PK: `(game_id, player_index)`
  - Foreign key: `FOREIGN KEY (game_id) REFERENCES games(game_id) ON DELETE CASCADE`
  - Columns: `game_id TEXT NOT NULL`, `player_index INTEGER NOT NULL`, `connect_code TEXT`, `character_id INTEGER NOT NULL`, `is_complete BOOLEAN NOT NULL DEFAULT 1`, plus the 40 counter columns.
  - Indexes: `CREATE INDEX idx_habits_connect_code ON player_habits_stats(connect_code);` and `CREATE INDEX idx_habits_char ON player_habits_stats(character_id);`.

### M3 ↔ Server Endpoints
- `GET /api/games/:id/habits`:
  - Query parameters: optional `playerIndex`, `port`.
  - Returns `{ gameId, isComplete, players: [ { playerIndex, connectCode, characterId, stats, events } ] }`.
- `GET /api/players/:connectCode/habits`:
  - Query parameters: optional `opponentConnectCode`, `characterId`, `opponentCharacterId`, `stageId`.
  - Filters: `WHERE h.is_complete = 1`.
  - Returns aggregated sums, calculated ratios (`punish_rate = SUM(punished) * 1.0 / NULLIF(SUM(count), 0)`), and games analyzed count.

## Code Layout & File Ownership
| File | Owning Milestone / Worker |
|------|---------------------------|
| `src/constants/actionStates.js` | M1 |
| `src/analysis/tacticalDetector.js` | M1 |
| `src/analysis/mechanicsDetector.js` | M1 |
| `src/database/schema.sql` | M2 |
| `src/database/repository.js` | M2 |
| `src/analysis/frameConsumer.js` | M2 |
| `src/analysis/payloadBuilder.js` | M2 |
| `src/orchestrator/batchPipeline.js` | M2 |
| `src/query/analyticsService.js` | M3 |
| `src/server/server.js` | M3 |
| `.agents/skills/melee-tactical-interpreter/SKILL.md` | M4 |
| `.agents/skills/melee-mechanics-analyzer/SKILL.md` | M4 |
| `test/habit_analysis_test.js` | M5 |
