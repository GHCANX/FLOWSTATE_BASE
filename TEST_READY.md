# TEST_READY: Melee Behavioral Habit & Vulnerability Profiling Engine

## Test Suite Overview
- **Test File**: `test/habit_analysis_test.js`
- **Execution Command**: `node --no-warnings test/habit_analysis_test.js`
- **Architecture**: Self-contained Native Node.js ESM test suite using standard assertions (`node:assert`, `node:http`, `node:fs`, `node:zlib`, `node:sqlite`). Zero external test runner dependencies.
- **Zero Regression Verification**: `npm test` (`node --no-warnings test/stage1_local_test.js && node --no-warnings test/server_test.js`) executes cleanly with zero regressions.

---

## 8-Section Verification Coverage

| # | Section | Coverage Details | Current Status | Blocker / Milestone Dependency |
|---|---------|------------------|:--------------:|--------------------------------|
| 1 | **Real Replay Processing** | Ingests `external/slippi-js-master/slp/unranked_game1.slp` (45 frames, ended by LRAS); asserts `is_complete = 0` in `player_habits_stats`, SQLite transaction commit, and date-sharded `.json.gz` payload generation. | ⏳ Pending M2 | Requires `player_habits_stats` table in `schema.sql` & persistence in `FrameConsumer`/`ReplayRepository`. |
| 2 | **Deterministic Synthetic Baseline Habits** | Synthesizes frame sequences across 1,555 frames covering all 40 counters in `player_habits_stats` (climb, attack, roll, jump, ledgedash; tech neutral/forward/back/miss; wakeup stand/forward/back/attack; grabs shield_pressure/scramble/neutral; neutral_resets, over_extensions; oos roll/spotdodge/grab/aerial/corner_drift, and their respective `_punished` counters). | ✅ PASS | Verified against `TacticalDetector` habit engine. |
| 3 | **Rare Edge Interaction Fixtures** | Rigorously asserts mathematical and frame boundaries: 35f ledgedash threshold (35f elapsed valid vs 36f elapsed invalid), cliff re-grab & damage invalidation, strict 30f punish window (frame 30 punished vs frame 31 safe vs counter-hit exemption), grab initiation contexts (shield pressure $\le 15$f, scramble distance $D \le 18.0$ with 30f clean history vs $D = 18.01$ neutral setup vs dirty history disqualification), 45f advantage neutralization window (retreat $\Delta D > 0$ vs attack whiff/counter-hit vs attack after window expiration). | ✅ PASS | Verified against `TacticalDetector` state machines. |
| 4 | **SQLite Database & Schema Validation** | Validates table creation, all 42+ columns and types, composite primary key `(game_id, player_index)` constraint enforcement, ON CONFLICT update, `FOREIGN KEY (game_id) REFERENCES games(game_id) ON DELETE CASCADE`, and indexes `idx_habits_connect_code` & `idx_habits_char`. | ⏳ Pending M2 | Requires `CREATE TABLE player_habits_stats` in `src/database/schema.sql`. |
| 5 | **Decompressed Payload Validation & Disk Hygiene** | Gunzips date-sharded `payloads/YYYY/MM/<id>.json.gz` and validates full JSON schema of `habits` (`getupEvents`, `grabTriggers`, `transitionDecisions`, `escapeSequences`). Verifies zero `.slp` files remain in `./temp_slp/` (zero accumulation invariant). | ✅ PASS | Verified. |
| 6 | **AnalyticsService Relational Rolling Queries & Filters** | Tests SQL SUMs and punish percentage calculations (`SUM(punished) * 1.0 / NULLIF(SUM(count), 0)`). Validates relational JOINs against `game_players opp` and `games g`. Asserts that incomplete games (`is_complete = 0`, such as `unranked_game1.slp`) are strictly excluded (`WHERE is_complete = 1`). Asserts filtering by `?opponentConnectCode=`, `?characterId=`, `?opponentCharacterId=`, and `?stageId=`. | ✅ PASS | Verified with isolated SQLite test fixtures. |
| 7 | **REST API Endpoints** | Spins up server on port 0; validates `GET /api/games/:id/habits` (with fallback to `?playerIndex=` and `?port=`) returns HTTP 200 with habits breakdown; validates `GET /api/players/:connectCode/habits` (handling URL-encoded connect codes e.g. `%23`) returns HTTP 200 with aggregated profiles and filter support. | ⏳ Pending M3 | Requires route registration in `src/server/server.js` and AnalyticsService habit methods. |
| 8 | **Scope Isolation** | Inspects operational pipeline telemetry endpoints (`/api/pipeline/status`, `/api/batches`, `/api/storage/footprint`) to guarantee zero player habit metrics leak into infrastructure monitoring views. | ✅ PASS | Verified. |

---

## How to Run the Tests

### 1. Execute Habit Analysis E2E Test Suite
```bash
node --no-warnings test/habit_analysis_test.js
```

### 2. Verify Zero Regressions on Existing Test Suite
```bash
npm test
```

---

## Implementation Escalations & Requirements for Dependent Workers

1. **Worker M2 (`schema.sql`, `repository.js`, `frameConsumer.js`)**:
   - Add `player_habits_stats` table to `src/database/schema.sql` with composite primary key `(game_id, player_index)` and `FOREIGN KEY (game_id) REFERENCES games(game_id) ON DELETE CASCADE`.
   - Add indexes `CREATE INDEX IF NOT EXISTS idx_habits_connect_code ON player_habits_stats(connect_code)` and `CREATE INDEX IF NOT EXISTS idx_habits_char ON player_habits_stats(character_id)`.
   - Update `ReplayRepository.saveProcessedGame` to insert habit records into `player_habits_stats` on transaction commit.
   - In `FrameConsumer.processReplay`: evaluate `is_complete = (durationFrames >= 1800 && endMethod !== 7 && lrasPort === null) ? 1 : 0`, and attach `habits` object to deep payload.

2. **Worker M3 (`analyticsService.js`, `server.js`)**:
   - Implement `getPlayerHabits(connectCode, filters)` in `AnalyticsService` using the relational rolling query filtering `WHERE is_complete = 1`.
   - Implement `getGameHabits(gameId)` in `AnalyticsService`.
   - Register routes `GET /api/games/:id/habits` and `GET /api/players/:connectCode/habits` in `src/server/server.js`.
