/**
 * FlowState Melee Analysis Engine - Broadcast Spectator E2E Test Suite
 *
 * Implements verification across 6 core sections per PROJECT.md, AGENTS.md, and ORIGINAL_REQUEST.md:
 * Section 1: Session Provisioning & Retrieval (REST Lifecycle)
 * Section 2: Real-Time Stream Simulation & Immediate Extraction (<= 100ms)
 * Section 3: SSE Streaming & Event Dispatch
 * Section 4: Resource Cleanup & Port Disposal
 * Section 5: Zero Disk Accumulation
 * Section 6: Regression Verification & Runtime Compliance
 */

import assert from 'node:assert';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from '../src/server/server.js';
import { closeDatabase } from '../src/database/db.js';
import { getBroadcastService, resetBroadcastService, BroadcastState } from '../src/broadcast/broadcastService.js';

// Replay file paths
const REPLAY_UNRANKED = 'external/slippi-js-master/slp/unranked_game1.slp';
const REPLAY_4PLAYERS = 'external/slippi-js-master/slp/displayNameAndConnectCodeInGameStart.slp';

// Utility helper for HTTP requests using native node:http
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

/**
 * Cleanly disconnects a client socket and waits for the server to process the close event
 * and remove the socket from activeSockets.
 */
async function disconnectAndDrain(client, broadcast) {
  if (!client) return;
  try {
    client.destroy();
  } catch (_) {}
  const start = Date.now();
  while (broadcast.activeSockets.size > 0 && Date.now() - start < 1500) {
    await sleep(20);
  }
}

// SSE helper that connects to an event stream and collects parsed events
function openSseStream(url) {
  const events = [];
  let isClosed = false;
  let reqStream = null;

  const streamPromise = new Promise((resolve, reject) => {
    reqStream = http.request(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`SSE connection failed with status ${res.statusCode}`));
        return;
      }
      resolve();

      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n\n');
        buffer = lines.pop(); // keep remainder
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
      res.on('end', () => {
        isClosed = true;
      });
    });

    reqStream.on('error', (err) => {
      if (!isClosed) {
        // Only reject if disconnected unexpectedly before intentional close
      }
    });

    reqStream.end();
  });

  return {
    ready: streamPromise,
    events,
    close: () => {
      isClosed = true;
      if (reqStream) {
        try {
          reqStream.destroy();
        } catch (_) {}
      }
    },
    waitForEvent: async (predicate, timeoutMs = 2000) => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const found = events.find(predicate);
        if (found) return found;
        await sleep(20);
      }
      throw new Error(`Timed out after ${timeoutMs}ms waiting for SSE event`);
    },
  };
}

// Shared context across test sections
let testServer = null;
let serverPort = null;
let baseUrl = null;
let broadcastService = null;

/**
 * Section 1: Session Provisioning & Retrieval (REST Lifecycle)
 */
