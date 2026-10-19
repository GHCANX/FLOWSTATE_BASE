/**
 * FlowState Melee Analysis Engine - Live Broadcast Telemetry & Ingestion Test Suite
 *
 * Requirements covered:
 * R1. Robust Multi-Format Stream Envelope & Chunk Ingestion:
 *     - Standalone game_event (raw binary Buffer and base64 string)
 *     - Batched events array ([{ type: 'game_event' }, { type: 'menu_event' }])
 *     - Standalone menu_event payloads & pre-match menu detection
 *     - Schema normalization (id vs broadcastId, target vs viewerKey vs spectatorId)
 *     - Parser state reset across consecutive games (SlpStream re-initialization upon GAME_END)
 * R2. Live Stream Telemetry & Active Scanning Indicators:
 *     - Real-time packet count, byte count, throughput (KB/s), and granular parser state
 *     - SSE 10 Hz throttle enforcement (100ms window) on high-frequency chunk bursts
 *     - Immediate unthrottled dispatch of state transitions (MENUS_ACTIVE, IN_GAME, GAME_END)
 * R3. Active Pre-Game Dashboard & Live Match Extraction:
 *     - Extraction of stage, player connect codes, and character IDs upon GAME_START
 *     - Clean transition from Active Pre-Game -> Live Match -> Reset to Pre-Game
 * R4. Integrity & Resource Management:
 *     - Zero disk accumulation invariant (0 .slp files in temp_slp/)
 *     - Clean teardown via DELETE /api/broadcast/session without leaked handles
 */

import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { createServer } from '../src/server/server.js';
import { BroadcastService, BroadcastState } from '../src/broadcast/broadcastService.js';
import { SlippiAuthClient } from '../src/broadcast/slippiAuth.js';
import { getDatabase } from '../src/database/db.js';

const REPLAY_UNRANKED = path.resolve('external/slippi-js-master/slp/unranked_game1.slp');
const REPLAY_4PLAYERS = path.resolve('external/slippi-js-master/slp/displayNameAndConnectCodeInGameStart.slp');

function requestHttp(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const bodyBuffer = Buffer.concat(chunks);
        const bodyStr = bodyBuffer.toString('utf8');
        let json = null;
        try {
          json = JSON.parse(bodyStr);
        } catch (_) {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: bodyStr,
          buffer: bodyBuffer,
          json,
        });
      });
    });
    req.on('error', reject);
    if (options.body) {
      const payload = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      req.write(payload);
    }
    req.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function openSseStream(url) {
  const events = [];
  let reqStream = null;

  const streamPromise = new Promise((resolve, reject) => {
    reqStream = http.request(url, { headers: { Accept: 'text/event-stream' } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`SSE connection failed with status ${res.statusCode}`));
        return;
      }
      resolve();

      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n\n');
        buffer = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed.startsWith('data:')) {
            const rawJson = trimmed.slice(5).trim();
            try {
              events.push(JSON.parse(rawJson));
            } catch (_) {}
          }
        }
      });
    });

    reqStream.on('error', () => {});
    reqStream.end();
  });

  return {
    ready: streamPromise,
    events,
    close: () => {
      if (reqStream) {
        try { reqStream.destroy(); } catch (_) {}
      }
    },
    waitForEvent: async (predicate, timeoutMs = 3000) => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const found = events.find(predicate);
        if (found) return found;
        await sleep(15);
      }
      throw new Error(`Timed out after ${timeoutMs}ms waiting for SSE event`);
    },
  };
}

