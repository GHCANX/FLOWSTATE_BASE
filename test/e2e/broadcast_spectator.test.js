import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from '../../src/server/server.js';
import { BroadcastService, BroadcastState } from '../../src/broadcast/broadcastService.js';

const UNRANKED_SLP = path.resolve('external/slippi-js-master/slp/unranked_game1.slp');

describe('Broadcast Spectator E2E', () => {
  let server;
  let baseUrl;
  let broadcast;
  let serverPort;

  before(async () => {
    broadcast = new BroadcastService();
    server = createServer({ broadcastService: broadcast });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    serverPort = server.address().port;
    baseUrl = `http://127.0.0.1:${serverPort}`;
  });

  after(async () => {
    if (broadcast) {
      await broadcast.stopSession();
    }
    await new Promise((resolve) => server.close(resolve));
  });

  function requestHttp(method, pathUrl, body = null) {
    return new Promise((resolve, reject) => {
      const opts = {
        hostname: '127.0.0.1',
        port: serverPort,
        path: pathUrl,
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
      };
      const req = http.request(opts, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(data);
          } catch (_) {}
          resolve({ status: res.statusCode, headers: res.headers, body: data, json });
        });
      });
      req.on('error', reject);
      if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
      req.end();
    });
  }

  it('manages broadcast session lifecycle (POST -> GET -> DELETE)', async () => {
    // 1. Initial state is IDLE
    const initRes = await requestHttp('GET', '/api/broadcast/session');
    assert.strictEqual(initRes.status, 200);
    assert.strictEqual(initRes.json.status, BroadcastState.IDLE);

    // 2. Provision session on dynamic port (0)
    const postRes = await requestHttp('POST', '/api/broadcast/session', { port: 0 });
    assert.strictEqual(postRes.status, 200);
    assert.strictEqual(postRes.json.status, BroadcastState.LISTENING);
    assert.ok(postRes.json.broadcastKey.match(/^SLP-[A-F0-9]{4}-[A-F0-9]{4}$/));
    assert.ok(postRes.json.port > 0);

    // 3. Query active session
    const getRes = await requestHttp('GET', '/api/broadcast/session');
    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.json.broadcastKey, postRes.json.broadcastKey);
    assert.strictEqual(getRes.json.status, BroadcastState.LISTENING);

    // 4. Delete session and tear down listener
    const delRes = await requestHttp('DELETE', '/api/broadcast/session');
    assert.strictEqual(delRes.status, 200);
    assert.strictEqual(delRes.json.status, BroadcastState.IDLE);

    // 5. Subsequent query confirms IDLE
    const afterDelRes = await requestHttp('GET', '/api/broadcast/session');
    assert.strictEqual(afterDelRes.json.status, BroadcastState.IDLE);
  });

  it('parses real-time TCP stream under 100ms and pushes events via SSE', async () => {
    // Start session
    const sessionRes = await requestHttp('POST', '/api/broadcast/session', { port: 0 });
    const tcpPort = sessionRes.json.port;

    // Connect SSE client with defensive timeout
    const sseEvents = [];
    let sseResolve;
    let sseReject;
    const ssePromise = new Promise((resolve, reject) => {
      sseResolve = resolve;
      sseReject = reject;
    });

    const sseTimeout = setTimeout(() => {
      sseReject(new Error('Timed out waiting for gameStart event via SSE stream'));
    }, 5000);

    const sseReq = http.request(
      `http://127.0.0.1:${serverPort}/api/broadcast/events`,
      { headers: { Accept: 'text/event-stream' } },
      (res) => {
        let buffer = '';
        res.on('data', (chunk) => {
          buffer += chunk.toString();
          const parts = buffer.split('\n\n');
          buffer = parts.pop();
          for (const part of parts) {
            const trimmed = part.trim();
            if (trimmed.startsWith('data: ')) {
              try {
                const parsed = JSON.parse(trimmed.slice(6));
                sseEvents.push(parsed);
                if (parsed.type === 'gameStart') {
                  clearTimeout(sseTimeout);
                  sseResolve();
                }
              } catch (_) {}
            }
          }
        });
      }
    );
    sseReq.on('error', (err) => {
      clearTimeout(sseTimeout);
      sseReject(err);
    });
    sseReq.end();

    const client = new net.Socket();
    try {
      // Stream binary replay data to TCP port
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out connecting to TCP port')), 3000);
        client.connect(tcpPort, '127.0.0.1', () => {
          clearTimeout(timer);
          resolve();
        });
        client.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });

      const replayBytes = fs.readFileSync(UNRANKED_SLP);
      const startTs = performance.now();

      // Send chunks
      const chunkSize = 256;
      for (let i = 0; i < replayBytes.length; i += chunkSize) {
        client.write(replayBytes.subarray(i, i + chunkSize));
      }

      // Wait for gameStart event
      await ssePromise;
      const extractionMs = performance.now() - startTs;

      // Verification: latency must be <= 100ms
      assert.ok(extractionMs < 100, `GameStart extraction exceeded 100ms: ${extractionMs.toFixed(2)}ms`);

      // Verify parsed GameStart event payload
      const gameStartEvent = sseEvents.find((e) => e.type === 'gameStart');
      assert.ok(gameStartEvent);
      assert.strictEqual(gameStartEvent.stageId, 31); // Battlefield
      assert.strictEqual(gameStartEvent.stageName, 'Battlefield');
      assert.strictEqual(gameStartEvent.players.length, 2);
    } finally {
      clearTimeout(sseTimeout);
      try { client.destroy(); } catch (_) {}
      try { sseReq.destroy(); } catch (_) {}
      await requestHttp('DELETE', '/api/broadcast/session');
    }

    // Zero disk accumulation verification
    const tempFiles = fs.readdirSync('./temp_slp').filter((f) => f.endsWith('.slp'));
    assert.strictEqual(tempFiles.length, 0);
  });
});
