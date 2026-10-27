import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getDatabase, closeDatabase } from '../../src/database/db.js';
import { ReplayRepository } from '../../src/database/repository.js';

const TEST_DB_PATH = path.resolve('./test_db_integration.db');

function createFullMechanics(playerIndex, overrides = {}) {
  return {
    playerIndex,
    lCancelSuccess: 0,
    lCancelFail: 0,
    lCancelRate: 0,
    wavedashCount: 0,
    wavelandCount: 0,
    dashDanceTurns: 0,
    dashDanceStrings: 0,
    edgeCancels: 0,
    ledgeGrabs: 0,
    ledgedashCount: 0,
    avgGalintFrames: 0,
    shieldDrops: 0,
    crouchCancels: 0,
    amsahTechs: 0,
    vCancels: 0,
    slideOffs: 0,
    powershieldsPhysical: 0,
    powershieldsProjectile: 0,
    oosGrabs: 0,
    oosAerials: 0,
    oosSmashes: 0,
    oosWavedashes: 0,
    oosRolls: 0,
    oosSpotdodges: 0,
    techNeutral: 0,
    techIn: 0,
    techAway: 0,
    techMiss: 0,
    wallTechSuccess: 0,
    wallTechMiss: 0,
    sdiInputs: 0,
    phantomHits: 0,
    floatCancels: 0,
    jcGrabs: 0,
    boostGrabs: 0,
    multishines: 0,
    ...overrides,
  };
}

