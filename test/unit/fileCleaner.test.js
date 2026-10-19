import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FileCleaner } from '../../src/orchestrator/fileCleaner.js';

const TEST_DIR = path.resolve('./test_cleaner_temp');

describe('FileCleaner', () => {
  beforeEach(() => {
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('deletes an existing file and returns true', () => {
    const testFile = path.join(TEST_DIR, 'test1.txt');
    fs.writeFileSync(testFile, 'hello');
    assert.ok(fs.existsSync(testFile));

    const result = FileCleaner.deleteFile(testFile);
    assert.strictEqual(result, true);
    assert.strictEqual(fs.existsSync(testFile), false);
  });

  it('returns false when deleting a non-existent file', () => {
    const testFile = path.join(TEST_DIR, 'does_not_exist.txt');
    const result = FileCleaner.deleteFile(testFile);
    assert.strictEqual(result, false);
  });

  it('purges an array of files and returns accurate count', () => {
    const f1 = path.join(TEST_DIR, 'batch1.txt');
    const f2 = path.join(TEST_DIR, 'batch2.txt');
    const f3 = path.join(TEST_DIR, 'batch3.txt');
    const fMissing = path.join(TEST_DIR, 'missing.txt');

    fs.writeFileSync(f1, '1');
    fs.writeFileSync(f2, '2');
    fs.writeFileSync(f3, '3');

    const purgedCount = FileCleaner.purgeBatch([f1, f2, f3, fMissing]);
    assert.strictEqual(purgedCount, 3);
    assert.strictEqual(fs.existsSync(f1), false);
    assert.strictEqual(fs.existsSync(f2), false);
    assert.strictEqual(fs.existsSync(f3), false);
  });

  it('cleans all files in a directory', () => {
    const f1 = path.join(TEST_DIR, 'a.slp');
    const f2 = path.join(TEST_DIR, 'b.slp');
    fs.writeFileSync(f1, 'slp1');
    fs.writeFileSync(f2, 'slp2');

    FileCleaner.cleanDirectory(TEST_DIR);
    assert.strictEqual(fs.readdirSync(TEST_DIR).length, 0);
  });

  it('handles cleanDirectory on non-existent directory without error', () => {
    const fakeDir = path.join(TEST_DIR, 'non_existent_subdir');
    assert.doesNotThrow(() => {
      FileCleaner.cleanDirectory(fakeDir);
    });
  });
});
