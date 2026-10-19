/**
 * Challenger 2: Adversarial Storage, Database Integrity, Query Analytics, and API Robustness Stress Suite
 *
 * Verifies:
 * 1. SQLite composite PK (game_id, player_index) conflict resolution (ON CONFLICT DO UPDATE) and FK cascade delete.
 * 2. Incomplete match exclusion (duration < 1800 frames, end_method = 7 / LRAS) from rolling player habit averages.
 * 3. Query filters with edge inputs (%23 connect codes, non-existent player, 0-match combinations, NULL sums handling, SQL injection resistance).
 * 4. Scope isolation: zero player habit metrics leaked into /api/pipeline/status, /api/batches, /api/storage/footprint.
 * 5. Zero .slp disk accumulation: verify temp_slp/ remains clean even on corrupted replay or pipeline exception.
 */

import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getDatabase, closeDatabase } from '../src/database/db.js';
import { ReplayRepository } from '../src/database/repository.js';
import { AnalyticsService } from '../src/query/analyticsService.js';
import { createServer } from '../src/server/server.js';
import { BatchPipeline } from '../src/orchestrator/batchPipeline.js';
import { FileCleaner } from '../src/orchestrator/fileCleaner.js';

// HTTP helper
function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data: data ? JSON.parse(data) : null,
            raw: data,
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data: null,
            raw: data,
            parseError: e,
          });
        }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

const TEST_DB_PATH = './test_challenger2_stress.db';

function setupCleanDb() {
  closeDatabase();
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  if (fs.existsSync(`${TEST_DB_PATH}-wal`)) fs.unlinkSync(`${TEST_DB_PATH}-wal`);
  if (fs.existsSync(`${TEST_DB_PATH}-shm`)) fs.unlinkSync(`${TEST_DB_PATH}-shm`);
  return getDatabase(TEST_DB_PATH);
}

function cleanupDb() {
  closeDatabase();
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  if (fs.existsSync(`${TEST_DB_PATH}-wal`)) fs.unlinkSync(`${TEST_DB_PATH}-wal`);
  if (fs.existsSync(`${TEST_DB_PATH}-shm`)) fs.unlinkSync(`${TEST_DB_PATH}-shm`);
}

