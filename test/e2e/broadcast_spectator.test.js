import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { createServer } from '../../src/server/server.js';
import { BroadcastService, BroadcastState } from '../../src/broadcast/broadcastService.js';
import { SlippiAuthClient } from '../../src/broadcast/slippiAuth.js';

const UNRANKED_SLP = path.resolve('external/slippi-js-master/slp/unranked_game1.slp');

describe('Broadcast Spectator E2E', () => {
  let server;
  let baseUrl;
  let broadcast;
  let serverPort;
  let mockRelayServer;
  let mockRelayPort;
  let mockRelayClients = new Set();
  let latestUpgradeHeaders = null;

  before(async () => {
    // 1. Start mock Slippi Cloud Relay WebSocket server
    mockRelayServer = new WebSocketServer({ port: 0 });
    await new Promise((resolve) => mockRelayServer.on('listening', resolve));
    mockRelayPort = mockRelayServer.address().port;

    mockRelayServer.on('headers', (headers, req) => {
      latestUpgradeHeaders = req.headers;
    });

    mockRelayServer.on('connection', (ws) => {
      mockRelayClients.add(ws);

      ws.on('message', (data) => {
        let msg = null;
        try {
          msg = JSON.parse(data.toString('utf8'));
        } catch (_) {}

        if (msg?.type === 'list-broadcasts') {
          ws.send(JSON.stringify({
            type: 'list-broadcasts-resp',
            broadcasts: [
              {
                broadcastId: 'brd_test_001',
                target: 'test_slippi_uid_28chars_xyz123',
                broadcaster: {
                  connectCode: 'NIKK#513',
                  displayName: 'Nikk',
                },
              },
            ],
          }));
        } else if (msg?.type === 'watch-broadcast') {
          ws.send(JSON.stringify({
            type: 'watch-broadcast-resp',
            broadcastId: msg.broadcastId,
            success: true,
          }));
        }
      });

      ws.on('close', () => {
        mockRelayClients.delete(ws);
      });
    });

    // 2. Mock Slippi Auth Client
    const mockAuth = new SlippiAuthClient({
      credentialsPath: path.resolve('temp_slp/test_e2e_credentials.json'),
    });
    mockAuth.fbUid = 'test_slippi_uid_28chars_xyz123';
    mockAuth.idToken = 'mock_valid_id_token_xyz';
    mockAuth.refreshToken = 'mock_refresh_token_xyz';
    mockAuth.expiresAt = Date.now() + 3600000;
    mockAuth.email = 'spectator_test@slippi.gg';
    mockAuth.displayName = 'SpectatorTester';
    mockAuth.connectCode = 'SPEC#001';

    // 3. Initialize BroadcastService pointing to mock relay
    broadcast = new BroadcastService({
      auth: mockAuth,
      relayUrl: `ws://127.0.0.1:${mockRelayPort}`,
      autoFollow: true,
      autoArchive: false,
      lunarUpload: false,
    });

    // 4. Start HTTP API Server
    server = createServer({ broadcastService: broadcast });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    serverPort = server.address().port;
    baseUrl = `http://127.0.0.1:${serverPort}`;
  });

  after(async () => {
    if (broadcast) {
      await broadcast.stopSession();
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (mockRelayServer) {
      for (const client of mockRelayClients) {
        try { client.close(); } catch (_) {}
      }
      await new Promise((resolve) => mockRelayServer.close(resolve));
    }
    try {
      if (fs.existsSync(path.resolve('temp_slp/test_e2e_credentials.json'))) {
        fs.unlinkSync(path.resolve('temp_slp/test_e2e_credentials.json'));
      }
    } catch (_) {}
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

    // 2. Start cloud relay session
    const postRes = await requestHttp('POST', '/api/broadcast/session', {
      relayUrl: `ws://127.0.0.1:${mockRelayPort}`,
      mockUid: 'test_slippi_uid_28chars_xyz123',
    });
    assert.strictEqual(postRes.status, 200);
    assert.ok(postRes.json.status === BroadcastState.LISTENING || postRes.json.status === BroadcastState.CONNECTED);
    assert.strictEqual(postRes.json.spectatorId, 'test_slippi_uid_28chars_xyz123');
    assert.strictEqual(postRes.json.broadcastKey, 'test_slippi_uid_28chars_xyz123');

    // Verify upgrade headers sent to mock relay
    assert.ok(latestUpgradeHeaders, 'Relay should have received upgrade headers');
    assert.strictEqual(latestUpgradeHeaders['api-version'], '2');
    assert.ok(latestUpgradeHeaders['authorization'].startsWith('Bearer '));

    // 3. Query active session
    const getRes = await requestHttp('GET', '/api/broadcast/session');
    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.json.spectatorId, postRes.json.spectatorId);

    // 4. Delete session and tear down connection
    const delRes = await requestHttp('DELETE', '/api/broadcast/session');
    assert.strictEqual(delRes.status, 200);
    assert.strictEqual(delRes.json.status, BroadcastState.IDLE);

    // 5. Subsequent query confirms IDLE
    const afterDelRes = await requestHttp('GET', '/api/broadcast/session');
    assert.strictEqual(afterDelRes.json.status, BroadcastState.IDLE);
  });

  it('parses real-time TCP stream under 100ms and pushes events via SSE', async () => {
    // Start session
    await requestHttp('POST', '/api/broadcast/session', {
      relayUrl: `ws://127.0.0.1:${mockRelayPort}`,
      mockUid: 'test_slippi_uid_28chars_xyz123',
    });

    // Connect SSE client and wait for connection to be established
    const sseEvents = [];
    let sseResolve;
    let sseReject;
    const ssePromise = new Promise((resolve, reject) => {
      sseResolve = resolve;
      sseReject = reject;
    });

    let sseReadyResolve;
    const sseReadyPromise = new Promise((resolve) => {
      sseReadyResolve = resolve;
    });

    const sseReq = http.request(
      `http://127.0.0.1:${serverPort}/api/broadcast/events`,
      { headers: { Accept: 'text/event-stream' } },
      (res) => {
        sseReadyResolve();
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
    sseReq.on('error', () => {});
    sseReq.end();

    // Wait until SSE client is connected and listening
    await sseReadyPromise;

    // Small delay to ensure SSE stream pipeline is active
    await new Promise((r) => setTimeout(r, 50));

    // Stream base64 replay chunks through mock relay
    const replayBytes = fs.readFileSync(UNRANKED_SLP);
    const startParseTime = performance.now();

    // Send chunks via mock relay WebSocket
    const chunkSize = 2048;
    for (let i = 0; i < replayBytes.length; i += chunkSize) {
      const slice = replayBytes.subarray(i, i + chunkSize);
      const payload = slice.toString('base64');
      const eventMsg = JSON.stringify({
        type: 'events',
        events: [{ type: 'game_event', payload }],
      });
      for (const client of mockRelayClients) {
        if (client.readyState === 1) {
          client.send(eventMsg);
        }
      }
    }

    // Wait for SSE gameStart
    await Promise.race([
      ssePromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('SSE gameStart timeout')), 2000)),
    ]);
    const extractionDuration = performance.now() - startParseTime;

    try { sseReq.destroy(); } catch (_) {}

    // Assert extraction latency <= 100ms
    assert.ok(
      extractionDuration <= 100,
      `Stream parsing must extract metadata in <= 100ms, took ${extractionDuration.toFixed(2)}ms`
    );

    // Validate extracted payload
    const gameStartEvent = sseEvents.find((e) => e.type === 'gameStart');
    assert.ok(gameStartEvent, 'Must emit gameStart event');
    assert.strictEqual(gameStartEvent.stageId, 31);
    assert.strictEqual(gameStartEvent.stageName, 'Battlefield');
    assert.strictEqual(gameStartEvent.players.length, 2);

    const [p1, p2] = gameStartEvent.players;
    assert.strictEqual(p1.connectCode, 'NIKK#513');
    assert.strictEqual(p1.characterId, 20); // Falco
    assert.strictEqual(p2.connectCode, 'NIKK#142');
    assert.strictEqual(p2.characterId, 20); // Falco

    // Clean up
    await requestHttp('DELETE', '/api/broadcast/session');
  });
});
