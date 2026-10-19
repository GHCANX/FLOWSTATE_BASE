import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { createServer } from '../src/server/server.js';
import { closeDatabase } from '../src/database/db.js';
import { getBroadcastService, resetBroadcastService, BroadcastState } from '../src/broadcast/broadcastService.js';

async function req(url, options = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request(url, options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    r.on('error', reject);
    if (options.body) r.write(options.body);
    r.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runChallenges() {
  console.log('=== STARTING EMPIRICAL CHALLENGES: MILESTONE M1 ===\n');
  const results = {
    challenge1_fragmentation: {},
    challenge2_corruption: {},
    challenge3_sse: {},
  };

  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const serverPort = server.address().port;
  const baseUrl = `http://127.0.0.1:${serverPort}`;

  const slpBuffer = fs.readFileSync('external/slippi-js-master/slp/unranked_game1.slp');
  // Raw stream slice starting from byte 15 (0x35) up to 2048 bytes (contains MESSAGE_SIZES 0x35 and GAME_START 0x36)
  const rawGameStart = slpBuffer.subarray(15, 2048);
  // Full SLP buffer including 15-byte UBJSON prefix
  const slpWithUbjson = slpBuffer.subarray(0, 2048);

  try {
    // =========================================================================
    // CHALLENGE 1: Chunk Fragmentation
    // =========================================================================
    console.log('--- CHALLENGE 1: Chunk Fragmentation ---');

    async function testChunking(label, data, chunkSize, delayMs) {
      // 1. Reset broadcast session
      await req(`${baseUrl}/api/broadcast/session`, { method: 'DELETE' });
      const postRes = await req(`${baseUrl}/api/broadcast/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 0 }),
      });
      const session = JSON.parse(postRes.body);
      const tcpPort = session.port;

      const broadcast = getBroadcastService();
      let gameStartReceived = false;
      let gameStartData = null;
      const onGameStart = (game) => {
        gameStartReceived = true;
        gameStartData = game;
      };
      broadcast.once('gameStart', onGameStart);

      // Connect TCP client and send chunks with delay
      const client = net.connect(tcpPort, '127.0.0.1');
      await new Promise((resolve) => client.on('connect', resolve));

      for (let i = 0; i < data.length; i += chunkSize) {
        const chunk = data.subarray(i, Math.min(i + chunkSize, data.length));
        client.write(chunk);
        if (delayMs > 0) {
          await sleep(delayMs);
        }
      }

      // Wait up to 1000ms for gameStart event
      const waitStart = Date.now();
      while (!gameStartReceived && Date.now() - waitStart < 1000) {
        await sleep(20);
      }

      broadcast.off('gameStart', onGameStart);
      client.destroy();

      const passed = gameStartReceived && gameStartData !== null && gameStartData.stageName === 'Battlefield';
      console.log(`  [${passed ? 'PASS' : 'FAIL'}] ${label} (chunkSize=${chunkSize}, delay=${delayMs}ms) -> gameStartReceived=${gameStartReceived}`);
      return { passed, gameStartReceived, gameStartData };
    }

    // 1A. Raw stream (starting with 0x35)
    results.challenge1_fragmentation['raw_32_bytes'] = await testChunking('Raw stream 32-byte chunks', rawGameStart, 32, 2);
    results.challenge1_fragmentation['raw_7_bytes'] = await testChunking('Raw stream 7-byte chunks', rawGameStart, 7, 2);
    results.challenge1_fragmentation['raw_1_byte'] = await testChunking('Raw stream 1-byte chunks', rawGameStart, 1, 1);

    // 1B. UBJSON-prefixed stream (.slp on disk format starting with 0x7B)
    results.challenge1_fragmentation['ubjson_32_bytes'] = await testChunking('UBJSON stream 32-byte chunks', slpWithUbjson, 32, 2);
    results.challenge1_fragmentation['ubjson_7_bytes'] = await testChunking('UBJSON stream 7-byte chunks', slpWithUbjson, 7, 2);
    results.challenge1_fragmentation['ubjson_1_byte'] = await testChunking('UBJSON stream 1-byte chunks', slpWithUbjson, 1, 1);

    // =========================================================================
    // CHALLENGE 2: Malformed / Corrupted Stream
    // =========================================================================
    console.log('\n--- CHALLENGE 2: Malformed / Corrupted Stream ---');

    async function testCorruption(label, corruptDataGenerator) {
      await req(`${baseUrl}/api/broadcast/session`, { method: 'DELETE' });
      const postRes = await req(`${baseUrl}/api/broadcast/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 0 }),
      });
      const session = JSON.parse(postRes.body);
      const tcpPort = session.port;

      const broadcast = getBroadcastService();
      let streamErrorFired = false;
      const onError = () => { streamErrorFired = true; };
      broadcast.on('streamError', onError);

      const client = net.connect(tcpPort, '127.0.0.1');
      await new Promise((resolve) => client.on('connect', resolve));

      const payload = corruptDataGenerator();
      client.write(payload);
      await sleep(100);
      client.destroy();
      await sleep(50);

      broadcast.off('streamError', onError);

      // Verify server is still alive and responsive via HTTP
      const checkRes = await req(`${baseUrl}/api/broadcast/session`);
      const alive = checkRes.status === 200;
      const parsedSession = JSON.parse(checkRes.body);

      // Verify that after corruption, a new valid stream can connect and work
      const validClient = net.connect(tcpPort, '127.0.0.1');
      let recovered = false;
      const onRecoverGame = () => { recovered = true; };
      broadcast.once('gameStart', onRecoverGame);
      await new Promise((resolve) => validClient.on('connect', resolve));
      validClient.write(rawGameStart);
      const waitStart = Date.now();
      while (!recovered && Date.now() - waitStart < 800) {
        await sleep(20);
      }
      broadcast.off('gameStart', onRecoverGame);
      validClient.destroy();

      console.log(`  [${alive ? 'PASS' : 'FAIL'}] ${label}: Server alive=${alive}, RecoveredValidGame=${recovered}`);
      return { alive, recovered, streamErrorFired, sessionStatus: parsedSession.status };
    }

    results.challenge2_corruption['random_noise'] = await testCorruption('1KB Pure Random Noise', () => crypto.randomBytes(1024));
    results.challenge2_corruption['invalid_opcodes'] = await testCorruption('Invalid Opcodes (0xFF, 0x00, 0xFE, 0x99)', () => Buffer.from([0xff, 0x00, 0xfe, 0x99, 0xaa, 0xbb, 0xcc]));
    results.challenge2_corruption['truncated_header'] = await testCorruption('Truncated 0x35 header (only 3 bytes)', () => Buffer.from([0x35, 0x1c, 0x36]));

    // =========================================================================
    // CHALLENGE 3: SSE Streaming Stability & Leak Detection
    // =========================================================================
    console.log('\n--- CHALLENGE 3: SSE Streaming Stability & Leak Detection ---');

    await req(`${baseUrl}/api/broadcast/session`, { method: 'DELETE' });
    const postRes = await req(`${baseUrl}/api/broadcast/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port: 0 }),
    });
    const session = JSON.parse(postRes.body);
    const tcpPort = session.port;
    const broadcast = getBroadcastService();

    const baselineListeners = {
      statusChange: broadcast.listenerCount('statusChange'),
      gameStart: broadcast.listenerCount('gameStart'),
      gameEnd: broadcast.listenerCount('gameEnd'),
    };
    console.log('  Baseline listener counts on broadcastService:', baselineListeners);

    // Connect 5 concurrent SSE consumers
    const CONSUMER_COUNT = 5;
    const consumers = [];

    function connectSSEConsumer(id) {
      const received = [];
      const reqStream = http.request(`${baseUrl}/api/broadcast/events`, (res) => {
        let buf = '';
        res.on('data', (c) => {
          buf += c.toString('utf8');
          const lines = buf.split('\n\n');
          buf = lines.pop();
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line.replace(/^data:\s*/, ''));
              received.push(parsed);
            } catch (_) {}
          }
        });
      });
      reqStream.end();
      return { id, reqStream, received };
    }

    for (let i = 0; i < CONSUMER_COUNT; i++) {
      consumers.push(connectSSEConsumer(i + 1));
    }

    await sleep(150);

    const listenersWith5Consumers = {
      statusChange: broadcast.listenerCount('statusChange'),
      gameStart: broadcast.listenerCount('gameStart'),
      gameEnd: broadcast.listenerCount('gameEnd'),
    };
    console.log('  Listeners with 5 active SSE consumers:', listenersWith5Consumers);
    assert.strictEqual(listenersWith5Consumers.gameStart, baselineListeners.gameStart + 5, 'Must have 5 extra listeners');

    // Trigger gameStart via TCP
    const client = net.connect(tcpPort, '127.0.0.1');
    await new Promise((r) => client.on('connect', r));
    client.write(rawGameStart);

    await sleep(300);

    // Verify all 5 consumers received gameStart
    let allReceivedGameStart = true;
    for (const c of consumers) {
      const hasGameStart = c.received.some((e) => e.type === 'gameStart' && e.stageName === 'Battlefield');
      if (!hasGameStart) allReceivedGameStart = false;
    }
    console.log(`  All 5 consumers received gameStart: ${allReceivedGameStart}`);

    // Disconnect 3 consumers
    consumers[0].reqStream.destroy();
    consumers[1].reqStream.destroy();
    consumers[2].reqStream.destroy();

    await sleep(150);

    const listenersWith2Consumers = {
      statusChange: broadcast.listenerCount('statusChange'),
      gameStart: broadcast.listenerCount('gameStart'),
      gameEnd: broadcast.listenerCount('gameEnd'),
    };
    console.log('  Listeners after disconnecting 3 consumers:', listenersWith2Consumers);
    const leakFree = (listenersWith2Consumers.gameStart === baselineListeners.gameStart + 2);
    console.log(`  No listener leak detected: ${leakFree} (expected ${baselineListeners.gameStart + 2}, got ${listenersWith2Consumers.gameStart})`);

    // Disconnect the remaining 2 consumers
    consumers[3].reqStream.destroy();
    consumers[4].reqStream.destroy();
    await sleep(150);

    const listenersAfterAllDisconnect = {
      statusChange: broadcast.listenerCount('statusChange'),
      gameStart: broadcast.listenerCount('gameStart'),
      gameEnd: broadcast.listenerCount('gameEnd'),
    };
    console.log('  Listeners after all consumers disconnected:', listenersAfterAllDisconnect);
    const fullyClean = (listenersAfterAllDisconnect.gameStart === baselineListeners.gameStart);
    console.log(`  Returned completely to baseline: ${fullyClean}`);

    client.destroy();

    results.challenge3_sse = {
      allReceivedGameStart,
      listenersWith5Consumers,
      listenersWith2Consumers,
      leakFree,
      fullyClean,
    };

    console.log('\n=== EMPIRICAL RESULTS SUMMARY ===');
    console.log(JSON.stringify(results, null, 2));

  } finally {
    server.close();
    closeDatabase();
    resetBroadcastService();
  }
}

runChallenges().catch((err) => {
  console.error('CHALLENGE RUNNER FATAL ERROR:', err);
  process.exit(1);
});
