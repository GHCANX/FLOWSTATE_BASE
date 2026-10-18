import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { CHARACTER_NAMES } from '../constants/characters.js';
import { getDatabase, closeDatabase } from '../database/db.js';
import { getStageName } from '../constants/stageGeometry.js';

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
