import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let globalDbInstance = null;

/**
 * Open or retrieve the SQLite database connection with WAL mode and foreign keys enabled.
 * @param {string} dbPath 
 * @returns {DatabaseSync}
 */
export function getDatabase(dbPath = './analytics.db') {
  if (globalDbInstance && globalDbInstance.__path === dbPath) {
    return globalDbInstance;
  }

  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.__path = dbPath;

  // Performance optimizations for high-throughput batching
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA cache_size = -64000;');
  db.exec('PRAGMA temp_store = MEMORY;');
  db.exec('PRAGMA foreign_keys = ON;');

  // Apply schema
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schemaSql);

  globalDbInstance = db;
  return db;
}

/**
 * Close database connection
 */
export function closeDatabase() {
  if (globalDbInstance) {
    try {
      globalDbInstance.close();
    } catch (_) {}
    globalDbInstance = null;
  }
}