async function run() {
  console.log('========================================================================');
  console.log('⚡ FLOWSTATE: LIVE STREAM TELEMETRY & MULTI-FORMAT SPECTATOR TEST ⚡');
  console.log('========================================================================\n');

  let mockRelayServer = null;
  let mockRelayPort = null;
  const mockClients = new Set();
  let testServer = null;
  let baseUrl = null;
  let broadcastService = null;
  let sse = null;
  let archivedGameId = null;
  let archivedPayloadPath = null;

  try {
    // 1. Start Mock WebSocket Relay Server
    mockRelayServer = new WebSocketServer({ port: 0 });
    await new Promise((r) => mockRelayServer.on('listening', r));
    mockRelayPort = mockRelayServer.address().port;

    mockRelayServer.on('connection', (ws) => {
      mockClients.add(ws);

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
                id: 'brd_telemetry_test_99',
                viewerKey: 'mock_telemetry_uid_123',
                broadcaster: {
                  displayName: 'Mang0',
                  connectCode: 'MANG#000',
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
        mockClients.delete(ws);
      });
    });

    // 2. Mock Slippi Auth Client
    const mockAuth = new SlippiAuthClient({
      credentialsPath: path.resolve('temp_slp/test_telemetry_credentials.json'),
    });
    mockAuth.fbUid = 'mock_telemetry_uid_123';
    mockAuth.idToken = 'mock_valid_token';
    mockAuth.expiresAt = Date.now() + 3600000;
    mockAuth.displayName = 'TelemetryTester';
    mockAuth.connectCode = 'TELEM#001';

    // 3. Initialize BroadcastService
    broadcastService = new BroadcastService({
      auth: mockAuth,
      relayUrl: `ws://127.0.0.1:${mockRelayPort}`,
      autoFollow: true,
      autoArchive: false,
      lunarUpload: false,
    });

    testServer = createServer({ broadcastService });
    await new Promise((r) => testServer.listen(0, '127.0.0.1', r));
    const port = testServer.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    // -------------------------------------------------------------------------
    // TEST 1: Session Provisioning & Schema Normalization
    // -------------------------------------------------------------------------
    console.log('--- Test 1: Session Provisioning & Schema Normalization ---');
    const startRes = await requestHttp(`${baseUrl}/api/broadcast/session`, {
      method: 'POST',
      body: { autoFollow: true, autoArchive: false, lunarUpload: false },
    });
    assert.strictEqual(startRes.statusCode, 200);
    assert.strictEqual(startRes.json.spectatorId, 'mock_telemetry_uid_123');

    // Wait for auto-follow handshake
    await sleep(60);
    const session = broadcastService.getSession();
    assert.strictEqual(session.currentBroadcastId, 'brd_telemetry_test_99');
    assert.strictEqual(session.currentBroadcaster?.displayName, 'Mang0');
    assert.strictEqual(session.currentBroadcaster?.connectCode, 'MANG#000');
    assert.strictEqual(session.parserState, BroadcastState.CONNECTED_TO_STREAM);
    assert.strictEqual(session.telemetry.packetCount, 0);
    assert.strictEqual(session.telemetry.byteCount, 0);
    console.log('  ✔ Broadcaster schema normalized (id -> broadcastId, viewerKey -> target): Mang0 (MANG#000)');
    console.log('  ✔ Initial parser state: CONNECTED_TO_STREAM, 0 chunks ingested');

    // Test 1.2: POST /api/broadcast/watch schema normalization (id vs broadcastId) and stream switch reset
    broadcastService.currentMatchChunks = [Buffer.from([0x01, 0x02])];
    const prevStreamInstance = broadcastService.slpStream;
    const watchRes = await requestHttp(`${baseUrl}/api/broadcast/watch`, {
      method: 'POST',
      body: { id: 'brd_switched_stream_44' },
    });
    assert.strictEqual(watchRes.statusCode, 200);
    assert.strictEqual(watchRes.json.watching, 'brd_switched_stream_44');
    assert.strictEqual(broadcastService.currentBroadcastId, 'brd_switched_stream_44');
    assert.strictEqual(broadcastService.currentMatchChunks.length, 0, 'currentMatchChunks must be reset when switching streams');
    assert.notStrictEqual(broadcastService.slpStream, prevStreamInstance, 'SlpStream must be re-initialized when switching streams');
    // Switch back to test broadcaster
    broadcastService.watchBroadcast('brd_telemetry_test_99');

    // Connect SSE client
    sse = openSseStream(`${baseUrl}/api/broadcast/events`);
    await sse.ready;
    const initialSessionEvent = await sse.waitForEvent((e) => e.type === 'session');
    assert.ok(initialSessionEvent, 'SSE client must receive initial session event');
    console.log('  ✔ POST /api/broadcast/watch schema normalized (id) & parser reset on stream switch');
    console.log('  ✔ SSE client connected to /api/broadcast/events');

    // -------------------------------------------------------------------------
    // TEST 2: Multi-Format Chunk Ingestion (Buffer, Base64, Batched Events)
    // -------------------------------------------------------------------------
    console.log('\n--- Test 2: Multi-Format Chunk Ingestion ---');
    const prevPacketCount = broadcastService.telemetry.packetCount;

    // 2.1 Standalone game_event with base64 string
    const chunk1 = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    for (const c of mockClients) {
      if (c.readyState === 1) {
        c.send(JSON.stringify({
          type: 'game_event',
          payload: chunk1.toString('base64'),
        }));
      }
    }
    await sleep(30);

    // 2.2 Standalone game_event with byte array
    for (const c of mockClients) {
      if (c.readyState === 1) {
        c.send(JSON.stringify({
          type: 'game_event',
          payload: [0x10, 0x20, 0x30],
        }));
      }
    }
    await sleep(30);

    // 2.3 Batched events array
    for (const c of mockClients) {
      if (c.readyState === 1) {
        c.send(JSON.stringify({
          type: 'events',
          events: [
            { type: 'game_event', payload: Buffer.from([0xaa, 0xbb]).toString('base64') },
            { type: 'game_event', payload: Buffer.from([0xcc, 0xdd, 0xee]).toString('base64') },
          ],
        }));
      }
    }
    await sleep(30);

    // 2.4 Malformed, null, and corrupt payloads (defensive test)
    for (const c of mockClients) {
      if (c.readyState === 1) {
        c.send(JSON.stringify({ type: 'game_event', payload: '??NOT_BASE_64??' }));
        c.send(JSON.stringify({ type: 'game_event', payload: null }));
        c.send(JSON.stringify({ type: 'events', events: [null, undefined, { type: 'unknown' }] }));
      }
    }
    await sleep(30);

    // 2.5 Direct text frame with base64 encoded chunk
    const rawB64Chunk = Buffer.from([0x77, 0x88]).toString('base64');
    for (const c of mockClients) {
      if (c.readyState === 1) {
        c.send(rawB64Chunk);
      }
    }
    await sleep(30);

    // 2.6 Handshake buffer capping at 64 KB against non-Slippi garbage streams
    const junkBytes = Buffer.alloc(80 * 1024, 0xee); // 80 KB of non-Slippi data without 0x35
    broadcastService.processRawChunk(junkBytes);
    assert.ok(
      broadcastService._handshakeBuffer.length <= 65536,
      `Handshake buffer must be capped at 64 KB, actual: ${broadcastService._handshakeBuffer.length}`
    );
    // Clear the junk from the test harness so next tests run fresh
    broadcastService._handshakeBuffer = Buffer.alloc(0);
    console.log('  ✔ Handshake buffer overflow protection enforced (capped <= 64 KB against non-Slippi streams)');

    assert.ok(broadcastService.telemetry.packetCount >= prevPacketCount + 5, 'Must ingest valid chunks without crashing on malformed inputs');
    console.log(`  ✔ Ingested multi-format chunks (base64, byte array, batched events, direct base64 text) safely`);

    // -------------------------------------------------------------------------
    // TEST 3: Pre-Match Menu Detection (menu_event & raw stream frames)
    // -------------------------------------------------------------------------
    console.log('\n--- Test 3: Pre-Match Menu Detection ---');
    let menuActiveEmitted = false;
    broadcastService.once('menuActive', () => {
      menuActiveEmitted = true;
    });

    for (const c of mockClients) {
      if (c.readyState === 1) {
        c.send(JSON.stringify({
          type: 'menu_event',
          payload: Buffer.from('character_stage_select_screen_payload').toString('base64'),
        }));
      }
    }

    const menuStateEvent = await sse.waitForEvent(
      (e) => e.type === 'menuActive'
    );
    assert.ok(menuStateEvent, 'SSE must push menuActive event');
    assert.strictEqual(broadcastService.status, BroadcastState.MENUS_ACTIVE);
    assert.strictEqual(broadcastService.parserState, BroadcastState.MENUS_ACTIVE);
    assert.strictEqual(menuActiveEmitted, true, 'BroadcastService must emit menuActive event');
    console.log('  ✔ menu_event detected: transitioned to MENUS_ACTIVE without delay');

    // Also verify raw pre-match stream frames detection
    broadcastService.parserState = BroadcastState.CONNECTED_TO_STREAM;
    broadcastService.status = BroadcastState.CONNECTED;
    let statusChangeEmitted = false;
    broadcastService.once('statusChange', (s) => {
      if (s.parserState === BroadcastState.MENUS_ACTIVE) statusChangeEmitted = true;
    });
    broadcastService.processRawChunk(Buffer.from([0x11, 0x22, 0x33]));
    assert.strictEqual(broadcastService.parserState, BroadcastState.MENUS_ACTIVE);
    assert.strictEqual(broadcastService.status, BroadcastState.MENUS_ACTIVE);
    assert.strictEqual(statusChangeEmitted, true, 'Raw pre-match stream frames must emit statusChange with MENUS_ACTIVE');

    // Verify continuous menu_event frames do NOT flood duplicate menuActive events
    let duplicateMenuEventsCount = 0;
    const countDupes = () => { duplicateMenuEventsCount++; };
    broadcastService.on('menuActive', countDupes);
    for (let i = 0; i < 10; i++) {
      broadcastService.processMenuEvent(Buffer.from([0x22, 0x33, 0x44]));
    }
    broadcastService.off('menuActive', countDupes);
    assert.strictEqual(
      duplicateMenuEventsCount,
      0,
      'Continuous menu_event chunks while in MENUS_ACTIVE must not emit duplicate menuActive events'
    );
    console.log('  ✔ Raw pre-match stream frames detected: transitioned to MENUS_ACTIVE and emitted statusChange');
    console.log('  ✔ Duplicate menuActive event flooding prevented on continuous menu frames');

    // -------------------------------------------------------------------------
    // TEST 4: High-Frequency Telemetry & 10 Hz Throttle Enforcement
    // -------------------------------------------------------------------------
    console.log('\n--- Test 4: High-Frequency Telemetry & 10 Hz Throttle Enforcement ---');
    const burstCount = 60;
    const initialSseEventsCount = sse.events.filter((e) => e.type === 'telemetry').length;

    // Send 60 chunks rapidly within 10ms
    const dummyPayload = Buffer.alloc(128, 0x5a).toString('base64');
    for (let i = 0; i < burstCount; i++) {
      for (const c of mockClients) {
        if (c.readyState === 1) {
          c.send(JSON.stringify({ type: 'game_event', payload: dummyPayload }));
        }
      }
    }

    // Wait 120ms (slightly over 1 throttle window)
    await sleep(120);

    const telemetryEventsAfterBurst = sse.events.filter((e) => e.type === 'telemetry').length;
    const deltaTelemetryEvents = telemetryEventsAfterBurst - initialSseEventsCount;

    // 60 chunks arrived in 10ms; with 10 Hz (100ms) throttling, there must be at most 2-3 telemetry emissions, NOT 60!
    assert.ok(
      deltaTelemetryEvents <= 4,
      `High-frequency telemetry must be throttled to <= 10 Hz (received ${deltaTelemetryEvents} events for 60 packets)`
    );

    // Verify all 60 packets were ingested synchronously in memory
    const latestTelem = broadcastService.telemetry;
    assert.ok(latestTelem.packetCount >= burstCount, `Synchronous packet counter must reach >= ${burstCount}, got ${latestTelem.packetCount}`);
    assert.ok(latestTelem.throughputKbps > 0, `Throughput must be positive, got ${latestTelem.throughputKbps} KB/s`);
    console.log(`  ✔ Ingested ${burstCount} chunks in memory synchronously: packetCount=${latestTelem.packetCount}, throughput=${latestTelem.throughputKbps} KB/s`);
    console.log(`  ✔ SSE 10 Hz throttle enforced: only ${deltaTelemetryEvents} telemetry events dispatched (DOM/loop protected)`);

    // Verify throughput decay after inactivity (> 1 second window)
    await sleep(1100);
    assert.strictEqual(broadcastService.telemetry.throughputKbps, 0, 'Throughput must decay to 0 KB/s on stream pause');
    console.log('  ✔ Telemetry throughput decayed to 0.0 KB/s after stream pause');

    // -------------------------------------------------------------------------
    // TEST 5: GAME_START Extraction & 1-Byte Handshake Chunk Buffering
    // -------------------------------------------------------------------------
    console.log('\n--- Test 5: GAME_START Extraction & 1-Byte Handshake Chunk Buffering ---');
    const replay1Bytes = fs.readFileSync(REPLAY_UNRANKED);
    const startParseTime = performance.now();

    let capturedGameStart = null;
    const gameStartPromise = new Promise((resolve) => {
      broadcastService.once('gameStart', (g) => {
        capturedGameStart = g;
        resolve();
      });
    });

    // 5.1 Test 1-byte handshake buffering (AGENTS.md Rule 8):
    // Deliver the first 45 bytes (containing UBJSON header and 0x35 MESSAGE_SIZES) 1 byte at a time!
    for (let i = 0; i < 45; i++) {
      broadcastService.processRawChunk(replay1Bytes.subarray(i, i + 1));
    }

    // 5.2 Deliver remaining game start bytes to complete GAME_START extraction
    const remainderGameStart = replay1Bytes.subarray(45, 8192);
    for (const c of mockClients) {
      if (c.readyState === 1) {
        c.send(JSON.stringify({
          type: 'events',
          events: [{ type: 'game_event', payload: remainderGameStart.toString('base64') }],
        }));
      }
    }

    await Promise.race([
      gameStartPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('gameStart timeout')), 2000)),
    ]);

    const latency = performance.now() - startParseTime;
    assert.ok(latency <= 100, `Extraction latency must be <= 100ms, took ${latency.toFixed(2)}ms`);
    assert.ok(capturedGameStart, 'gameStart must be extracted');
    assert.strictEqual(capturedGameStart.stageId, 31);
    assert.strictEqual(capturedGameStart.stageName, 'Battlefield');
    assert.strictEqual(capturedGameStart.players.length, 2);

    const p1 = capturedGameStart.players.find((p) => p.port === 1);
    const p2 = capturedGameStart.players.find((p) => p.port === 2);
    assert.ok(p1, 'Must extract Port 1');
    assert.ok(p2, 'Must extract Port 2');
    assert.strictEqual(p1.connectCode, 'NIKK#513');
    assert.strictEqual(p2.connectCode, 'NIKK#142');
    assert.strictEqual(p1.characterId, 20); // Falco
    assert.strictEqual(p2.characterId, 20); // Falco
    assert.strictEqual(p1.characterName, 'Falco');
    assert.strictEqual(broadcastService.status, BroadcastState.IN_GAME);
    assert.strictEqual(broadcastService.parserState, BroadcastState.IN_GAME);

    // Verify SSE dispatch
    const sseGameStart = await sse.waitForEvent((e) => e.type === 'gameStart');
    assert.strictEqual(sseGameStart.stageId, 31);
    assert.strictEqual(sseGameStart.players[0].connectCode, 'NIKK#513');
    console.log(`  ✔ GAME_START extracted in ${latency.toFixed(2)}ms (<= 100ms): Battlefield (Stage 31), NIKK#513 vs NIKK#142`);
    console.log('  ✔ State transitioned to IN_GAME and dispatched over SSE immediately');

    // -------------------------------------------------------------------------
    // TEST 6: GAME_END & Parser Re-initialization Across Consecutive Games
    // -------------------------------------------------------------------------
    console.log('\n--- Test 6: GAME_END & Back-to-Back Consecutive Games ---');
    const firstSlpStream = broadcastService.slpStream;

    // Stream remainder of replay 1 to trigger GAME_END (0x39)
    for (let i = 8192; i < replay1Bytes.length; i += 4096) {
      const slice = replay1Bytes.subarray(i, i + 4096);
      for (const c of mockClients) {
        if (c.readyState === 1) {
          c.send(JSON.stringify({
            type: 'events',
            events: [{ type: 'game_event', payload: slice.toString('base64') }],
          }));
        }
      }
    }

    const sseGameEnd = await sse.waitForEvent((e) => e.type === 'gameEnd');
    assert.ok(sseGameEnd, 'SSE must push gameEnd event');
    assert.strictEqual(broadcastService.currentGame, null, 'currentGame must be cleared on GAME_END');

    // Verify parser instance was freshly re-created
    assert.notStrictEqual(
      broadcastService.slpStream,
      firstSlpStream,
      'SlpStream instance must be re-instantiated upon GAME_END to prevent byte alignment corruption'
    );
    assert.strictEqual(broadcastService.status, BroadcastState.CONNECTED);
    assert.strictEqual(broadcastService.parserState, BroadcastState.MENUS_ACTIVE);
    console.log('  ✔ Game 1 ended: SlpStream re-instantiated cleanly, reset to Active Pre-Game state (MENUS_ACTIVE)');

    // Now immediately stream Game 2 (4-Player replay) to verify zero corruption
    const replay2Bytes = fs.readFileSync(REPLAY_4PLAYERS);
    let capturedGame2 = null;
    const game2Promise = new Promise((resolve) => {
      broadcastService.once('gameStart', (g) => {
        capturedGame2 = g;
        resolve();
      });
    });

    for (let i = 0; i < 8192; i += 4096) {
      const slice = replay2Bytes.subarray(i, i + 4096);
      for (const c of mockClients) {
        if (c.readyState === 1) {
          c.send(JSON.stringify({
            type: 'events',
            events: [{ type: 'game_event', payload: slice.toString('base64') }],
          }));
        }
      }
    }

    await Promise.race([
      game2Promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Game 2 gameStart timeout')), 2000)),
    ]);

    assert.ok(capturedGame2, 'Game 2 gameStart must be extracted immediately without corrupt byte alignment');
    assert.strictEqual(capturedGame2.stageId, 3); // Pokémon Stadium
    assert.strictEqual(capturedGame2.players.length, 4);
    assert.strictEqual(broadcastService.status, BroadcastState.IN_GAME);
    console.log('  ✔ Game 2 (Consecutive Match) parsed perfectly: Pokémon Stadium (Stage 3), 4 players');

    // 6.3 Test auto-archive with pre-match noise resilience
    broadcastService.autoArchive = true;
    let archiveErrorCaptured = null;
    let archiveCompleteCaptured = null;
    broadcastService.once('archiveError', (err) => { archiveErrorCaptured = err; });
    broadcastService.once('archiveComplete', (res) => { archiveCompleteCaptured = res; });

    for (let i = 8192; i < replay2Bytes.length; i += 4096) {
      const slice = replay2Bytes.subarray(i, i + 4096);
      for (const c of mockClients) {
        if (c.readyState === 1) {
          c.send(JSON.stringify({
            type: 'events',
            events: [{ type: 'game_event', payload: slice.toString('base64') }],
          }));
        }
      }
    }

    const archiveTimeout = Date.now();
    while (!archiveCompleteCaptured && !archiveErrorCaptured && Date.now() - archiveTimeout < 3000) {
      await sleep(25);
    }
    assert.strictEqual(archiveErrorCaptured, null, 'Auto-archive must succeed without archiveError');
    assert.ok(archiveCompleteCaptured, 'Auto-archive must emit archiveComplete');
    archivedGameId = archiveCompleteCaptured.gameId;
    archivedPayloadPath = archiveCompleteCaptured.archiveResult?.payloadPath;
    console.log(`  ✔ Game 2 auto-archived cleanly to dual-storage (gameId=${archivedGameId})`);

    // -------------------------------------------------------------------------
    // TEST 7: Teardown & Resource Management
    // -------------------------------------------------------------------------
    console.log('\n--- Test 7: Teardown & Resource Management ---');
    const deleteRes = await requestHttp(`${baseUrl}/api/broadcast/session`, { method: 'DELETE' });
    assert.strictEqual(deleteRes.statusCode, 200);
    assert.strictEqual(deleteRes.json.status, BroadcastState.IDLE);
    assert.strictEqual(broadcastService.status, BroadcastState.IDLE);
    assert.strictEqual(broadcastService.parserState, BroadcastState.IDLE);
    assert.strictEqual(broadcastService.ws, null);
    assert.strictEqual(broadcastService.slpStream, null);
    assert.strictEqual(broadcastService.pollTimer, null);
    assert.strictEqual(broadcastService._telemetryTimer, null);
    console.log('  ✔ DELETE /api/broadcast/session stopped session cleanly (all sockets and timers disposed)');

    // 7.2 Abrupt remote WebSocket disconnect cleanup
    await requestHttp(`${baseUrl}/api/broadcast/session`, {
      method: 'POST',
      body: { autoFollow: true, autoArchive: false },
    });
    assert.ok(broadcastService.pollTimer !== null, 'pollTimer must be active while session runs');
    assert.ok(broadcastService.sessionId !== null, 'sessionId must be populated');

    // Abruptly terminate from relay side
    for (const c of mockClients) {
      try { c.close(); } catch (_) {}
    }
    await sleep(60);

    assert.strictEqual(broadcastService.pollTimer, null, 'pollTimer must be cleared on abrupt remote disconnect');
    assert.strictEqual(broadcastService.sessionId, null, 'sessionId must be null on abrupt remote disconnect');
    assert.strictEqual(broadcastService.status, BroadcastState.IDLE, 'Status must reset to IDLE on disconnect');
    console.log('  ✔ Abrupt remote disconnect cleaned up pollTimer, sessionId, and reset to IDLE cleanly');

    // Zero disk accumulation check
    const tempDir = path.resolve('temp_slp');
    const slpFiles = fs.existsSync(tempDir) ? fs.readdirSync(tempDir).filter((f) => f.endsWith('.slp')) : [];
    assert.strictEqual(slpFiles.length, 0, `temp_slp must have 0 .slp files, found: ${slpFiles.join(', ')}`);
    console.log('  ✔ Zero disk accumulation verified: 0 remaining .slp files in temp_slp/');

    console.log('\n========================================================================');
    console.log('🎉 ALL TELEMETRY & INGESTION TESTS PASSED SUCCESSFULLY! 🎉');
    console.log('========================================================================');
  } finally {
    if (sse) sse.close();
    if (testServer) {
      await new Promise((r) => testServer.close(r));
    }
    if (mockRelayServer) {
      for (const c of mockClients) {
        try { c.close(); } catch (_) {}
      }
      await new Promise((r) => mockRelayServer.close(r));
    }
    if (archivedGameId) {
      try {
        const db = getDatabase();
        db.prepare('DELETE FROM player_mechanics_stats WHERE game_id = ?').run(archivedGameId);
        db.prepare('DELETE FROM game_players WHERE game_id = ?').run(archivedGameId);
        db.prepare('DELETE FROM replay_status WHERE file_hash = ?').run(archivedGameId);
        db.prepare('DELETE FROM games WHERE game_id = ?').run(archivedGameId);
      } catch (_) {}
    }
    if (archivedPayloadPath && fs.existsSync(archivedPayloadPath)) {
      try {
        fs.unlinkSync(archivedPayloadPath);
        const parentDir = path.dirname(archivedPayloadPath);
        if (fs.existsSync(parentDir) && fs.readdirSync(parentDir).length === 0) {
          fs.rmdirSync(parentDir);
        }
      } catch (_) {}
    }
    const credsPath = path.resolve('temp_slp/test_telemetry_credentials.json');
    try {
      if (fs.existsSync(credsPath)) fs.unlinkSync(credsPath);
    } catch (_) {}
  }
}

run().catch((err) => {
  console.error('\n❌ TEST SUITE FAILURE:', err);
  process.exit(1);
});
