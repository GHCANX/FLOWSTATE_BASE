import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PayloadBuilder } from '../../src/analysis/payloadBuilder.js';

const TEST_PAYLOAD_DIR = path.resolve('./test_payload_unit');

describe('PayloadBuilder', () => {
  beforeEach(() => {
    if (!fs.existsSync(TEST_PAYLOAD_DIR)) {
      fs.mkdirSync(TEST_PAYLOAD_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(TEST_PAYLOAD_DIR)) {
      fs.rmSync(TEST_PAYLOAD_DIR, { recursive: true, force: true });
    }
  });

  it('saves and compresses payload with date-sharded YYYY/MM directory', () => {
    const builder = new PayloadBuilder(TEST_PAYLOAD_DIR);
    const data = {
      gameId: 'game_2023_05_01',
      startAt: '2023-05-14T15:30:00Z',
      stageId: 31,
      stocks: [{ playerIndex: 0, frame: 120 }],
    };

    const savedRelPath = builder.savePayload(data);
    assert.ok(savedRelPath.includes('2023'));
    assert.ok(savedRelPath.includes('05'));
    assert.ok(savedRelPath.endsWith('game_2023_05_01.json.gz'));
    assert.ok(fs.existsSync(savedRelPath));

    // Verify decompression and equality
    const loaded = builder.loadPayload(savedRelPath);
    assert.strictEqual(loaded.gameId, 'game_2023_05_01');
    assert.strictEqual(loaded.stageId, 31);
    assert.deepStrictEqual(loaded.stocks, data.stocks);
  });

  it('falls back to 2018/01 when startAt is missing or invalid', () => {
    const builder = new PayloadBuilder(TEST_PAYLOAD_DIR);
    const dataMissing = { gameId: 'game_no_date', stageId: 2 };
    const rel1 = builder.savePayload(dataMissing);
    assert.ok(rel1.includes('2018'));
    assert.ok(rel1.includes('01'));

    const dataInvalid = { gameId: 'game_bad_date', startAt: 'not-a-valid-date', stageId: 2 };
    const rel2 = builder.savePayload(dataInvalid);
    assert.ok(rel2.includes('2018'));
    assert.ok(rel2.includes('01'));
  });

  it('throws when loading a non-existent payload file', () => {
    const builder = new PayloadBuilder(TEST_PAYLOAD_DIR);
    assert.throws(
      () => builder.loadPayload(path.join(TEST_PAYLOAD_DIR, 'non_existent.json.gz')),
      /Payload file not found/
    );
  });
});
