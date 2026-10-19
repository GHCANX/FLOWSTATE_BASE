import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { CHARACTER_NAMES } from '../constants/characters.js';
import { getDatabase, closeDatabase } from '../database/db.js';
import { getStageName } from '../constants/stageGeometry.js';
import { AnalyticsService } from '../query/analyticsService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UI_DIR = path.resolve(__dirname, '../ui');

let activeProcess = null;
let activeCommandStr = null;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/**
 * Parse incoming JSON request body
 * @param {http.IncomingMessage} req
 * @returns {Promise<any>}
 */
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

/**
 * Create and configure the HTTP server
 * @param {Object} [options]
 * @param {number} [options.port=3000]
 * @param {string} [options.host='127.0.0.1']
 * @returns {http.Server}
 */
export function createServer() {
  const server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = urlObj.pathname;

    // CORS headers for local development flexibility
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // 1. API Routes
    if (pathname === '/api/characters' && req.method === 'GET') {
      const characters = Object.entries(CHARACTER_NAMES).map(([id, name]) => ({
        id: parseInt(id, 10),
        name,
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(characters));
      return;
    }

    if (pathname === '/api/recent-games' && req.method === 'GET') {
      try {
        const db = getDatabase('./analytics.db');
        const rows = db.prepare(`
          SELECT g.game_id, g.start_at, g.stage_id, g.duration_seconds, g.winner_port,
                 GROUP_CONCAT(p.port || ':' || p.character_id || ':' || coalesce(p.connect_code, '')) as player_info
          FROM games g
          LEFT JOIN game_players p ON g.game_id = p.game_id
          GROUP BY g.game_id
          ORDER BY g.start_at DESC
          LIMIT 20
        `).all();

        const games = rows.map(r => ({
          gameId: r.game_id,
          startAt: r.start_at,
          stageId: r.stage_id,
          stageName: getStageName(r.stage_id),
          durationSeconds: r.duration_seconds,
          winnerPort: r.winner_port,
          players: r.player_info ? r.player_info.split(',').map(item => {
            const [port, charId, code] = item.split(':');
            return {
              port: parseInt(port, 10),
              characterId: parseInt(charId, 10),
              characterName: CHARACTER_NAMES[charId] || `Char ${charId}`,
              connectCode: code || null,
            };
          }) : [],
        }));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(games));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message, games: [] }));
      }
      return;
    }

    if (pathname === '/api/status' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        isRunning: activeProcess !== null,
        currentCommand: activeCommandStr,
      }));
      return;
    }

    if (pathname === '/api/pipeline/status' && req.method === 'GET') {
      try {
        const db = getDatabase('./analytics.db');
        const activeCheckpoint = db.prepare(`
          SELECT * FROM ingestion_progress 
          ORDER BY updated_at DESC, id DESC 
          LIMIT 1
        `).get() || null;

        const totalGamesRow = db.prepare('SELECT COUNT(*) as count FROM games').get();
        const totalGames = totalGamesRow ? totalGamesRow.count : 0;

        let tempSlpCount = 0;
        const tempDir = path.resolve(process.cwd(), 'temp_slp');
        if (fs.existsSync(tempDir)) {
          const files = fs.readdirSync(tempDir);
          tempSlpCount = files.filter(f => f.endsWith('.slp')).length;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          activeCheckpoint,
          totalGames,
          tempSlpCount,
          timestamp: new Date().toISOString(),
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    if (pathname === '/api/analytics/mechanics' && req.method === 'GET') {
      try {
        const db = getDatabase('./analytics.db');
        const mechanics = db.prepare(`
          SELECT 
            AVG(l_cancel_rate) as avg_l_cancel_rate,
            AVG(wavedash_count) as avg_wavedashes,
            AVG(dash_dance_turns) as avg_dash_turns,
            AVG(shield_drops) as avg_shield_drops
          FROM player_mechanics_stats
        `).get() || {};

        const overall = db.prepare(`
          SELECT 
            AVG(ipm) as avg_ipm,
            AVG(openings_per_kill) as avg_opk,
            AVG(damage_per_opening) as avg_dpo
          FROM player_overall_stats
        `).get() || {};

        const topCharactersRows = db.prepare(`
          SELECT character_id, COUNT(*) as games_played
          FROM game_players
          GROUP BY character_id
          ORDER BY games_played DESC
          LIMIT 5
        `).all();

        const topCharacters = topCharactersRows.map(r => ({
          characterId: r.character_id,
          characterName: CHARACTER_NAMES[r.character_id] || `Char ${r.character_id}`,
          gamesPlayed: r.games_played,
        }));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          mechanics,
          overall,
          topCharacters,
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    if (pathname === '/api/audit/errors' && req.method === 'GET') {
      try {
        const db = getDatabase('./analytics.db');
        const statusRows = db.prepare(`
          SELECT status, COUNT(*) as count
          FROM replay_status
          GROUP BY status
        `).all();

        const statusCounts = {};
        for (const row of statusRows) {
          statusCounts[row.status] = row.count;
        }

        const recentFailures = db.prepare(`
          SELECT replay_id, file_hash, source, status, error_message, processed_at
          FROM replay_status
          WHERE status != 'COMPLETED'
          ORDER BY processed_at DESC
          LIMIT 10
        `).all();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          statusCounts,
          recentFailures,
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    const gameHabitsMatch = pathname.match(/^\/api\/games\/([^/]+)\/habits$/);
    if (gameHabitsMatch && req.method === 'GET') {
      try {
        const gameId = gameHabitsMatch[1];
        const playerIndexParam = urlObj.searchParams.get('playerIndex');
        const portParam = urlObj.searchParams.get('port');
        const options = {};
        if (playerIndexParam !== null) options.playerIndex = parseInt(playerIndexParam, 10);
        if (portParam !== null) options.port = parseInt(portParam, 10);

        const analytics = new AnalyticsService('./analytics.db');
        const habits = analytics.getGameHabits(gameId, options);

        if (!habits) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Game not found' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(habits));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    const playerHabitsMatch = pathname.match(/^\/api\/players\/([^/]+)\/habits$/);
    if (playerHabitsMatch && req.method === 'GET') {
      try {
        const rawCode = playerHabitsMatch[1];
        const connectCode = decodeURIComponent(rawCode).trim().toUpperCase();

        const filters = {};
        if (urlObj.searchParams.get('opponentConnectCode')) {
          filters.opponentConnectCode = decodeURIComponent(urlObj.searchParams.get('opponentConnectCode')).trim().toUpperCase();
        }
        if (urlObj.searchParams.get('characterId') !== null) {
          filters.characterId = parseInt(urlObj.searchParams.get('characterId'), 10);
        }
        if (urlObj.searchParams.get('opponentCharacterId') !== null) {
          filters.opponentCharacterId = parseInt(urlObj.searchParams.get('opponentCharacterId'), 10);
        }
        if (urlObj.searchParams.get('stageId') !== null) {
          filters.stageId = parseInt(urlObj.searchParams.get('stageId'), 10);
        }

        const analytics = new AnalyticsService('./analytics.db');
        const profile = analytics.getPlayerHabitsProfile(connectCode, filters);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(profile));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    if (pathname === '/api/batches' && req.method === 'GET') {
      try {
        const db = getDatabase('./analytics.db');
        const rows = db.prepare(`
          SELECT * FROM batch_runs ORDER BY started_at DESC LIMIT 50
        `).all();

        const batches = rows.map(b => ({
          ...b,
          filterCriteria: b.filter_criteria ? JSON.parse(b.filter_criteria) : null,
        }));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(batches));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message, batches: [] }));
      }
      return;
    }

    if (pathname.startsWith('/api/batches/') && req.method === 'GET') {
      try {
        const id = pathname.replace('/api/batches/', '');
        const db = getDatabase('./analytics.db');
        let batch;

        if (id === 'latest') {
          batch = db.prepare(`SELECT * FROM batch_runs ORDER BY started_at DESC, rowid DESC LIMIT 1`).get();
        } else {
          batch = db.prepare(`SELECT * FROM batch_runs WHERE batch_id = ?`).get(id);
        }

        if (!batch) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Batch not found' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ...batch,
          filterCriteria: batch.filter_criteria ? JSON.parse(batch.filter_criteria) : null,
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    if (pathname === '/api/storage/footprint' && req.method === 'GET') {
      try {
        const payloadsDir = path.resolve(process.cwd(), 'payloads');
        let totalPayloads = 0;
        let totalBytes = 0;

        function scanDir(dir) {
          if (!fs.existsSync(dir)) return;
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {
              scanDir(full);
            } else if (e.isFile() && e.name.endsWith('.json.gz')) {
              totalPayloads++;
              totalBytes += fs.statSync(full).size;
            }
          }
        }
        scanDir(payloadsDir);

        let tempSlpCount = 0;
        const tempDir = path.resolve(process.cwd(), 'temp_slp');
        if (fs.existsSync(tempDir)) {
          tempSlpCount = fs.readdirSync(tempDir).filter(f => f.endsWith('.slp')).length;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          payloadStorage: {
            fileCount: totalPayloads,
            totalBytes,
          },
          totalPayloads,
          totalBytes,
          tempSlpCount,
          tempSlpZero: tempSlpCount === 0,
          timestamp: new Date().toISOString(),
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    if (pathname === '/api/abort' && req.method === 'POST') {
      if (!activeProcess) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ aborted: false, message: 'No active command running' }));
        return;
      }

      console.log('[Server] Aborting active command via SIGINT...');
      activeProcess.kill('SIGINT');

      // Safety fallback: SIGKILL if process does not exit in 4s
      const procToKill = activeProcess;
      const killTimer = setTimeout(() => {
        if (!procToKill.killed) {
          console.warn('[Server] Force killing child process with SIGKILL...');
          procToKill.kill('SIGKILL');
        }
      }, 4000);

      procToKill.once('exit', () => clearTimeout(killTimer));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ aborted: true, message: 'Abort signal dispatched' }));
      return;
    }

    if (pathname === '/api/execute' && req.method === 'POST') {
      if (activeProcess) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Another command is currently running. Please wait or abort it.' }));
        return;
      }

      let reqData;
      try {
        reqData = await parseJsonBody(req);
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON request' }));
        return;
      }

      const args = Array.isArray(reqData.args) ? reqData.args : [];
      activeCommandStr = `node src/cli.js ${args.join(' ')}`;
      console.log(`[Server] Executing: ${activeCommandStr}`);

      // Start Server-Sent Events (SSE) stream
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
      });

      const sendEvent = (type, data) => {
        res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
      };

      sendEvent('start', { command: activeCommandStr });

      const cliPath = path.resolve(__dirname, '../cli.js');
      const child = spawn(process.execPath, ['--no-warnings', cliPath, ...args], {
        cwd: process.cwd(),
        env: { ...process.env, FORCE_COLOR: '1', NODE_NO_WARNINGS: '1' },
      });

      activeProcess = child;

      child.stdout.on('data', chunk => {
        sendEvent('stdout', { text: chunk.toString('utf8') });
      });

      child.stderr.on('data', chunk => {
        const text = chunk.toString('utf8');
        // Filter out benign V8 asm.js enet warnings that pollute stderr
        const lines = text.split('\n').filter(line => {
          const l = line.trim();
          return !l.includes('Invalid asm.js') && !l.includes('--trace-warnings') && !l.includes('enet.js:11');
        });
        const cleaned = lines.join('\n').trim();
        if (cleaned) {
          sendEvent('stderr', { text: cleaned + '\n' });
        }
      });

      child.on('error', err => {
        sendEvent('error', { message: err.message });
      });

      child.on('close', (code, signal) => {
        console.log(`[Server] Command finished. Code: ${code}, Signal: ${signal}`);
        activeProcess = null;
        activeCommandStr = null;
        sendEvent('exit', { code, signal });
        res.end();
      });

      // Handle client disconnect
      req.on('close', () => {
        if (activeProcess === child) {
          console.log('[Server] Client disconnected from SSE stream.');
        }
      });

      return;
    }

    // 2. Static File Serving (from src/ui)
    let filePath = pathname === '/' ? path.join(UI_DIR, 'index.html') : path.join(UI_DIR, pathname);

    // Prevent directory traversal attacks
    if (!filePath.startsWith(UI_DIR)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Access Denied');
      return;
    }

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      res.writeHead(200, { 'Content-Type': contentType });
      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
    });
  });

  return server;
}

/**
 * Start the server on a specified or free port
 * @param {Object} [options]
 * @param {number} [options.port=3000]
 * @param {string} [options.host='0.0.0.0']
 * @returns {Promise<{server: http.Server, port: number, url: string}>}
 */
export function startServer({ port = 3000, host = '0.0.0.0' } = {}) {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.listen(port, host, () => {
      const address = server.address();
      const actualPort = typeof address === 'object' && address !== null ? address.port : port;
      const displayHost = host === '0.0.0.0' ? 'localhost' : host;
      const url = `http://${displayHost}:${actualPort}`;

      console.log('\n======================================================');
      console.log('⚡ Flowstate Melee Analysis Engine - Browser UI ⚡');
      console.log(`Web Interface Live at: \x1b[36m${url}\x1b[0m`);
      console.log('Press Ctrl+C to stop the web server.');
      console.log('======================================================\n');

      resolve({ server, port: actualPort, url });
    });

    server.on('error', err => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`[Server] Port ${port} is in use, retrying on port ${port + 1}...`);
        startServer({ port: port + 1, host }).then(resolve, reject);
      } else {
        reject(err);
      }
    });
  });
}