async function testSection1_SessionProvisioningAndRetrieval() {
  console.log('\n--- Section 1: Session Provisioning & Retrieval (REST Lifecycle) ---');

  // Reset and obtain singleton service
  resetBroadcastService();
  broadcastService = getBroadcastService();

  // 1.1 Start HTTP test server via createServer()
  testServer = createServer({ broadcastService });
  await new Promise((resolve) => testServer.listen(0, '127.0.0.1', resolve));
  serverPort = testServer.address().port;
  baseUrl = `http://127.0.0.1:${serverPort}`;
  console.log(`  ✔ Test server started on ${baseUrl}`);

  // 1.2 Initial GET /api/broadcast/session returns IDLE state
  const initialGetRes = await requestHttp(`${baseUrl}/api/broadcast/session`);
  assert.strictEqual(initialGetRes.statusCode, 200, 'Initial GET /api/broadcast/session must return 200');
  const initialSession = initialGetRes.json;
  assert.ok(initialSession, 'Response must be valid JSON');
  assert.strictEqual(initialSession.status, 'IDLE', 'Initial status must be IDLE');
  assert.strictEqual(initialSession.sessionId, null, 'Initial sessionId must be null');
  assert.strictEqual(initialSession.broadcastKey, null, 'Initial broadcastKey must be null');
  assert.strictEqual(initialSession.port, null, 'Initial port must be null');
  assert.strictEqual(initialSession.remotePeer, null, 'Initial remotePeer must be null');
  assert.strictEqual(initialSession.currentGame, null, 'Initial currentGame must be null');
  console.log('  ✔ Initial GET /api/broadcast/session returns IDLE state correctly');

  // 1.3 POST /api/broadcast/session creates session and provisions broadcast key
  const postRes = await requestHttp(`${baseUrl}/api/broadcast/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { port: 0, host: '127.0.0.1' },
  });
  assert.strictEqual(postRes.statusCode, 200, 'POST /api/broadcast/session must return 200');
  const createdSession = postRes.json;
  assert.ok(createdSession, 'Created session must be valid JSON');
  assert.strictEqual(createdSession.status, 'LISTENING', 'Status must transition to LISTENING');
  assert.ok(typeof createdSession.sessionId === 'string' && createdSession.sessionId.length > 0, 'sessionId must be non-empty string');
  assert.match(createdSession.sessionId, /^[0-9a-f-]{36}$/i, 'sessionId must be valid UUID');
  
  // Verify broadcast key conforms to SLP-XXXX-XXXX
  assert.ok(typeof createdSession.broadcastKey === 'string', 'broadcastKey must be string');
  assert.match(createdSession.broadcastKey, /^SLP-[0-9A-F]{4}-[0-9A-F]{4}$/, 'broadcastKey must match SLP-XXXX-XXXX format');
  
  // Verify port is a positive allocated integer
  assert.ok(Number.isInteger(createdSession.port) && createdSession.port > 0, 'port must be valid integer > 0');
  assert.strictEqual(createdSession.host, '127.0.0.1', 'host must match requested host');
  assert.ok(createdSession.instructions.includes('Open Slippi Launcher → Gameplay Broadcasts → Paste Broadcast Key → Start'),
    'instructions must contain canonical broadcaster setup steps');
  console.log(`  ✔ POST /api/broadcast/session created session: Key=${createdSession.broadcastKey}, Port=${createdSession.port}, Status=${createdSession.status}`);

  // 1.4 GET /api/broadcast/session returns active session details
  const activeGetRes = await requestHttp(`${baseUrl}/api/broadcast/session`);
  assert.strictEqual(activeGetRes.statusCode, 200, 'GET /api/broadcast/session must return 200 for active session');
  const activeSession = activeGetRes.json;
  assert.strictEqual(activeSession.sessionId, createdSession.sessionId, 'sessionId must match created session');
  assert.strictEqual(activeSession.broadcastKey, createdSession.broadcastKey, 'broadcastKey must match created session');
  assert.strictEqual(activeSession.status, 'LISTENING', 'status must be LISTENING');
  assert.strictEqual(activeSession.port, createdSession.port, 'port must match created session');
  assert.strictEqual(activeSession.instructions, createdSession.instructions, 'instructions must match');
  console.log('  ✔ GET /api/broadcast/session returns active session details correctly');
}

/**
 * Section 2: Real-Time Stream Simulation & Immediate Extraction (<= 100ms)
 */
async function testSection2_RealTimeStreamSimulationAndExtraction() {
  console.log('\n--- Section 2: Real-Time Stream Simulation & Immediate Extraction (<= 100ms) ---');

  const session = broadcastService.getSession();
  const tcpPort = session.port;
  assert.ok(tcpPort > 0, 'Active TCP port must be available');

  // --- Sub-test 2.1: Replay 1 (unranked_game1.slp - 2 Players, Battlefield) ---
  console.log('  Sub-test 2.1: Streaming unranked_game1.slp...');
  assert.ok(fs.existsSync(REPLAY_UNRANKED), `Replay file ${REPLAY_UNRANKED} must exist`);
  const slpBuffer1 = fs.readFileSync(REPLAY_UNRANKED);
  assert.ok(slpBuffer1.length > 0, 'Replay buffer must not be empty');

  let game1Data = null;
  const game1Promise = new Promise((resolve) => {
    broadcastService.once('gameStart', (game) => {
      game1Data = game;
      resolve();
    });
  });

  // Connect TCP client to session port
  const client1 = net.connect(tcpPort, '127.0.0.1');
  await new Promise((resolve) => client1.on('connect', resolve));

  // High-resolution measurement from transmission start to gameStart event
  const t0_game1 = performance.now();
  client1.write(slpBuffer1);
  await game1Promise;
  const elapsed1 = performance.now() - t0_game1;

  console.log(`    Extraction time for unranked_game1.slp: ${elapsed1.toFixed(2)}ms`);
  assert.ok(elapsed1 <= 100, `Extraction time must be <= 100ms (measured: ${elapsed1.toFixed(2)}ms)`);

  // Assert game metadata for unranked_game1.slp
  assert.ok(game1Data !== null, 'GAME_START event must produce non-null game data');
  assert.strictEqual(game1Data.stageId, 31, 'stageId must be 31 for Battlefield');
  assert.strictEqual(game1Data.stageName, 'Battlefield', 'canonical stageName must be "Battlefield"');
  assert.strictEqual(game1Data.players.length, 2, 'Must have exactly 2 active players');

  // Player 1 assertions
  const p1_g1 = game1Data.players.find((p) => p.port === 1);
  assert.ok(p1_g1, 'Player on port 1 must exist');
  assert.strictEqual(p1_g1.playerIndex, 0, 'Player 1 index must be 0');
  assert.strictEqual(p1_g1.connectCode, 'NIKK#513', 'Player 1 connectCode must be NIKK#513');
  assert.strictEqual(p1_g1.characterId, 20, 'Player 1 characterId must be 20 (Falco)');
  assert.strictEqual(p1_g1.characterName, 'Falco', 'Player 1 characterName must be "Falco"');
  assert.strictEqual(p1_g1.costumeIndex, 0, 'Player 1 costumeIndex must be 0');
  assert.strictEqual(p1_g1.displayName, 'Nikki Dev1', 'Player 1 displayName must be "Nikki Dev1"');

  // Player 2 assertions
  const p2_g1 = game1Data.players.find((p) => p.port === 2);
  assert.ok(p2_g1, 'Player on port 2 must exist');
  assert.strictEqual(p2_g1.playerIndex, 1, 'Player 2 index must be 1');
  assert.strictEqual(p2_g1.connectCode, 'NIKK#142', 'Player 2 connectCode must be NIKK#142');
  assert.strictEqual(p2_g1.characterId, 20, 'Player 2 characterId must be 20 (Falco)');
  assert.strictEqual(p2_g1.characterName, 'Falco', 'Player 2 characterName must be "Falco"');
  assert.strictEqual(p2_g1.costumeIndex, 0, 'Player 2 costumeIndex must be 0');
  assert.strictEqual(p2_g1.displayName, 'Nikki Dev2', 'Player 2 displayName must be "Nikki Dev2"');

  console.log(`    ✔ Replay 1 validated: ${game1Data.stageName} (Stage ${game1Data.stageId}), 2 Falcos (${p1_g1.connectCode} vs ${p2_g1.connectCode}) in ${elapsed1.toFixed(2)}ms`);

  // Disconnect client 1 and wait for cleanup
  await disconnectAndDrain(client1, broadcastService);

  // --- Sub-test 2.2: Replay 2 (displayNameAndConnectCodeInGameStart.slp - 4 Players, Pokémon Stadium) ---
  console.log('  Sub-test 2.2: Streaming displayNameAndConnectCodeInGameStart.slp (4 players)...');
  assert.ok(fs.existsSync(REPLAY_4PLAYERS), `Replay file ${REPLAY_4PLAYERS} must exist`);
  const slpBuffer2 = fs.readFileSync(REPLAY_4PLAYERS);
  assert.ok(slpBuffer2.length > 0, 'Replay buffer 2 must not be empty');

  let game2Data = null;
  const game2Promise = new Promise((resolve) => {
    broadcastService.once('gameStart', (game) => {
      game2Data = game;
      resolve();
    });
  });

  // Connect new simulated TCP client
  const client2 = net.connect(tcpPort, '127.0.0.1');
  await new Promise((resolve) => client2.on('connect', resolve));

  // High-resolution measurement from transmission start to gameStart event
  const t0_game2 = performance.now();
  client2.write(slpBuffer2);
  await game2Promise;
  const elapsed2 = performance.now() - t0_game2;

  console.log(`    Extraction time for displayNameAndConnectCodeInGameStart.slp: ${elapsed2.toFixed(2)}ms`);
  assert.ok(elapsed2 <= 100, `Extraction time must be <= 100ms (measured: ${elapsed2.toFixed(2)}ms)`);

  // Assert game metadata for displayNameAndConnectCodeInGameStart.slp
  assert.ok(game2Data !== null, 'GAME_START event must produce non-null game data for 4-player replay');
  assert.strictEqual(game2Data.stageId, 3, 'stageId must be 3 for Pokémon Stadium');
  assert.strictEqual(game2Data.stageName, 'Pokémon Stadium', 'canonical stageName must be "Pokémon Stadium"');
  assert.strictEqual(game2Data.players.length, 4, 'Must have exactly 4 active players');

  // Verify all 4 players' connect codes and character assignments
  const expectedPlayers = [
    { port: 1, connectCode: 'EKNS#442', characterId: 2, characterName: 'Fox', costumeIndex: 2, displayName: 'ekans' },
    { port: 2, connectCode: 'BAP#666', characterId: 0, characterName: 'Captain Falcon', costumeIndex: 2, displayName: "gaR's uncle" },
    { port: 3, connectCode: 'JMLE#166', characterId: 9, characterName: 'Marth', costumeIndex: 0, displayName: 'jmlee337' },
    { port: 4, connectCode: 'SUI#244', characterId: 20, characterName: 'Falco', costumeIndex: 1, displayName: 'Mr.SuiSui' },
  ];

  for (const exp of expectedPlayers) {
    const act = game2Data.players.find((p) => p.port === exp.port);
    assert.ok(act, `Active player on port ${exp.port} must exist`);
    assert.strictEqual(act.connectCode, exp.connectCode, `Port ${exp.port} connectCode must be ${exp.connectCode}`);
    assert.strictEqual(act.characterId, exp.characterId, `Port ${exp.port} characterId must be ${exp.characterId}`);
    assert.strictEqual(act.characterName, exp.characterName, `Port ${exp.port} characterName must be ${exp.characterName}`);
    assert.strictEqual(act.costumeIndex, exp.costumeIndex, `Port ${exp.port} costumeIndex must be ${exp.costumeIndex}`);
    assert.strictEqual(act.displayName, exp.displayName, `Port ${exp.port} displayName must be "${exp.displayName}"`);
  }

  console.log(`    ✔ Replay 2 validated: ${game2Data.stageName} (Stage ${game2Data.stageId}), 4 players (${expectedPlayers.map(p => p.connectCode).join(', ')}) in ${elapsed2.toFixed(2)}ms`);

  // Disconnect client 2 and wait for full cleanup
  await disconnectAndDrain(client2, broadcastService);
}

/**
 * Section 3: SSE Streaming & Event Dispatch
 */
async function testSection3_SSEStreamingAndEventDispatch() {
  console.log('\n--- Section 3: SSE Streaming & Event Dispatch ---');

  // Verify service returned to LISTENING with 0 active sockets before starting SSE tests
  assert.strictEqual(broadcastService.status, 'LISTENING', 'Broadcast service must be in LISTENING state before SSE test');
  assert.strictEqual(broadcastService.activeSockets.size, 0, 'No sockets should be active before SSE test');

  // 3.1 Connect SSE consumer to GET /api/broadcast/events
  const sseUrl = `${baseUrl}/api/broadcast/events`;
  const sseClient = openSseStream(sseUrl);
  await sseClient.ready;
  console.log('  ✔ Connected to GET /api/broadcast/events');

  let testClient = null;
  try {
    // 3.2 Verify initial 'session' event is emitted immediately upon SSE connection
    const sessionEvent = await sseClient.waitForEvent((e) => e.type === 'session', 1000);
    assert.ok(sessionEvent, 'SSE must immediately emit initial "session" event');
    assert.ok(sessionEvent.broadcastKey, 'session event must include active broadcastKey');
    console.log(`  ✔ Received initial SSE 'session' event (Key: ${sessionEvent.broadcastKey}, Status: ${sessionEvent.status})`);

    // 3.3 Connect TCP client to trigger 'statusChange' -> CONNECTED
    const session = broadcastService.getSession();
    testClient = net.connect(session.port, '127.0.0.1');
    await new Promise((resolve) => testClient.on('connect', resolve));

    const statusConnectedEvent = await sseClient.waitForEvent(
      (e) => e.type === 'statusChange' && e.status === 'CONNECTED',
      1000
    );
    assert.ok(statusConnectedEvent, 'SSE must emit statusChange with status=CONNECTED on client connection');
    console.log('  ✔ Received SSE statusChange event: CONNECTED');

    // 3.4 Stream game buffer to trigger 'gameStart' event and 'statusChange' -> IN_GAME
    const slpBuffer = fs.readFileSync(REPLAY_UNRANKED);
    testClient.write(slpBuffer);

    const gameStartEvent = await sseClient.waitForEvent((e) => e.type === 'gameStart', 1500);
    assert.ok(gameStartEvent, 'SSE must emit gameStart event upon replay game start');
    assert.strictEqual(gameStartEvent.stageId, 31, 'SSE gameStart event stageId must be 31');
    assert.strictEqual(gameStartEvent.stageName, 'Battlefield', 'SSE gameStart event stageName must be Battlefield');
    assert.strictEqual(gameStartEvent.players.length, 2, 'SSE gameStart event must include 2 players');
    console.log(`  ✔ Received SSE gameStart event: ${gameStartEvent.stageName} with ${gameStartEvent.players.length} players`);

    const statusInGameEvent = await sseClient.waitForEvent(
      (e) => e.type === 'statusChange' && e.status === 'IN_GAME',
      1000
    );
    assert.ok(statusInGameEvent, 'SSE must emit statusChange with status=IN_GAME');
    console.log('  ✔ Received SSE statusChange event: IN_GAME');

    // 3.5 Disconnect TCP client to trigger 'gameEnd' event and 'statusChange' -> LISTENING
    await disconnectAndDrain(testClient, broadcastService);
    testClient = null;

    const gameEndEvent = await sseClient.waitForEvent((e) => e.type === 'gameEnd', 1500);
    assert.ok(gameEndEvent, 'SSE must emit gameEnd event upon client disconnect during game');
    console.log('  ✔ Received SSE gameEnd event successfully');
  } finally {
    if (testClient) {
      await disconnectAndDrain(testClient, broadcastService);
    }
    sseClient.close();
    await sleep(50);
  }

  console.log('  ✔ Section 3 SSE streaming and real-time event dispatch fully verified');
}

/**
 * Section 4: Resource Cleanup & Port Disposal
 */
async function testSection4_ResourceCleanupAndPortDisposal() {
  console.log('\n--- Section 4: Resource Cleanup & Port Disposal ---');

  const currentSession = broadcastService.getSession();
  const tcpPortToRelease = currentSession.port;
  assert.ok(tcpPortToRelease > 0, 'TCP port must be positive integer');

  // Connect a dummy TCP client to prove socket disposal on session deletion
  const dummyClient = net.connect(tcpPortToRelease, '127.0.0.1');
  await new Promise((resolve) => dummyClient.on('connect', resolve));
  assert.strictEqual(broadcastService.activeSockets.size, 1, 'Should have 1 active client socket before DELETE');

  // Set up promise to observe client socket termination
  const clientClosedPromise = new Promise((resolve) => dummyClient.on('close', resolve));

  // 4.1 Send DELETE /api/broadcast/session
  const deleteRes = await requestHttp(`${baseUrl}/api/broadcast/session`, { method: 'DELETE' });
  assert.strictEqual(deleteRes.statusCode, 200, 'DELETE /api/broadcast/session must return HTTP 200');
  const deleteBody = deleteRes.json;
  assert.strictEqual(deleteBody.status, 'IDLE', 'Response status must be IDLE');
  assert.ok(deleteBody.message.includes('Session stopped and resources released'), 'Response must confirm release');
  console.log('  ✔ DELETE /api/broadcast/session returned HTTP 200 with status=IDLE');

  // 4.2 Verify client socket destruction
  await clientClosedPromise;
  assert.strictEqual(dummyClient.destroyed, true, 'Client socket must be destroyed after session deletion');
  assert.strictEqual(broadcastService.activeSockets.size, 0, 'activeSockets Set must be cleared (size === 0)');
  assert.strictEqual(broadcastService.tcpServer, null, 'tcpServer reference must be set to null');
  console.log('  ✔ All active client sockets destroyed and server reference cleared');

  // 4.3 Verify immediate re-bind of the same TCP port succeeds with zero EADDRINUSE
  const probeServer = net.createServer();
  let rebindError = null;

  await new Promise((resolve, reject) => {
    probeServer.once('error', (err) => {
      rebindError = err;
      reject(err);
    });

    probeServer.listen(tcpPortToRelease, '127.0.0.1', () => {
      resolve();
    });
  }).catch((err) => {
    rebindError = err;
  });

  assert.strictEqual(rebindError, null, `Immediate rebind on port ${tcpPortToRelease} must not throw EADDRINUSE: ${rebindError?.message}`);
  const boundAddress = probeServer.address();
  assert.ok(boundAddress && boundAddress.port === tcpPortToRelease, 'Probe server must be bound to original port');
  console.log(`  ✔ Immediate re-bind to port ${tcpPortToRelease} succeeded with zero EADDRINUSE (clean disposal proven)`);

  // Close probe server
  await new Promise((resolve) => probeServer.close(resolve));

  // 4.4 Verify GET /api/broadcast/session confirms state returned to IDLE
  const postDeleteGetRes = await requestHttp(`${baseUrl}/api/broadcast/session`);
  assert.strictEqual(postDeleteGetRes.statusCode, 200);
  assert.strictEqual(postDeleteGetRes.json.status, 'IDLE');
  assert.strictEqual(postDeleteGetRes.json.port, null);
  assert.strictEqual(postDeleteGetRes.json.broadcastKey, null);
  console.log('  ✔ GET /api/broadcast/session confirms status is IDLE after cleanup');
}

/**
 * Section 5: Zero Disk Accumulation
 */
async function testSection5_ZeroDiskAccumulation() {
  console.log('\n--- Section 5: Zero Disk Accumulation ---');

  const tempSlpDir = path.resolve('./temp_slp');
  assert.ok(fs.existsSync(tempSlpDir), 'temp_slp directory must exist');

  // 5.1 Inspect directory contents directly
  const files = fs.readdirSync(tempSlpDir);
  const slpFiles = files.filter((f) => f.endsWith('.slp'));
  console.log(`  Inspecting ${tempSlpDir}: found ${files.length} total entries, ${slpFiles.length} .slp files`);
  assert.strictEqual(slpFiles.length, 0, `temp_slp must contain zero .slp files (found: ${slpFiles.join(', ')})`);
  console.log('  ✔ temp_slp/ contains 0 .slp files on disk');

  // 5.2 Query Pipeline Status API to confirm infrastructure reporting
  const pipelineRes = await requestHttp(`${baseUrl}/api/pipeline/status`);
  if (pipelineRes.statusCode === 200 && pipelineRes.json) {
    assert.strictEqual(pipelineRes.json.tempSlpCount, 0, 'Pipeline telemetry must report tempSlpCount === 0');
    console.log(`  ✔ Pipeline status reports tempSlpCount=0`);
  }

  // 5.3 Query Storage Footprint API to confirm zero accumulation
  const storageRes = await requestHttp(`${baseUrl}/api/storage/footprint`);
  if (storageRes.statusCode === 200 && storageRes.json) {
    assert.strictEqual(storageRes.json.tempSlpZero, true, 'Storage footprint must report tempSlpZero === true');
    console.log(`  ✔ Storage footprint reports tempSlpZero=true`);
  }

  console.log('  ✔ Zero disk accumulation verified: live stream ingested exclusively in-memory');
}

/**
 * Section 6: Regression Verification & Runtime Compliance
 */
async function testSection6_RegressionVerificationAndRuntimeCompliance() {
  console.log('\n--- Section 6: Regression Verification & Runtime Compliance ---');

  // Teardown the section test HTTP server so ports are completely free
  if (testServer) {
    if (typeof testServer.closeAllConnections === 'function') {
      testServer.closeAllConnections();
    }
    await new Promise((resolve) => testServer.close(resolve));
    testServer = null;
    console.log('  ✔ Test HTTP server closed cleanly');
  }
  resetBroadcastService();

  // Run npm test to verify full regression safety
  console.log('  Executing regression check: npm test (stage1_local_test.js & server_test.js)...');
  const npmTestResult = await new Promise((resolve, reject) => {
    const child = spawn('npm', ['test'], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
    child.on('error', reject);
  });

  if (npmTestResult.code !== 0) {
    console.error('npm test failed with output:');
    console.error(npmTestResult.stdout);
    console.error(npmTestResult.stderr);
  }
  assert.strictEqual(npmTestResult.code, 0, `npm test must pass with exit code 0 (got ${npmTestResult.code})`);
  console.log('  ✔ npm test passed cleanly with code 0 (zero regressions across local engine, storage, and server)');
}

/**
 * Main Test Runner
 */
async function runSuite() {
  console.log('========================================================================');
  console.log('⚡ FLOWSTATE MELEE: BROADCAST SPECTATOR COMPREHENSIVE TEST SUITE (M3) ⚡');
  console.log('========================================================================');

  const sections = [
    { name: 'Section 1: Session Provisioning & Retrieval (REST Lifecycle)', fn: testSection1_SessionProvisioningAndRetrieval },
    { name: 'Section 2: Real-Time Stream Simulation & Immediate Extraction (<= 100ms)', fn: testSection2_RealTimeStreamSimulationAndExtraction },
    { name: 'Section 3: SSE Streaming & Event Dispatch', fn: testSection3_SSEStreamingAndEventDispatch },
    { name: 'Section 4: Resource Cleanup & Port Disposal', fn: testSection4_ResourceCleanupAndPortDisposal },
    { name: 'Section 5: Zero Disk Accumulation', fn: testSection5_ZeroDiskAccumulation },
    { name: 'Section 6: Regression Verification & Runtime Compliance', fn: testSection6_RegressionVerificationAndRuntimeCompliance },
  ];

  const passed = [];
  const failed = [];

  for (const section of sections) {
    try {
      await section.fn();
      passed.push(section.name);
    } catch (err) {
      console.error(`\n  ✖ ${section.name} FAILED: ${err.message}`);
      if (err.stack) {
        const stackLines = err.stack.split('\n').slice(1, 5).join('\n');
        console.error(`    ${stackLines}`);
      }
      failed.push({ name: section.name, error: err });
    }
  }

  // Cleanup any lingering resources
  try {
    if (testServer) {
      if (typeof testServer.closeAllConnections === 'function') {
        testServer.closeAllConnections();
      }
      await new Promise((r) => testServer.close(r));
    }
    resetBroadcastService();
    closeDatabase();
  } catch (_) {}

  console.log('\n========================================================================');
  console.log(`SUITE EXECUTION SUMMARY: ${passed.length} Passed, ${failed.length} Failed out of ${sections.length} Sections`);
  console.log('========================================================================');

  if (failed.length > 0) {
    console.error('\nFailed Sections:');
    for (const f of failed) {
      console.error(`- ${f.name}: ${f.error.message}`);
    }
    process.exit(1);
  } else {
    console.log('All 6 test sections passed successfully!');
    process.exit(0);
  }
}

runSuite().catch((err) => {
  console.error('Fatal Test Suite Error:', err);
  process.exit(1);
});