describe('Database & Repository Integration', () => {
  let repo;
  let db;

  beforeEach(() => {
    closeDatabase();
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    if (fs.existsSync(`${TEST_DB_PATH}-wal`)) fs.unlinkSync(`${TEST_DB_PATH}-wal`);
    if (fs.existsSync(`${TEST_DB_PATH}-shm`)) fs.unlinkSync(`${TEST_DB_PATH}-shm`);

    db = getDatabase(TEST_DB_PATH);
    repo = new ReplayRepository(TEST_DB_PATH);
  });

  afterEach(() => {
    closeDatabase();
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    if (fs.existsSync(`${TEST_DB_PATH}-wal`)) fs.unlinkSync(`${TEST_DB_PATH}-wal`);
    if (fs.existsSync(`${TEST_DB_PATH}-shm`)) fs.unlinkSync(`${TEST_DB_PATH}-shm`);
  });

  it('enforces SQLite WAL mode and foreign key constraints', () => {
    const journalMode = db.prepare('PRAGMA journal_mode;').get();
    assert.strictEqual(journalMode.journal_mode.toLowerCase(), 'wal');

    const foreignKeys = db.prepare('PRAGMA foreign_keys;').get();
    assert.strictEqual(foreignKeys.foreign_keys, 1);
  });

  it('records status and checks processed state', () => {
    assert.strictEqual(Boolean(repo.isProcessed('replay_001')), false);

    repo.recordStatus('replay_001', 'hash_001', 'local', 'COMPLETED');
    assert.strictEqual(Boolean(repo.isProcessed('replay_001')), true);
    assert.strictEqual(Boolean(repo.isProcessed('other', 'hash_001')), true);

    repo.recordStatus('replay_002', 'hash_002', 'local', 'FAILED_CORRUPT', 'Header broken');
    assert.strictEqual(Boolean(repo.isProcessed('replay_002')), false);
  });

  it('saves full game and child entities atomically', () => {
    const game = {
      gameId: 'test_game_1',
      fileHash: 'hash_test_1',
      startAt: '2023-01-01T12:00:00Z',
      durationFrames: 3600,
      durationSeconds: 60.0,
      stageId: 31,
      gameMode: 2,
      isTeams: false,
      winnerPort: 1,
      payloadPath: 'test_payloads/2023/01/test_game_1.json.gz',
    };

    const players = [
      { playerIndex: 0, port: 1, characterId: 2, connectCode: 'P1#001', isWinner: true },
      { playerIndex: 1, port: 2, characterId: 20, connectCode: 'P2#002', isWinner: false },
    ];

    const overall = [
      {
        playerIndex: 0,
        inputsTotal: 500,
        ipm: 300,
        digitalIpm: 250,
        neutralWinRatio: 0.6,
        counterHitRatio: 0.1,
        beneficialTradeRatio: 0.2,
        openingsPerKill: 2.5,
        damagePerOpening: 25.0,
        totalDamageDealt: 120,
        killCount: 4,
        conversionCount: 3,
      },
      {
        playerIndex: 1,
        inputsTotal: 400,
        ipm: 250,
        digitalIpm: 200,
        neutralWinRatio: 0.4,
        counterHitRatio: 0.2,
        beneficialTradeRatio: 0.1,
        openingsPerKill: 4.0,
        damagePerOpening: 20.0,
        totalDamageDealt: 80,
        killCount: 1,
        conversionCount: 1,
      },
    ];

    const mechanics = [
      createFullMechanics(0, { lCancelSuccess: 10, lCancelFail: 2, lCancelRate: 83.3, wavedashCount: 5 }),
      createFullMechanics(1, { lCancelSuccess: 8, lCancelFail: 4, lCancelRate: 66.7, wavedashCount: 3 }),
    ];

    const habits = [
      { playerIndex: 0, connectCode: 'P1#001', characterId: 2, climb_count: 3, climb_punished: 1 },
      { playerIndex: 1, connectCode: 'P2#002', characterId: 20, climb_count: 4, climb_punished: 2 },
    ];

    const success = repo.saveProcessedGame(game, players, overall, mechanics, habits);
    assert.strictEqual(success, true);
    assert.strictEqual(Boolean(repo.isProcessed('test_game_1')), true);

    // Verify row counts
    const gameRow = db.prepare('SELECT * FROM games WHERE game_id = ?').get('test_game_1');
    assert.strictEqual(gameRow.stage_id, 31);

    const playerRows = db.prepare('SELECT * FROM game_players WHERE game_id = ?').all('test_game_1');
    assert.strictEqual(playerRows.length, 2);

    const habitsRows = db.prepare('SELECT * FROM player_habits_stats WHERE game_id = ?').all('test_game_1');
    assert.strictEqual(habitsRows.length, 2);
  });

  it('cascades deletion from games table to all child stats tables', () => {
    const game = {
      gameId: 'cascade_game',
      fileHash: 'cascade_hash',
      startAt: '2023-01-01T12:00:00Z',
      durationFrames: 1000,
      durationSeconds: 16.6,
      stageId: 31,
      gameMode: 2,
      payloadPath: 'payload.json.gz',
    };
    const players = [{ playerIndex: 0, port: 1, characterId: 2 }];
    const overall = [{
      playerIndex: 0,
      inputsTotal: 100,
      ipm: 200,
      digitalIpm: 150,
      neutralWinRatio: 0.5,
      counterHitRatio: 0.1,
      beneficialTradeRatio: 0.1,
      openingsPerKill: 2.0,
      damagePerOpening: 25.0,
      totalDamageDealt: 50,
      killCount: 0,
      conversionCount: 0,
    }];
    const mechanics = [createFullMechanics(0, { lCancelSuccess: 1, lCancelRate: 100 })];
    const habits = [{ playerIndex: 0, characterId: 2, climb_count: 1 }];

    repo.saveProcessedGame(game, players, overall, mechanics, habits);

    // Delete parent game
    db.prepare('DELETE FROM games WHERE game_id = ?').run('cascade_game');

    // Assert children are wiped
    const pCount = db.prepare('SELECT COUNT(*) as c FROM game_players WHERE game_id = ?').get('cascade_game').c;
    const oCount = db.prepare('SELECT COUNT(*) as c FROM player_overall_stats WHERE game_id = ?').get('cascade_game').c;
    const mCount = db.prepare('SELECT COUNT(*) as c FROM player_mechanics_stats WHERE game_id = ?').get('cascade_game').c;
    const hCount = db.prepare('SELECT COUNT(*) as c FROM player_habits_stats WHERE game_id = ?').get('cascade_game').c;

    assert.strictEqual(pCount, 0);
    assert.strictEqual(oCount, 0);
    assert.strictEqual(mCount, 0);
    assert.strictEqual(hCount, 0);
  });

  it('rolls back atomic transaction completely if any insert fails', () => {
    const game = {
      gameId: 'fail_game',
      fileHash: 'fail_hash',
      startAt: '2023-01-01T12:00:00Z',
      durationFrames: 1000,
      durationSeconds: 16.6,
      stageId: 31,
      gameMode: 2,
      payloadPath: 'payload.json.gz',
    };
    const players = [{ playerIndex: 0, port: 1, characterId: 2 }];
    // Broken overall stats to cause an insert failure (missing required columns)
    const overall = [{ playerIndex: null }];

    assert.throws(() => {
      repo.saveProcessedGame(game, players, overall, [], []);
    });

    // Parent game must NOT exist
    const row = db.prepare('SELECT * FROM games WHERE game_id = ?').get('fail_game');
    assert.strictEqual(row, undefined);
  });

  it('manages batch runs lifecycle states and counters', () => {
    const batch = repo.createBatchRun({
      batchId: 'batch_001',
      runName: 'test_run',
      filterCriteria: { minDuration: 60 },
      batchSize: 50,
      lifecycleState: 'queued',
    });

    assert.strictEqual(batch.batch_id, 'batch_001');
    assert.strictEqual(batch.lifecycle_state, 'queued');

    const updated = repo.updateBatchRun('batch_001', {
      lifecycleState: 'completed',
      downloadedCount: 10,
      processedCount: 9,
      failedCount: 1,
      throughputRpm: 18.5,
    });

    assert.strictEqual(updated.lifecycle_state, 'completed');
    assert.strictEqual(updated.processed_count, 9);
    assert.strictEqual(updated.throughput_rpm, 18.5);

    const latest = repo.getLatestBatchRun();
    assert.strictEqual(latest.batch_id, 'batch_001');

    const list = repo.getBatchRuns(10);
    assert.strictEqual(list.length, 1);
  });

  it('manages sliding-window checkpoints', () => {
    const cp = repo.getOrInitCheckpoint('lunar_run', 2019);
    assert.strictEqual(cp.current_year, 2019);
    assert.strictEqual(cp.current_page, 1);
    assert.strictEqual(cp.total_processed, 0);

    repo.updateProgress(cp.id, '2019-02-01T00:00:00Z', 2, 'last_rep_1', 10, 8, 2);

    const cpUpdated = repo.getOrInitCheckpoint('lunar_run');
    assert.strictEqual(cpUpdated.current_page, 2);
    assert.strictEqual(cpUpdated.total_downloaded, 10);
    assert.strictEqual(cpUpdated.total_processed, 8);
    assert.strictEqual(cpUpdated.total_failed, 2);
    assert.strictEqual(cpUpdated.last_processed_replay_id, 'last_rep_1');
  });
});
