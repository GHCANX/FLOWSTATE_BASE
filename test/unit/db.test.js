import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getDatabase, closeDatabase } from '../../src/database/db.js';

const TEST_DB_PATH = path.resolve('./test_db_unit.db');

describe('Database Unit', () => {
  let db;

  beforeEach(() => {
    closeDatabase();
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    if (fs.existsSync(`${TEST_DB_PATH}-wal`)) fs.unlinkSync(`${TEST_DB_PATH}-wal`);
    if (fs.existsSync(`${TEST_DB_PATH}-shm`)) fs.unlinkSync(`${TEST_DB_PATH}-shm`);

    db = getDatabase(TEST_DB_PATH);
  });

  afterEach(() => {
    closeDatabase();
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    if (fs.existsSync(`${TEST_DB_PATH}-wal`)) fs.unlinkSync(`${TEST_DB_PATH}-wal`);
    if (fs.existsSync(`${TEST_DB_PATH}-shm`)) fs.unlinkSync(`${TEST_DB_PATH}-shm`);
  });

  it('safely swallows exceptions during closeDatabase and nullifies instance', () => {
    const originalClose = db.close.bind(db);
    db.close = () => {
      throw new Error('Simulated close error');
    };

    assert.doesNotThrow(() => {
      closeDatabase();
    });

    const newDb = getDatabase(TEST_DB_PATH);
    assert.notStrictEqual(newDb, db);

    originalClose();
  });
});
