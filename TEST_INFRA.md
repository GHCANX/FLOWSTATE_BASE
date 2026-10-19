# E2E Test Infra: Melee Behavioral Habit & Vulnerability Profiling Engine

## Test Philosophy
- Opaque-box, requirement-driven verification derived directly from `ORIGINAL_REQUEST.md` and `AGENTS.md`.
- Native Node.js ESM execution (`node --no-warnings test/habit_analysis_test.js`) with zero external test runner dependencies.
- Methodology: Category-Partition + Boundary Value Analysis (BVA) + Pairwise Combinatorial Testing + Real-World Workload Testing.
- Dual-replay strategy:
  - Real replay `external/slippi-js-master/slp/unranked_game1.slp` (45 frames, ended by LRAS) verifies real-world parser compatibility and asserts `is_complete = 0` exclusion in rolling player queries.
  - Deterministic synthetic fixtures guarantee 100% classification branch coverage across all 40 counters and rare tactical interactions (e.g., 35f ledgedash -> 30f punish, scramble grab <= 18.0 units, over-extension counter-hits in 45f advantage window).

## Feature Inventory & Test Coverage
| # | Feature | Source | Tier 1 | Tier 2 | Tier 3 | Tier 4 |
|---|---------|--------|:------:|:------:|:------:|:------:|
| F1 | Action State Definitions & Predicates | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| F2 | Defensive Recovery & Ledge Habits | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| F3 | Ground Tech & Missed-Tech Wakeup Options | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| F4 | Punish Classification Rule | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| F5 | Action State Number Matching | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| F6 | Grab Initiation Context | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| F7 | Neutral Reset vs Over-Extension Boundary | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| F8 | Defensive Vulnerabilities & OOS Habits | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| F9 | SQLite Schema `player_habits_stats` | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ | ✓ |
| F10 | Replay Repository Persistence | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ | ✓ |
| F11 | Granular Payload Serialization | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ | ✓ |
| F12 | Immediate Replay Purging (Zero Accumulation) | ORIGINAL_REQUEST §R2, AGENTS.md | 5 | 5 | ✓ | ✓ |
| F13 | Match Habits Endpoint (`GET /api/games/:id/habits`) | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| F14 | Player Rolling Habit Profile (`GET /api/players/:connectCode/habits`) | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| F15 | Scope Isolation (No Habit Leaks in Ingestion Telemetry) | ORIGINAL_REQUEST §R3, AGENTS.md | 5 | 5 | ✓ | ✓ |
| F16 | Agent Skill Definitions Sync | ORIGINAL_REQUEST §R4 | 5 | 5 | ✓ | ✓ |

## Test Architecture
- **Test File**: `test/habit_analysis_test.js`
- **Execution Command**: `node --no-warnings test/habit_analysis_test.js`
- **Pass/Fail Semantics**: Standard Node assertions (`assert.strictEqual`, `assert.deepStrictEqual`, `assert.ok`). Exits with code 0 on pass, non-zero on failure.
- **Child Process Environment**: All invocations pass `{ env: { ...process.env, NODE_NO_WARNINGS: '1' } }`.
- **Zero Regression Guard**: Running `npm test` executes `test/stage1_local_test.js` and `test/server_test.js` without errors.

## Test Sections in `test/habit_analysis_test.js`
1. **Section 1: Real Replay Processing (`unranked_game1.slp`)**:
   - Parses the 45-frame replay using `@slippi/slippi-js/node`.
   - Asserts `is_complete = 0` (duration < 1800 frames and LRAS).
   - Confirms dual-storage write succeeds.
2. **Section 2: Deterministic Synthetic Baseline Habit Fixtures**:
   - Synthesizes frame sequences covering all 40 counters:
     - Ledge options (climb, attack, roll, jump, ledgedash).
     - Tech options (neutral, forward, back, miss).
     - Wakeup options (stand, forward, back, attack).
     - Grab triggers (shield-pressure, scramble, neutral).
     - Transitions (neutral reset, over-extension).
     - OOS choices (roll, spotdodge, grab, aerial, corner drift).
3. **Section 3: Rare Edge Interaction Fixtures**:
   - Ledgedash boundary: landing at frame 35 vs 36; landing with intermediate FALL/JUMP vs re-grabbing cliff.
   - Punish timing: taking damage at frame 30 (punished) vs frame 31 (unpunished).
   - Scramble distance: Euclidean distance 18.0 (scramble) vs 18.1 (neutral setup); dirty history within 30f vs clean history.
   - Over-extension: forward dash commitment into counter-hit vs retreating neutral reset ($\Delta D > 0$).
4. **Section 4: SQLite Database & Integrity Constraints**:
   - Validates table creation, column types, composite PK `(game_id, player_index)`.
   - Tests `ON CONFLICT` updates and `FOREIGN KEY (game_id) ON DELETE CASCADE`.
   - Verifies indexes `idx_habits_connect_code` and `idx_habits_char`.
5. **Section 5: Payload Serialization & Disk Hygiene**:
   - Gunzips sharded `payloads/YYYY/MM/<id>.json.gz` and verifies schema of `habits` object.
   - Asserts `./temp_slp/` has 0 leftover files after processing.
6. **Section 6: AnalyticsService Query Filtering & Incomplete Match Exclusion**:
   - Tests rolling profile SQL aggregations with filters:
     - `opponentConnectCode`
     - `characterId`
     - `opponentCharacterId`
     - `stageId`
   - Verifies incomplete matches (`is_complete = 0`) are excluded from rolling averages.
7. **Section 7: REST API Contracts**:
   - `GET /api/games/:id/habits` -> HTTP 200 with fallback to `playerIndex` or `port`.
   - `GET /api/players/:connectCode/habits` (with URL-encoded connect code e.g. `%23`) -> HTTP 200.
8. **Section 8: Scope Isolation**:
   - Inspects `/api/pipeline/status`, `/api/batches`, `/api/storage/footprint` to confirm zero player habit leaks.
