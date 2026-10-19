import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { BatchPipeline } from '../../src/orchestrator/batchPipeline.js';
import { FrameConsumer } from '../../src/analysis/frameConsumer.js';
import { PayloadBuilder } from '../../src/analysis/payloadBuilder.js';
import { ReplayRepository } from '../../src/database/repository.js';
import { getDatabase, closeDatabase } from '../../src/database/db.js';

const TEST_DB = path.resolve('./test_bp_db.db');
const TEST_PAYLOADS = path.resolve('./test_bp_payloads');
const TEST_TEMP = path.resolve('./test_bp_temp');
const REAL_SLP = path.resolve('external/slippi-js-master/slp/unranked_game1.slp');

describe('BatchPipeline Integration', () => {
  let repository;
  let payloadBuilder;
  let frameConsumer;

  beforeEach(() => {
    closeDatabase();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    if (fs.existsSync(`${TEST_DB}-wal`)) fs.unlinkSync(`${TEST_DB}-wal`);
    if (fs.existsSync(`${TEST_DB}-shm`)) fs.unlinkSync(`${TEST_DB}-shm`);
    if (fs.existsSync(TEST_PAYLOADS)) fs.rmSync(TEST_PAYLOADS, { recursive: true, force: true });
    if (fs.existsSync(TEST_TEMP)) fs.rmSync(TEST_TEMP, { recursive: true, force: true });

    fs.mkdirSync(TEST_PAYLOADS, { recursive: true });
    fs.mkdirSync(TEST_TEMP, { recursive: true });

    getDatabase(TEST_DB);
    repository = new ReplayRepository(TEST_DB);
    payloadBuilder = new PayloadBuilder(TEST_PAYLOADS);
    frameConsumer = new FrameConsumer({ payloadBuilder, repository });
  });

  afterEach(() => {
    closeDatabase();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    if (fs.existsSync(`${TEST_DB}-wal`)) fs.unlinkSync(`${TEST_DB}-wal`);
    if (fs.existsSync(`${TEST_DB}-shm`)) fs.unlinkSync(`${TEST_DB}-shm`);
    if (fs.existsSync(TEST_PAYLOADS)) fs.rmSync(TEST_PAYLOADS, { recursive: true, force: true });
    if (fs.existsSync(TEST_TEMP)) fs.rmSync(TEST_TEMP, { recursive: true, force: true });
  });

  it('runs full batch lifecycle across canonical stages with zero disk accumulation', async () => {
    const lifecycleEvents = [];

    // Mock Lunar Client that copies real SLP replay
    const mockLunarClient = {
      searchReplays: async () => ({
        replays: [
          {
            _id: 'lunar_replay_001',
            fileHash: 'hash_001',
            startAt: '2023-01-01T00:00:00Z',
            duration: 3600,
          },
        ],
      }),
      downloadReplay: async (_id, dest) => {
        fs.copyFileSync(REAL_SLP, dest);
        return dest;
      },
    };

    const pipeline = new BatchPipeline({
      lunarClient: mockLunarClient,
      frameConsumer,
      repository,
      tempDir: TEST_TEMP,
    });

    const result = await pipeline.runSingleBatch({
      runName: 'test_lifecycle_run',
      batchSize: 10,
      onProgress: (p) => {
        if (p.type === 'LIFECYCLE') {
          lifecycleEvents.push(p.stage);
        }
      },
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.processed, 1);
    assert.strictEqual(result.skipped, 0);
    assert.strictEqual(result.failed, 0);

    // Verify lifecycle progression
    assert.ok(lifecycleEvents.includes('queued'));
    assert.ok(lifecycleEvents.includes('ingesting'));
    assert.ok(lifecycleEvents.includes('parsing'));
    assert.ok(lifecycleEvents.includes('caching'));
    assert.ok(lifecycleEvents.includes('completed'));

    // Zero disk accumulation invariant: temp directory must have 0 .slp files
    const remainingTempFiles = fs.readdirSync(TEST_TEMP);
    assert.strictEqual(remainingTempFiles.length, 0);

    // Verify batch run persisted in SQLite
    const batchRecord = repository.getBatchRun(result.batchId);
    assert.strictEqual(batchRecord.lifecycle_state, 'completed');
    assert.strictEqual(batchRecord.processed_count, 1);
  });

  it('skips warmup replays shorter than minDuration filter', async () => {
    const mockLunarClient = {
      searchReplays: async () => ({
        replays: [
          {
            _id: 'short_warmup',
            fileHash: 'short_hash',
            startAt: '2023-01-01T00:00:00Z',
            duration: 1200, // 20s < 60s
          },
        ],
      }),
      downloadReplay: async () => {
        throw new Error('Should not download skipped replay');
      },
    };

    const pipeline = new BatchPipeline({
      lunarClient: mockLunarClient,
      frameConsumer,
      repository,
      tempDir: TEST_TEMP,
    });

    const result = await pipeline.runSingleBatch({
      runName: 'warmup_test',
      filters: { minDuration: '60' }, // 60s min
    });

    assert.strictEqual(result.processed, 0);
    assert.strictEqual(result.skipped, 1);
    assert.strictEqual(fs.readdirSync(TEST_TEMP).length, 0);
  });

  it('handles corrupt replay gracefully without crashing the batch', async () => {
    const mockLunarClient = {
      searchReplays: async () => ({
        replays: [
          { _id: 'bad_replay', fileHash: 'bad_hash', startAt: '2023-01-01T00:00:00Z', duration: 3000 },
          { _id: 'good_replay', fileHash: 'good_hash', startAt: '2023-01-01T00:01:00Z', duration: 3000 },
        ],
      }),
      downloadReplay: async (id, dest) => {
        if (id === 'bad_replay') {
          fs.writeFileSync(dest, Buffer.from('CORRUPT_BYTES'));
        } else {
          fs.copyFileSync(REAL_SLP, dest);
        }
        return dest;
      },
    };

    const pipeline = new BatchPipeline({
      lunarClient: mockLunarClient,
      frameConsumer,
      repository,
      tempDir: TEST_TEMP,
    });

    const result = await pipeline.runSingleBatch({ runName: 'fault_tolerance_test' });

    assert.strictEqual(result.processed, 1);
    assert.strictEqual(result.failed, 1);
    assert.strictEqual(result.batchSize, 2);

    // Verify temp directory purged
    assert.strictEqual(fs.readdirSync(TEST_TEMP).length, 0);

    // Verify audit record for bad replay
    const status = repository.stmts.checkProcessed.get('bad_replay', 'bad_hash');
    assert.strictEqual(status.status, 'FAILED_CORRUPT');
  });
});
