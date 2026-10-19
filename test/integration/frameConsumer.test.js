import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FrameConsumer } from '../../src/analysis/frameConsumer.js';
import { PayloadBuilder } from '../../src/analysis/payloadBuilder.js';
import { ReplayRepository } from '../../src/database/repository.js';
import { getDatabase, closeDatabase } from '../../src/database/db.js';

const TEST_DB = path.resolve('./test_fc_db.db');
const TEST_PAYLOADS = path.resolve('./test_fc_payloads');
const REAL_SLP = path.resolve('external/slippi-js-master/slp/unranked_game1.slp');
const CORRUPT_SLP = path.resolve('./test_fc_corrupt.slp');

describe('FrameConsumer Integration', () => {
  let repository;
  let payloadBuilder;
  let consumer;

  beforeEach(() => {
    closeDatabase();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    if (fs.existsSync(`${TEST_DB}-wal`)) fs.unlinkSync(`${TEST_DB}-wal`);
    if (fs.existsSync(`${TEST_DB}-shm`)) fs.unlinkSync(`${TEST_DB}-shm`);
    if (fs.existsSync(TEST_PAYLOADS)) fs.rmSync(TEST_PAYLOADS, { recursive: true, force: true });
    if (fs.existsSync(CORRUPT_SLP)) fs.unlinkSync(CORRUPT_SLP);

    fs.mkdirSync(TEST_PAYLOADS, { recursive: true });
    getDatabase(TEST_DB);
    repository = new ReplayRepository(TEST_DB);
    payloadBuilder = new PayloadBuilder(TEST_PAYLOADS);
    consumer = new FrameConsumer({ payloadBuilder, repository });
  });

  afterEach(() => {
    closeDatabase();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    if (fs.existsSync(`${TEST_DB}-wal`)) fs.unlinkSync(`${TEST_DB}-wal`);
    if (fs.existsSync(`${TEST_DB}-shm`)) fs.unlinkSync(`${TEST_DB}-shm`);
    if (fs.existsSync(TEST_PAYLOADS)) fs.rmSync(TEST_PAYLOADS, { recursive: true, force: true });
    if (fs.existsSync(CORRUPT_SLP)) fs.unlinkSync(CORRUPT_SLP);
  });

  it('processes a real .slp replay and writes to dual storage', () => {
    assert.ok(fs.existsSync(REAL_SLP), 'Test replay unranked_game1.slp must exist');

    const result = consumer.processReplay(REAL_SLP, {
      replayId: 'real_game_001',
      source: 'local_test',
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.gameId, 'real_game_001');
    assert.ok(result.payloadPath);
    assert.ok(fs.existsSync(result.payloadPath));

    // Verify payload contents
    const payload = payloadBuilder.loadPayload(result.payloadPath);
    assert.strictEqual(payload.gameId, 'real_game_001');
    assert.strictEqual(payload.stageId, 31); // Battlefield
    assert.strictEqual(payload.players.length, 2);
    assert.ok(payload.habits);

    // Verify database record
    assert.strictEqual(Boolean(repository.isProcessed('real_game_001')), true);
  });

  it('deduplicates already-processed replays without reprocessing', () => {
    // Process first time
    const res1 = consumer.processReplay(REAL_SLP, { replayId: 'dedup_game' });
    assert.strictEqual(res1.success, true);

    // Process second time with same replay ID
    const res2 = consumer.processReplay(REAL_SLP, { replayId: 'dedup_game' });
    assert.strictEqual(res2.skipped, true);
    assert.strictEqual(res2.reason, 'ALREADY_PROCESSED');
  });

  it('handles corrupt replay files and records FAILED_CORRUPT in audit table', () => {
    // Write 256 bytes of garbage
    fs.writeFileSync(CORRUPT_SLP, Buffer.from('NOT_A_VALID_SLIPPI_UBJSON_FILE'));

    assert.throws(
      () => consumer.processReplay(CORRUPT_SLP, { replayId: 'corrupt_001' }),
      /Error|header|file/i
    );

    // Check database replay_status
    const db = getDatabase(TEST_DB);
    const row = db.prepare('SELECT * FROM replay_status WHERE replay_id = ?').get('corrupt_001');
    assert.ok(row);
    assert.strictEqual(row.status, 'FAILED_CORRUPT');
  });

  it('throws error when file does not exist', () => {
    assert.throws(
      () => consumer.processReplay('non_existent_file.slp'),
      /File does not exist/
    );
  });
});