async function runChallenger2StressSuite() {
  console.log('======================================================================');
  console.log('CHALLENGER 2: ADVERSARIAL STRESS TEST SUITE');
  console.log('======================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function runTest(name, fn) {
    totalTests++;
    try {
      fn();
      console.log(`  ✔ [PASS] ${name}`);
      passedTests++;
    } catch (err) {
      console.error(`  ✖ [FAIL] ${name}: ${err.message}`);
      if (err.stack) {
        console.error(err.stack.split('\n').slice(1, 4).join('\n'));
      }
      throw err;
    }
  }

  async function runAsyncTest(name, fn) {
    totalTests++;
    try {
      await fn();
      console.log(`  ✔ [PASS] ${name}`);
      passedTests++;
    } catch (err) {
      console.error(`  ✖ [FAIL] ${name}: ${err.message}`);
      if (err.stack) {
        console.error(err.stack.split('\n').slice(1, 4).join('\n'));
      }
      throw err;
    }
  }

  // =========================================================================
  // 1. Composite PK Conflict Resolution & FK Cascade Delete
  // =========================================================================
  console.log('--- 1. Testing SQLite Composite PK & FK Cascade Deletion ---');

  runTest('Composite PK rejects duplicate (game_id, player_index) without ON CONFLICT', () => {
    const db = setupCleanDb();
    const repo = new ReplayRepository(TEST_DB_PATH);

    // Insert game
    db.prepare(`
      INSERT INTO games (game_id, file_hash, start_at, duration_frames, duration_seconds, stage_id, game_mode, payload_path)
      VALUES ('game_pk_test', 'hash_pk_test', '2026-10-19T00:00:00Z', 2000, 33.3, 31, 2, 'payloads/pk.json.gz')
    `).run();

    // Insert player 0
    db.prepare(`
      INSERT INTO player_habits_stats (game_id, player_index, connect_code, character_id, climb_count)
      VALUES ('game_pk_test', 0, 'PLAYER#001', 2, 5)
    `).run();

    // Insert player 1 (same game_id, different player_index) -> Must succeed
    db.prepare(`
      INSERT INTO player_habits_stats (game_id, player_index, connect_code, character_id, climb_count)
      VALUES ('game_pk_test', 1, 'PLAYER#002', 20, 7)
    `).run();

    // Attempting duplicate (game_pk_test, 0) without ON CONFLICT must throw
    assert.throws(() => {
      db.prepare(`
        INSERT INTO player_habits_stats (game_id, player_index, connect_code, character_id, climb_count)
        VALUES ('game_pk_test', 0, 'PLAYER#001', 2, 99)
      `).run();
    }, /PRIMARYKEY|constraint/i);
  });

  runTest('saveProcessedGame ON CONFLICT DO UPDATE correctly updates all habit counters', () => {
    const db = setupCleanDb();
    const repo = new ReplayRepository(TEST_DB_PATH);

    const gameRecord = {
      gameId: 'game_update_test',
      fileHash: 'hash_update_test',
      startAt: '2026-10-19T01:00:00Z',
      durationFrames: 3000,
      durationSeconds: 50.0,
      stageId: 31,
      gameMode: 2,
      payloadPath: 'payloads/update.json.gz',
    };
    const players = [
      { playerIndex: 0, port: 1, characterId: 2, connectCode: 'UPDATE#001' },
      { playerIndex: 1, port: 2, characterId: 20, connectCode: 'UPDATE#002' },
    ];
    const initialHabits = [
      {
        playerIndex: 0,
        characterId: 2,
        connectCode: 'UPDATE#001',
        isComplete: 1,
        climb_count: 5,
        attack_count: 3,
        grabs_shield_pressure: 2,
        neutral_resets: 1,
      },
      {
        playerIndex: 1,
        characterId: 20,
        connectCode: 'UPDATE#002',
        isComplete: 1,
        climb_count: 8,
        attack_count: 4,
        grabs_shield_pressure: 3,
        neutral_resets: 2,
      }
    ];

    // Initial save
    repo.saveProcessedGame(gameRecord, players, [], [], initialHabits);

    let rowP0 = db.prepare('SELECT climb_count, attack_count, grabs_shield_pressure, neutral_resets FROM player_habits_stats WHERE game_id = ? AND player_index = ?').get('game_update_test', 0);
    assert.strictEqual(rowP0.climb_count, 5);
    assert.strictEqual(rowP0.attack_count, 3);
    assert.strictEqual(rowP0.grabs_shield_pressure, 2);

    // Re-save with updated values (testing ON CONFLICT DO UPDATE resolution)
    const updatedHabits = [
      {
        playerIndex: 0,
        characterId: 2,
        connectCode: 'UPDATE#001',
        isComplete: 1,
        climb_count: 25,
        attack_count: 14,
        grabs_shield_pressure: 9,
        neutral_resets: 6,
      },
      {
        playerIndex: 1,
        characterId: 20,
        connectCode: 'UPDATE#002',
        isComplete: 1,
        climb_count: 30,
        attack_count: 18,
        grabs_shield_pressure: 12,
        neutral_resets: 8,
      }
    ];

    repo.saveProcessedGame(gameRecord, players, [], [], updatedHabits);

    // Verify row counts: should still be exactly 2 rows
    const totalRows = db.prepare('SELECT COUNT(*) as count FROM player_habits_stats WHERE game_id = ?').get('game_update_test').count;
    assert.strictEqual(totalRows, 2, 'ON CONFLICT DO UPDATE must not insert duplicate rows');

    rowP0 = db.prepare('SELECT climb_count, attack_count, grabs_shield_pressure, neutral_resets FROM player_habits_stats WHERE game_id = ? AND player_index = ?').get('game_update_test', 0);
    assert.strictEqual(rowP0.climb_count, 25, 'climb_count must update');
    assert.strictEqual(rowP0.attack_count, 14, 'attack_count must update');
    assert.strictEqual(rowP0.grabs_shield_pressure, 9, 'grabs_shield_pressure must update');
    assert.strictEqual(rowP0.neutral_resets, 6, 'neutral_resets must update');
  });

  runTest('Foreign Key ON DELETE CASCADE purges player_habits_stats when parent game is deleted', () => {
    const db = setupCleanDb();
    const repo = new ReplayRepository(TEST_DB_PATH);

    // Verify PRAGMA foreign_keys is 1
    const fkPragma = db.prepare('PRAGMA foreign_keys;').get();
    assert.strictEqual(fkPragma.foreign_keys, 1, 'PRAGMA foreign_keys must be active');

    // Save game with full child records
    const gameRecord = {
      gameId: 'game_cascade_test',
      fileHash: 'hash_cascade_test',
      startAt: '2026-10-19T02:00:00Z',
      durationFrames: 2500,
      durationSeconds: 41.6,
      stageId: 31,
      gameMode: 2,
      payloadPath: 'payloads/cascade.json.gz',
    };
    const players = [
      { playerIndex: 0, port: 1, characterId: 2, connectCode: 'CASC#001' },
      { playerIndex: 1, port: 2, characterId: 20, connectCode: 'CASC#002' },
    ];
    const habits = [
      { playerIndex: 0, characterId: 2, connectCode: 'CASC#001', isComplete: 1, climb_count: 4 },
      { playerIndex: 1, characterId: 20, connectCode: 'CASC#002', isComplete: 1, climb_count: 6 },
    ];
    repo.saveProcessedGame(gameRecord, players, [], [], habits);

    assert.strictEqual(db.prepare('SELECT COUNT(*) as count FROM games WHERE game_id = ?').get('game_cascade_test').count, 1);
    assert.strictEqual(db.prepare('SELECT COUNT(*) as count FROM game_players WHERE game_id = ?').get('game_cascade_test').count, 2);
    assert.strictEqual(db.prepare('SELECT COUNT(*) as count FROM player_habits_stats WHERE game_id = ?').get('game_cascade_test').count, 2);

    // Delete parent game
    db.prepare('DELETE FROM games WHERE game_id = ?').run('game_cascade_test');

    // Confirm child tables cascade-deleted
    assert.strictEqual(db.prepare('SELECT COUNT(*) as count FROM games WHERE game_id = ?').get('game_cascade_test').count, 0);
    assert.strictEqual(db.prepare('SELECT COUNT(*) as count FROM game_players WHERE game_id = ?').get('game_cascade_test').count, 0, 'game_players must be cascade-deleted');
    assert.strictEqual(db.prepare('SELECT COUNT(*) as count FROM player_habits_stats WHERE game_id = ?').get('game_cascade_test').count, 0, 'player_habits_stats must be cascade-deleted');
  });

  // =========================================================================
  // 2. Incomplete Match Exclusion from Rolling Player Averages
  // =========================================================================
  console.log('\n--- 2. Testing Incomplete Match Exclusion ---');

  runTest('Incomplete matches (< 1800f, LRAS, No Contest) are strictly excluded from getPlayerHabitsProfile', () => {
    const db = setupCleanDb();
    const repo = new ReplayRepository(TEST_DB_PATH);
    const analytics = new AnalyticsService(TEST_DB_PATH);

    // Helper to insert a game and habits
    function insertGame(id, frames, endMethod, lrasPort, isComplete, climbs, climbsPunished) {
      db.prepare(`
        INSERT INTO games (game_id, file_hash, start_at, duration_frames, duration_seconds, stage_id, game_mode, end_method, lras_port, payload_path)
        VALUES (?, ?, '2026-10-19T03:00:00Z', ?, ?, 31, 2, ?, ?, ?)
      `).run(id, `hash_${id}`, frames, frames / 60, endMethod, lrasPort, `payloads/${id}.json.gz`);

      db.prepare(`
        INSERT INTO game_players (game_id, player_index, port, character_id, costume_index, connect_code, start_stocks, end_stocks)
        VALUES (?, 0, 1, 2, 0, 'TARGET#001', 4, 2)
      `).run(id);

      db.prepare(`
        INSERT INTO game_players (game_id, player_index, port, character_id, costume_index, connect_code, start_stocks, end_stocks)
        VALUES (?, 1, 2, 20, 0, 'OPP#002', 4, 0)
      `).run(id);

      db.prepare(`
        INSERT INTO player_habits_stats (
          game_id, player_index, connect_code, character_id, is_complete,
          climb_count, climb_punished
        ) VALUES (?, 0, 'TARGET#001', 2, ?, ?, ?)
      `).run(id, isComplete ? 1 : 0, climbs, climbsPunished);
    }

    // 1. Complete game: 3600 frames (> 1800), endMethod = 2, lrasPort = null -> is_complete = 1
    insertGame('comp_1', 3600, 2, null, true, 10, 2);

    // 2. Incomplete game: 1799 frames (< 1800 frames boundary!) -> is_complete = 0
    insertGame('incomp_short', 1799, 2, null, false, 50, 25);

    // 3. Incomplete game: 3600 frames, but endMethod = 7 (No Contest) -> is_complete = 0
    insertGame('incomp_no_contest', 3600, 7, null, false, 100, 50);

    // 4. Incomplete game: 3600 frames, endMethod = 2, but lrasPort = 0 (Rage-quit) -> is_complete = 0
    insertGame('incomp_lras', 3600, 2, 0, false, 200, 100);

    // 5. Another complete game: 1800 frames (exact threshold), endMethod = 2, lrasPort = -1 -> is_complete = 1
    insertGame('comp_2_exact', 1800, 2, -1, true, 20, 6);

    const profile = analytics.getPlayerHabitsProfile('TARGET#001');

    assert.strictEqual(profile.totalGames, 2, 'Only 2 complete games must be aggregated');
    assert.strictEqual(profile.gamesAnalyzed, 2, 'gamesAnalyzed must be 2');
    assert.strictEqual(profile.totals.climb_count, 30, 'Total climbs must be exactly 10 + 20 = 30 (excluding 50, 100, 200)');
    assert.strictEqual(profile.totals.climb_punished, 8, 'Total climb punished must be exactly 2 + 6 = 8 (excluding 25, 50, 100)');
    assert.strictEqual(profile.rates.climb_punish_rate, 8.0 / 30.0, 'climb_punish_rate must be calculated only over complete games');
  });

  runTest('Player with ONLY incomplete matches returns totalGames = 0 without error', () => {
    const db = setupCleanDb();
    const analytics = new AnalyticsService(TEST_DB_PATH);

    // Insert only incomplete matches for INCOMP#001
    db.prepare(`
      INSERT INTO games (game_id, file_hash, start_at, duration_frames, duration_seconds, stage_id, game_mode, end_method, lras_port, payload_path)
      VALUES ('incomp_only', 'hash_incomp_only', '2026-10-19T03:30:00Z', 500, 8.3, 31, 2, 7, 0, 'payloads/incomp.json.gz')
    `).run();
    db.prepare(`
      INSERT INTO game_players (game_id, player_index, port, character_id, costume_index, connect_code, start_stocks, end_stocks)
      VALUES ('incomp_only', 0, 1, 2, 0, 'INCOMP#001', 4, 4)
    `).run();
    db.prepare(`
      INSERT INTO player_habits_stats (
        game_id, player_index, connect_code, character_id, is_complete, climb_count, climb_punished
      ) VALUES ('incomp_only', 0, 'INCOMP#001', 2, 0, 999, 999)
    `).run();

    const profile = analytics.getPlayerHabitsProfile('INCOMP#001');
    assert.strictEqual(profile.totalGames, 0);
    assert.strictEqual(profile.gamesAnalyzed, 0);
    assert.strictEqual(profile.totals.climb_count, 0);
    assert.strictEqual(profile.rates.climb_punish_rate, null);
  });

  // =========================================================================
  // 3. Query Filters With Edge Inputs & Robustness
  // =========================================================================
  console.log('\n--- 3. Testing Query Filters With Edge Inputs ---');

  await runAsyncTest('REST API handles URL-encoded connect codes with %23 and lowercase codes', async () => {
    const db = getDatabase('./analytics.db');
    const server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // Seed a complete match for 'SLIPPI#777' in ./analytics.db
      db.prepare(`
        INSERT INTO games (game_id, file_hash, start_at, duration_frames, duration_seconds, stage_id, game_mode, payload_path)
        VALUES ('game_enc_1', 'hash_enc_1', '2026-10-19T04:00:00Z', 3000, 50.0, 31, 2, 'payloads/enc1.json.gz')
        ON CONFLICT(game_id) DO UPDATE SET start_at = excluded.start_at
      `).run();
      db.prepare(`
        INSERT INTO game_players (game_id, player_index, port, character_id, costume_index, connect_code, start_stocks, end_stocks)
        VALUES ('game_enc_1', 0, 1, 2, 0, 'SLIPPI#777', 4, 1)
        ON CONFLICT(game_id, player_index) DO UPDATE SET connect_code = excluded.connect_code
      `).run();
      db.prepare(`
        INSERT INTO game_players (game_id, player_index, port, character_id, costume_index, connect_code, start_stocks, end_stocks)
        VALUES ('game_enc_1', 1, 2, 20, 0, 'RIVAL#888', 4, 0)
        ON CONFLICT(game_id, player_index) DO UPDATE SET connect_code = excluded.connect_code
      `).run();
      db.prepare(`
        INSERT INTO player_habits_stats (
          game_id, player_index, connect_code, character_id, is_complete, climb_count, attack_count
        ) VALUES ('game_enc_1', 0, 'SLIPPI#777', 2, 1, 12, 7)
        ON CONFLICT(game_id, player_index) DO UPDATE SET climb_count = 12
      `).run();

      // Test with %23 URL-encoded uppercase
      const res1 = await fetchJson(`${baseUrl}/api/players/SLIPPI%23777/habits`);
      assert.strictEqual(res1.status, 200);
      assert.strictEqual(res1.data.connectCode, 'SLIPPI#777');
      assert.strictEqual(res1.data.totalGames, 1);
      assert.strictEqual(res1.data.totals.climb_count, 12);

      // Test with lowercase + %23 URL-encoded: slippi%23777
      const res2 = await fetchJson(`${baseUrl}/api/players/slippi%23777/habits`);
      assert.strictEqual(res2.status, 200);
      assert.strictEqual(res2.data.connectCode, 'SLIPPI#777');
      assert.strictEqual(res2.data.totalGames, 1);
      assert.strictEqual(res2.data.totals.climb_count, 12);

      // Test with opponent filter containing %23
      const res3 = await fetchJson(`${baseUrl}/api/players/SLIPPI%23777/habits?opponentConnectCode=RIVAL%23888`);
      assert.strictEqual(res3.status, 200);
      assert.strictEqual(res3.data.totalGames, 1);

      // Test with opponent filter not matching
      const res4 = await fetchJson(`${baseUrl}/api/players/SLIPPI%23777/habits?opponentConnectCode=NOBODY%23000`);
      assert.strictEqual(res4.status, 200);
      assert.strictEqual(res4.data.totalGames, 0);
      assert.strictEqual(res4.data.totals.climb_count, 0);
    } finally {
      server.close();
      // Clean up seeded rows
      try {
        db.prepare("DELETE FROM games WHERE game_id = 'game_enc_1'").run();
      } catch (_) {}
    }
  });

  await runAsyncTest('REST API handles nonexistent players and zero-match filters gracefully without crashing', async () => {
    const server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // Nonexistent player code
      const resGhost = await fetchJson(`${baseUrl}/api/players/GHOST%23999/habits`);
      assert.strictEqual(resGhost.status, 200);
      assert.strictEqual(resGhost.data.totalGames, 0);
      assert.strictEqual(resGhost.data.totals.climb_count, 0);
      assert.strictEqual(resGhost.data.rates.climb_punish_rate, null);

      // Impossible filter combinations
      const resImpossible = await fetchJson(`${baseUrl}/api/players/GHOST%23999/habits?stageId=99999&characterId=88888&opponentCharacterId=77777`);
      assert.strictEqual(resImpossible.status, 200);
      assert.strictEqual(resImpossible.data.totalGames, 0);
      assert.strictEqual(resImpossible.data.totals.climb_count, 0);

      // Nonexistent game in GET /api/games/:id/habits returns 404
      const resGame404 = await fetchJson(`${baseUrl}/api/games/nonexistent_game_id/habits`);
      assert.strictEqual(resGame404.status, 404);
      assert.strictEqual(resGame404.data.error, 'Game not found');
    } finally {
      server.close();
    }
  });

  runTest('SQL injection strings in connectCode and filters are safely neutralized via parameterized queries', () => {
    const db = setupCleanDb();
    const analytics = new AnalyticsService(TEST_DB_PATH);

    // Injection attempt in connectCode
    const maliciousCode = "TARGET#001' OR '1'='1";
    const profile = analytics.getPlayerHabitsProfile(maliciousCode);
    assert.strictEqual(profile.totalGames, 0, 'Malicious SQL injection must not match any unescaped records');

    // Injection attempt in filters
    const profileFilters = analytics.getPlayerHabitsProfile('TARGET#001', {
      opponentConnectCode: "OPP#002' OR 1=1 --",
      stageId: "31; DROP TABLE games; --",
      characterId: "2; SELECT 1;",
    });
    assert.strictEqual(profileFilters.totalGames, 0);

    // Verify games table is still intact
    const gamesCount = db.prepare('SELECT COUNT(*) as count FROM games').get().count;
    assert.strictEqual(typeof gamesCount, 'number');
  });

  // =========================================================================
  // 4. Scope Isolation Verification
  // =========================================================================
  console.log('\n--- 4. Testing Scope Isolation ---');

  await runAsyncTest('Infrastructure telemetry endpoints NEVER leak player habit metrics under any condition', async () => {
    const db = getDatabase('./analytics.db');

    // Seed database with games, batches, and habit stats in ./analytics.db
    db.prepare(`
      INSERT INTO batch_runs (batch_id, run_name, lifecycle_state, batch_size, discovered_count, processed_count, storage_bytes)
      VALUES ('batch_scope_001', 'scope_run', 'completed', 10, 10, 10, 50000)
      ON CONFLICT(batch_id) DO UPDATE SET run_name = excluded.run_name
    `).run();

    db.prepare(`
      INSERT INTO games (game_id, file_hash, start_at, duration_frames, duration_seconds, stage_id, game_mode, payload_path)
      VALUES ('game_scope_001', 'hash_scope_001', '2026-10-19T05:00:00Z', 3600, 60.0, 31, 2, 'payloads/scope.json.gz')
      ON CONFLICT(game_id) DO UPDATE SET start_at = excluded.start_at
    `).run();

    db.prepare(`
      INSERT INTO player_habits_stats (
        game_id, player_index, connect_code, character_id, is_complete,
        climb_count, attack_count, ledgedash_count, tech_neutral_count, grabs_shield_pressure, neutral_resets, over_extensions
      ) VALUES (
        'game_scope_001', 0, 'SECRET#001', 2, 1,
        99, 88, 77, 66, 55, 44, 33
      )
      ON CONFLICT(game_id, player_index) DO UPDATE SET climb_count = 99
    `).run();

    const server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    const FORBIDDEN_METRIC_SUBSTRINGS = [
      'climb_count', 'climb_punished', 'attack_count', 'attack_punished',
      'roll_count', 'roll_punished', 'jump_count', 'jump_punished',
      'ledgedash_count', 'ledgedash_punished', 'tech_neutral_count',
      'tech_forward_count', 'tech_back_count', 'tech_miss_count',
      'wakeup_stand_count', 'wakeup_forward_count', 'wakeup_back_count',
      'wakeup_attack_count', 'grabs_shield_pressure', 'grabs_scramble',
      'grabs_neutral', 'neutral_resets', 'over_extensions',
      'oos_roll_count', 'oos_spotdodge_count', 'oos_grab_count',
      'oos_aerial_count', 'corner_drift_count', 'getupEvents',
      'grabTriggers', 'transitionDecisions', 'escapeSequences'
    ];

    function verifyNoHabitLeaks(rawText, endpointName) {
      for (const forbidden of FORBIDDEN_METRIC_SUBSTRINGS) {
        assert.ok(
          !rawText.includes(`"${forbidden}"`),
          `Scope isolation breach: forbidden metric key "${forbidden}" detected in ${endpointName}`
        );
      }
    }

    try {
      // 1. /api/pipeline/status
      const pipeRes = await fetchJson(`${baseUrl}/api/pipeline/status`);
      assert.strictEqual(pipeRes.status, 200);
      verifyNoHabitLeaks(pipeRes.raw, '/api/pipeline/status');

      // 2. /api/batches
      const batchesRes = await fetchJson(`${baseUrl}/api/batches`);
      assert.strictEqual(batchesRes.status, 200);
      verifyNoHabitLeaks(batchesRes.raw, '/api/batches');

      // 3. /api/batches/latest
      const latestBatchRes = await fetchJson(`${baseUrl}/api/batches/latest`);
      assert.strictEqual(latestBatchRes.status, 200);
      verifyNoHabitLeaks(latestBatchRes.raw, '/api/batches/latest');

      // 4. /api/storage/footprint
      const storageRes = await fetchJson(`${baseUrl}/api/storage/footprint`);
      assert.strictEqual(storageRes.status, 200);
      verifyNoHabitLeaks(storageRes.raw, '/api/storage/footprint');
    } finally {
      server.close();
      try {
        db.prepare("DELETE FROM games WHERE game_id = 'game_scope_001'").run();
        db.prepare("DELETE FROM batch_runs WHERE batch_id = 'batch_scope_001'").run();
      } catch (_) {}
    }
  });

  // =========================================================================
  // 5. Zero .slp Disk Accumulation On Errors
  // =========================================================================
  console.log('\n--- 5. Testing Zero .slp Disk Accumulation On Pipeline Failures ---');

  await runAsyncTest('BatchPipeline ensures temp_slp/ remains clean when download or parsing fails', async () => {
    const testTempDir = './test_challenger_temp_slp';
    if (fs.existsSync(testTempDir)) FileCleaner.cleanDirectory(testTempDir);
    else fs.mkdirSync(testTempDir, { recursive: true });

    const db = setupCleanDb();
    const repo = new ReplayRepository(TEST_DB_PATH);

    // Mock Lunar Melee Client that downloads corrupted files or fails
    const mockLunarClient = {
      async searchReplays() {
        return {
          replays: [
            { _id: 'fail_corrupt_slp', fileHash: 'hash_fail_corrupt', startAt: '2026-10-19T06:00:00Z', duration: 3000 },
            { _id: 'fail_download_error', fileHash: 'hash_fail_download', startAt: '2026-10-19T06:01:00Z', duration: 3000 },
          ]
        };
      },
      async downloadReplay(id, destPath) {
        if (id === 'fail_corrupt_slp') {
          // Write corrupted garbage bytes to simulate invalid Slippi header
          fs.writeFileSync(destPath, Buffer.from('NOT_A_VALID_SLIPPI_FILE_GARBAGE_BYTES_1234567890'));
        } else if (id === 'fail_download_error') {
          // Simulate partial download followed by network disconnect
          fs.writeFileSync(destPath, Buffer.from('PARTIAL_DOWNLOAD_BYTES'));
          throw new Error('Simulated network disconnect during download');
        }
      }
    };

    // Frame consumer mock that throws on corrupt header
    const mockFrameConsumer = {
      processReplay(filePath) {
        const bytes = fs.readFileSync(filePath);
        if (bytes.toString('utf8').includes('NOT_A_VALID_SLIPPI_FILE')) {
          throw new Error('Slippi parser error: invalid header');
        }
        return { success: true };
      }
    };

    const pipeline = new BatchPipeline({
      lunarClient: mockLunarClient,
      frameConsumer: mockFrameConsumer,
      repository: repo,
      tempDir: testTempDir,
    });

    // Execute the batch; pipeline must catch individual failures and proceed
    const batchResult = await pipeline.runSingleBatch({
      runName: 'error_resilience_test',
      batchSize: 2,
    });

    assert.strictEqual(batchResult.success, true);
    assert.strictEqual(batchResult.failed, 2, 'Both corrupt replays must be recorded as failed');

    // VERIFY ZERO ACCUMULATION IN TEMP DIRECTORY
    const remainingFiles = fs.readdirSync(testTempDir).filter(f => f.endsWith('.slp'));
    assert.strictEqual(
      remainingFiles.length,
      0,
      `Zero .slp accumulation invariant violated! Found ${remainingFiles.length} leftover files in ${testTempDir}`
    );

    // Verify replay_status recorded failures in DB
    const statusRow1 = db.prepare('SELECT * FROM replay_status WHERE replay_id = ?').get('fail_corrupt_slp');
    assert.ok(statusRow1);
    assert.strictEqual(statusRow1.status, 'FAILED_CORRUPT');

    const statusRow2 = db.prepare('SELECT * FROM replay_status WHERE replay_id = ?').get('fail_download_error');
    assert.ok(statusRow2);
    assert.strictEqual(statusRow2.status, 'FAILED_CORRUPT');

    // Clean up test temp dir
    FileCleaner.cleanDirectory(testTempDir);
    fs.rmdirSync(testTempDir);
  });

  // =========================================================================
  // 6. Additional Hostile Edge Cases & Concurrency / Resilience
  // =========================================================================
  console.log('\n--- 6. Additional Adversarial Edge Cases ---');

  runTest('Legacy games without habits data return empty players list gracefully', () => {
    const db = setupCleanDb();
    const analytics = new AnalyticsService(TEST_DB_PATH);

    // Insert legacy game with no player_habits_stats
    db.prepare(`
      INSERT INTO games (game_id, file_hash, start_at, duration_frames, duration_seconds, stage_id, game_mode, payload_path)
      VALUES ('legacy_game_001', 'legacy_hash_001', '2020-01-01T00:00:00Z', 3000, 50.0, 31, 2, 'payloads/missing.json.gz')
    `).run();

    const habits = analytics.getGameHabits('legacy_game_001');
    assert.ok(habits);
    assert.strictEqual(habits.gameId, 'legacy_game_001');
    assert.strictEqual(Array.isArray(habits.players), true);
    assert.strictEqual(habits.players.length, 0);
  });

  runTest('Missing or corrupted payload path in getGameHabits does not throw', () => {
    const db = setupCleanDb();
    const analytics = new AnalyticsService(TEST_DB_PATH);

    db.prepare(`
      INSERT INTO games (game_id, file_hash, start_at, duration_frames, duration_seconds, stage_id, game_mode, payload_path)
      VALUES ('corrupt_payload_game', 'hash_corrupt_payload', '2026-10-19T07:00:00Z', 3000, 50.0, 31, 2, 'nonexistent/path/never_created.json.gz')
    `).run();

    db.prepare(`
      INSERT INTO player_habits_stats (
        game_id, player_index, connect_code, character_id, is_complete, climb_count
      ) VALUES ('corrupt_payload_game', 0, 'PLAYER#001', 2, 1, 5)
    `).run();

    const habits = analytics.getGameHabits('corrupt_payload_game');
    assert.ok(habits);
    assert.strictEqual(habits.players.length, 1);
    assert.strictEqual(habits.players[0].events.getupEvents.length, 0);
  });

  runTest('Transaction atomicity: Error during saveProcessedGame rolls back all tables cleanly', () => {
    const db = setupCleanDb();
    const repo = new ReplayRepository(TEST_DB_PATH);

    const badGameRecord = {
      gameId: 'atomic_rollback_game',
      fileHash: 'atomic_rollback_hash',
      startAt: '2026-10-19T08:00:00Z',
      durationFrames: 2500,
      durationSeconds: 41.6,
      stageId: 31,
      gameMode: 2,
      payloadPath: 'payloads/atomic.json.gz',
    };
    const validPlayers = [
      { playerIndex: 0, port: 1, characterId: 2, connectCode: 'ROLL#001' },
    ];
    // Malformed habits that causes constraint violation (characterId NULL violates NOT NULL)
    const malformedHabits = [
      { playerIndex: 0, characterId: null, connectCode: 'ROLL#001', isComplete: 1 }
    ];

    assert.throws(() => {
      repo.saveProcessedGame(badGameRecord, validPlayers, [], [], malformedHabits);
    }, /NOT NULL|constraint/i);

    // Verify rollback: games table must NOT contain the game
    const gameRow = db.prepare('SELECT * FROM games WHERE game_id = ?').get('atomic_rollback_game');
    assert.strictEqual(gameRow, undefined, 'Rollback must prevent game from persisting');

    const playerRows = db.prepare('SELECT * FROM game_players WHERE game_id = ?').all('atomic_rollback_game');
    assert.strictEqual(playerRows.length, 0, 'Rollback must prevent players from persisting');
  });

  runTest('Division by zero safety: all 17 punish rates return null when counters are zero', () => {
    const db = setupCleanDb();
    const analytics = new AnalyticsService(TEST_DB_PATH);

    // Insert game where player did zero actions
    db.prepare(`
      INSERT INTO games (game_id, file_hash, start_at, duration_frames, duration_seconds, stage_id, game_mode, payload_path)
      VALUES ('zero_game', 'zero_hash', '2026-10-19T09:00:00Z', 3600, 60.0, 31, 2, 'payloads/zero.json.gz')
    `).run();
    db.prepare(`
      INSERT INTO game_players (game_id, player_index, port, character_id, costume_index, connect_code, start_stocks, end_stocks)
      VALUES ('zero_game', 0, 1, 2, 0, 'ZERO#001', 4, 4)
    `).run();
    db.prepare(`
      INSERT INTO player_habits_stats (
        game_id, player_index, connect_code, character_id, is_complete
      ) VALUES ('zero_game', 0, 'ZERO#001', 2, 1)
    `).run();

    const profile = analytics.getPlayerHabitsProfile('ZERO#001');
    assert.strictEqual(profile.totalGames, 1);

    const expectedRateKeys = [
      'climb_punish_rate', 'attack_punish_rate', 'roll_punish_rate',
      'jump_punish_rate', 'ledgedash_punish_rate', 'tech_neutral_punish_rate',
      'tech_forward_punish_rate', 'tech_back_punish_rate', 'tech_miss_punish_rate',
      'wakeup_stand_punish_rate', 'wakeup_forward_punish_rate', 'wakeup_back_punish_rate',
      'wakeup_attack_punish_rate', 'oos_roll_punish_rate', 'oos_spotdodge_punish_rate',
      'oos_grab_punish_rate', 'oos_aerial_punish_rate'
    ];

    for (const k of expectedRateKeys) {
      assert.strictEqual(profile.rates[k], null, `Rate '${k}' must be null (not NaN or zero division)`);
    }
  });

  console.log('\n======================================================================');
  console.log(`CHALLENGER 2 SUMMARY: ${passedTests} Passed, 0 Failed out of ${totalTests} Tests`);
  console.log('======================================================================\n');
}

runChallenger2StressSuite()
  .then(() => {
    cleanupDb();
    process.exit(0);
  })
  .catch(err => {
    cleanupDb();
    console.error('Stress test failed:', err);
    process.exit(1);
  });
