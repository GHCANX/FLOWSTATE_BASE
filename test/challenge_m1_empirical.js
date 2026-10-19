import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { createServer } from '../src/server/server.js';
import { closeDatabase } from '../src/database/db.js';
import { getBroadcastService, resetBroadcastService, BroadcastState } from '../src/broadcast/broadcastService.js';

// HTTP helper
async function requestHttp(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (_) {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data,
          json,
        });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// SSE helper that captures events until closed
function connectSse(baseUrl) {
  const events = [];
  let sseReq = null;
  const readyPromise = new Promise((resolve, reject) => {
    sseReq = http.request(`${baseUrl}/api/broadcast/events`, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`SSE connection failed with status ${res.statusCode}`));
        return;
      }
      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        const parts = buffer.split('\n\n');
        buffer = parts.pop();
        for (const part of parts) {
          if (!part.trim()) continue;
          const match = part.match(/^data:\s*(.*)$/m);
          if (match) {
            try {
              events.push(JSON.parse(match[1]));
            } catch (err) {
              // ignore parse errors
            }
          }
        }
      });
      resolve();
    });
    sseReq.on('error', (err) => {
      // ignore abort errors on teardown
    });
    sseReq.end();
  });

  return {
    readyPromise,
    events,
    close: () => {
      if (sseReq) {
        try {
          sseReq.destroy();
        } catch (_) {}
      }
    },
  };
}

// Probe helper to verify port is released and immediately rebindable
async function assertPortRebindable(port, host = '127.0.0.1') {
  const probe = net.createServer();
  return new Promise((resolve, reject) => {
    probe.once('error', (err) => {
      reject(new Error(`Port ${port} failed to rebind: ${err.code} ${err.message}`));
    });
    probe.listen(port, host, () => {
      probe.close((err) => {
        if (err) reject(err);
        else resolve(true);
      });
    });
  });
}

// Check disk for any slp files in target dirs
function checkSlpAccumulation(dirs = ['temp_slp', '.']) {
  const found = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.slp')) {
        found.push(path.join(dir, entry.name));
      }
    }
  }
  return found;
}

async function runEmpiricalChallenge() {
  console.log('======================================================================');
  console.log('   EMPIRICAL CHALLENGE SUITE: MILESTONE M1 (INGESTION & APIS)        ');
  console.log('======================================================================\n');

  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const serverPort = server.address().port;
  const baseUrl = `http://127.0.0.1:${serverPort}`;
  const broadcastService = getBroadcastService();

  let totalAssertions = 0;
  let passedAssertions = 0;

  function assertCheck(cond, message) {
    totalAssertions++;
    if (!cond) {
      console.error(`  ❌ FAILED: ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
    passedAssertions++;
  }

  try {
    // -------------------------------------------------------------------------
    // CHALLENGE 1: LIFECYCLE CHURN & PORT REBIND RESILIENCE
    // -------------------------------------------------------------------------
    console.log('--- CHALLENGE 1: Lifecycle Churn & Immediate Port Release ---');

    // 1.1 Dynamic Port Churn (15 cycles)
    console.log('  1.1 Rapid start-query-stop churn on dynamic ports (15 cycles)...');
    for (let cycle = 1; cycle <= 15; cycle++) {
      // Start session
      const startRes = await requestHttp(`${baseUrl}/api/broadcast/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 0 }),
      });
      assertCheck(startRes.statusCode === 200, `Cycle ${cycle}: POST /api/broadcast/session HTTP 200`);
      assertCheck(startRes.json.status === BroadcastState.LISTENING, `Cycle ${cycle}: status is LISTENING`);
      assertCheck(typeof startRes.json.port === 'number' && startRes.json.port > 0, `Cycle ${cycle}: valid port assigned`);
      assertCheck(/^SLP-[A-F0-9]{4}-[A-F0-9]{4}$/.test(startRes.json.broadcastKey), `Cycle ${cycle}: broadcastKey format valid`);

      const assignedPort = startRes.json.port;

      // Query session
      const getRes = await requestHttp(`${baseUrl}/api/broadcast/session`);
      assertCheck(getRes.statusCode === 200, `Cycle ${cycle}: GET /api/broadcast/session HTTP 200`);
      assertCheck(getRes.json.sessionId === startRes.json.sessionId, `Cycle ${cycle}: sessionId matches`);
      assertCheck(getRes.json.port === assignedPort, `Cycle ${cycle}: port matches`);

      // Stop session
      const stopRes = await requestHttp(`${baseUrl}/api/broadcast/session`, { method: 'DELETE' });
      assertCheck(stopRes.statusCode === 200, `Cycle ${cycle}: DELETE /api/broadcast/session HTTP 200`);
      assertCheck(stopRes.json.status === BroadcastState.IDLE, `Cycle ${cycle}: returned status IDLE`);

      // Verify query returns IDLE
      const getAfterStop = await requestHttp(`${baseUrl}/api/broadcast/session`);
      assertCheck(getAfterStop.json.status === BroadcastState.IDLE, `Cycle ${cycle}: GET after stop is IDLE`);

      // Verify port immediately released and rebindable
      await assertPortRebindable(assignedPort);
    }
    console.log('    ✔ 15/15 dynamic port churn cycles passed cleanly with zero EADDRINUSE.');

    // 1.2 Fixed Port Churn on Same Port (15 cycles)
    const fixedTestPort = 51448;
    console.log(`  1.2 Rapid start-query-stop churn on FIXED port ${fixedTestPort} (15 cycles)...`);
    for (let cycle = 1; cycle <= 15; cycle++) {
      const startRes = await requestHttp(`${baseUrl}/api/broadcast/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: fixedTestPort }),
      });
      assertCheck(startRes.statusCode === 200, `Fixed cycle ${cycle}: POST HTTP 200`);
      assertCheck(startRes.json.port === fixedTestPort, `Fixed cycle ${cycle}: port is ${fixedTestPort}`);

      const stopRes = await requestHttp(`${baseUrl}/api/broadcast/session`, { method: 'DELETE' });
      assertCheck(stopRes.statusCode === 200, `Fixed cycle ${cycle}: DELETE HTTP 200`);

      // Verify immediate rebindability on fixed port
      await assertPortRebindable(fixedTestPort);
    }
    console.log(`    ✔ 15/15 fixed port (${fixedTestPort}) churn cycles passed cleanly.`);

    // 1.3 Rapid Restart Churn WITHOUT calling DELETE first
    console.log('  1.3 Rapid session restart without calling DELETE (10 cycles)...');
    let lastPort = null;
    for (let cycle = 1; cycle <= 10; cycle++) {
      const startRes = await requestHttp(`${baseUrl}/api/broadcast/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: fixedTestPort }),
      });
      assertCheck(startRes.statusCode === 200, `Restart cycle ${cycle}: POST HTTP 200`);
      assertCheck(startRes.json.status === BroadcastState.LISTENING, `Restart cycle ${cycle}: status LISTENING`);
      lastPort = startRes.json.port;
    }
    // Final cleanup of restart churn
    const cleanupRes = await requestHttp(`${baseUrl}/api/broadcast/session`, { method: 'DELETE' });
    assertCheck(cleanupRes.statusCode === 200, 'Restart churn cleanup DELETE HTTP 200');
    await assertPortRebindable(lastPort);
    console.log('    ✔ Rapid restart without DELETE cleanly tears down previous instances.');

    // 1.4 Redundant DELETE calls
    console.log('  1.4 Idempotent / Redundant DELETE calls on IDLE state...');
    const del1 = await requestHttp(`${baseUrl}/api/broadcast/session`, { method: 'DELETE' });
    assertCheck(del1.statusCode === 200, 'First redundant DELETE returns 200');
    const del2 = await requestHttp(`${baseUrl}/api/broadcast/session`, { method: 'DELETE' });
    assertCheck(del2.statusCode === 200, 'Second redundant DELETE returns 200');
    assertCheck(del2.json.status === BroadcastState.IDLE, 'Status remains IDLE');
    console.log('    ✔ Idempotent DELETE handled gracefully.\n');

    // -------------------------------------------------------------------------
    // CHALLENGE 2: EXTRACTION LATENCY & DATA FIDELITY (<= 100ms)
    // -------------------------------------------------------------------------
    console.log('--- CHALLENGE 2: Extraction Latency & Metadata Precision (<= 100ms) ---');

    const sampleReplays = [
      {
        path: 'external/slippi-js-master/slp/unranked_game1.slp',
        name: 'unranked_game1.slp',
        expectedStage: 31,
        expectedStageName: 'Battlefield',
        expectedPlayerCount: 2,
        expectedConnectCodes: ['NIKK#513', 'NIKK#142'],
      },
      {
        path: 'external/slippi-js-master/slp/displayNameAndConnectCodeInGameStart.slp',
        name: 'displayNameAndConnectCodeInGameStart.slp',
        expectedStage: 3,
        expectedStageName: 'Pokémon Stadium',
        expectedPlayerCount: 4,
        expectedConnectCodes: ['EKNS#442', 'BAP#666', 'JMLE#166', 'SUI#244'],
      },
      {
        path: 'external/slippi-js-master/slp/doubles.slp',
        name: 'doubles.slp',
        expectedStage: 31,
        expectedStageName: 'Battlefield',
        expectedPlayerCount: 4,
        isTeams: true,
      },
      {
        path: 'external/slippi-js-master/slp/ranked_game1_tiebreak.slp',
        name: 'ranked_game1_tiebreak.slp',
        expectedStage: 31,
        expectedStageName: 'Battlefield',
        expectedPlayerCount: 2,
      },
      {
        path: 'external/slippi-js-master/slp/realtimeTest.slp',
        name: 'realtimeTest.slp',
        expectedStage: 8,
        expectedStageName: "Yoshi's Story",
        expectedPlayerCount: 2,
      },
    ];

    for (const sample of sampleReplays) {
      if (!fs.existsSync(sample.path)) {
        console.warn(`    ⚠️ File not found: ${sample.path}, skipping.`);
        continue;
      }

      const fileBuffer = fs.readFileSync(sample.path);

      // Start fresh session
      const startRes = await requestHttp(`${baseUrl}/api/broadcast/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 0 }),
      });
      const broadcastPort = startRes.json.port;

      // Connect SSE listener
      const sse = connectSse(baseUrl);
      await sse.readyPromise;
      // Small pause for SSE pipe registration
      await new Promise((r) => setTimeout(r, 20));

      // Connect TCP client and measure extraction latency
      let gameStartReceived = null;
      let latencyMs = 0;

      const client = net.connect(broadcastPort, '127.0.0.1');
      await new Promise((resolve) => client.once('connect', resolve));

      const writeStart = performance.now();
      // Send first 8192 bytes (which contains GameStart metadata)
      client.write(fileBuffer.subarray(0, Math.min(fileBuffer.length, 8192)));

      // Wait for gameStart event in SSE
      const deadline = Date.now() + 1000;
      while (Date.now() < deadline) {
        const found = sse.events.find((e) => e.type === 'gameStart');
        if (found) {
          latencyMs = performance.now() - writeStart;
          gameStartReceived = found;
          break;
        }
        await new Promise((r) => setTimeout(r, 5));
      }

      client.destroy();
      sse.close();

      assertCheck(gameStartReceived !== null, `${sample.name}: Must receive gameStart event via SSE`);
      assertCheck(
        latencyMs <= 100.0,
        `${sample.name}: Latency (${latencyMs.toFixed(2)}ms) must be strictly <= 100ms`
      );

      // Data precision assertions
      assertCheck(gameStartReceived.stageId === sample.expectedStage, `${sample.name}: stageId match`);
      assertCheck(gameStartReceived.stageName === sample.expectedStageName, `${sample.name}: stageName match`);
      assertCheck(
        gameStartReceived.players.length === sample.expectedPlayerCount,
        `${sample.name}: players.length === ${sample.expectedPlayerCount}`
      );

      if (sample.expectedConnectCodes) {
        const parsedCodes = gameStartReceived.players.map((p) => p.connectCode);
        for (const code of sample.expectedConnectCodes) {
          assertCheck(parsedCodes.includes(code), `${sample.name}: contains expected connectCode ${code}`);
        }
      }

      // Check player fields
      for (const player of gameStartReceived.players) {
        assertCheck(typeof player.port === 'number', `${sample.name}: player port is number`);
        assertCheck(typeof player.playerIndex === 'number', `${sample.name}: playerIndex is number`);
        assertCheck(typeof player.characterId === 'number', `${sample.name}: characterId is number`);
        assertCheck(typeof player.characterName === 'string' && player.characterName.length > 0, `${sample.name}: characterName is valid`);
      }

      // Teardown session
      await requestHttp(`${baseUrl}/api/broadcast/session`, { method: 'DELETE' });

      console.log(
        `    ✔ ${sample.name.padEnd(42)} Latency: ${latencyMs.toFixed(2).padStart(6)}ms | Stage: ${gameStartReceived.stageName.padEnd(15)} | Players: ${gameStartReceived.players.length}`
      );
    }

    // 2.2 Fragmented TCP Stream Latency (chunked into 256-byte increments)
    console.log('  2.2 Stress: Fragmented TCP streaming (256-byte chunks)...');
    {
      const sample = sampleReplays[0]; // unranked_game1.slp
      const fileBuffer = fs.readFileSync(sample.path);

      const startRes = await requestHttp(`${baseUrl}/api/broadcast/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 0 }),
      });
      const broadcastPort = startRes.json.port;

      const sse = connectSse(baseUrl);
      await sse.readyPromise;
      await new Promise((r) => setTimeout(r, 20));

      const client = net.connect(broadcastPort, '127.0.0.1');
      await new Promise((resolve) => client.once('connect', resolve));

      const writeStart = performance.now();
      // Stream in 256-byte chunks
      const targetChunkSize = 256;
      let offset = 0;
      const totalToSend = 4096;

      while (offset < totalToSend) {
        const slice = fileBuffer.subarray(offset, Math.min(offset + targetChunkSize, totalToSend));
        client.write(slice);
        offset += slice.length;
      }

      let fragLatency = 0;
      let gameStartReceived = null;
      const deadline = Date.now() + 1000;
      while (Date.now() < deadline) {
        const found = sse.events.find((e) => e.type === 'gameStart');
        if (found) {
          fragLatency = performance.now() - writeStart;
          gameStartReceived = found;
          break;
        }
        await new Promise((r) => setTimeout(r, 5));
      }

      client.destroy();
      sse.close();
      await requestHttp(`${baseUrl}/api/broadcast/session`, { method: 'DELETE' });

      assertCheck(gameStartReceived !== null, 'Fragmented stream received gameStart');
      assertCheck(fragLatency <= 100.0, `Fragmented stream latency (${fragLatency.toFixed(2)}ms) <= 100ms`);
      console.log(`    ✔ Fragmented stream parsed in ${fragLatency.toFixed(2)}ms (<= 100ms requirement).\n`);
    }

    // -------------------------------------------------------------------------
    // CHALLENGE 3: SOCKET TEARDOWN & MULTI-CLIENT RESOURCE MANAGEMENT
    // -------------------------------------------------------------------------
    console.log('--- CHALLENGE 3: Multi-Client Socket Teardown & Port Release ---');

    // 3.1 Multiple Simultaneous Clients (10 clients)
    console.log('  3.1 Connecting 10 simultaneous clients and issuing DELETE...');
    {
      const startRes = await requestHttp(`${baseUrl}/api/broadcast/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 0 }),
      });
      const broadcastPort = startRes.json.port;

      const clientCount = 10;
      const clients = [];
      const clientClosePromises = [];

      for (let i = 0; i < clientCount; i++) {
        const c = net.connect(broadcastPort, '127.0.0.1');
        clients.push(c);
        const closePromise = new Promise((resolve) => {
          c.once('close', () => resolve('closed'));
          c.once('error', () => resolve('error_closed'));
        });
        clientClosePromises.push(closePromise);
      }

      // Wait for all clients to connect on client-side
      await Promise.all(
        clients.map((c) => new Promise((resolve) => c.once('connect', resolve)))
      );

      // Allow server event loop tick to register all incoming sockets in activeSockets
      const connectDeadline = Date.now() + 1000;
      while (broadcastService.activeSockets.size < clientCount && Date.now() < connectDeadline) {
        await new Promise((r) => setTimeout(r, 10));
      }

      // Verify server registered active sockets
      assertCheck(
        broadcastService.activeSockets.size === clientCount,
        `activeSockets.size (${broadcastService.activeSockets.size}) === ${clientCount}`
      );

      // Query session via HTTP
      const sessionRes = await requestHttp(`${baseUrl}/api/broadcast/session`);
      assertCheck(sessionRes.json.status === BroadcastState.CONNECTED, 'Status is CONNECTED');

      // Issue DELETE /api/broadcast/session
      const delRes = await requestHttp(`${baseUrl}/api/broadcast/session`, { method: 'DELETE' });
      assertCheck(delRes.statusCode === 200, 'DELETE returns HTTP 200');

      // Assert activeSockets is cleared on the service
      assertCheck(
        broadcastService.activeSockets.size === 0,
        `activeSockets.size is 0 after DELETE (was ${clientCount})`
      );
      assertCheck(broadcastService.status === BroadcastState.IDLE, 'Broadcast status is IDLE');

      // Assert all client sockets were closed
      const closeResults = await Promise.race([
        Promise.all(clientClosePromises),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Clients hung on teardown')), 2000)),
      ]);
      assertCheck(closeResults.length === clientCount, `All ${clientCount} client sockets destroyed`);

      // Verify port immediately rebindable
      await assertPortRebindable(broadcastPort);
      console.log(`    ✔ All ${clientCount} simultaneous client sockets destroyed; activeSockets emptied; port released.`);
    }

    // 3.2 Abrupt Client Disconnect Handling
    console.log('  3.2 Abrupt client disconnect resilience...');
    {
      const startRes = await requestHttp(`${baseUrl}/api/broadcast/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 0 }),
      });
      const broadcastPort = startRes.json.port;

      const c = net.connect(broadcastPort, '127.0.0.1');
      await new Promise((resolve) => c.once('connect', resolve));
      assertCheck(broadcastService.status === BroadcastState.CONNECTED, 'Status transitioned to CONNECTED');

      // Abruptly destroy client socket
      c.destroy();
      await new Promise((r) => setTimeout(r, 50));

      assertCheck(broadcastService.activeSockets.size === 0, 'activeSockets is empty after client abrupt disconnect');
      assertCheck(broadcastService.status === BroadcastState.LISTENING, 'Status reverted to LISTENING');

      // Clean up session
      await requestHttp(`${baseUrl}/api/broadcast/session`, { method: 'DELETE' });
      console.log('    ✔ Abrupt client disconnect correctly restores LISTENING state without crashes.\n');
    }

    // -------------------------------------------------------------------------
    // CHALLENGE 4: ZERO DISK ACCUMULATION VERIFICATION
    // -------------------------------------------------------------------------
    console.log('--- CHALLENGE 4: Zero Disk Accumulation Audit ---');

    // Baseline check
    const preExistingSlp = checkSlpAccumulation(['temp_slp', '.']);
    assertCheck(
      preExistingSlp.length === 0,
      `temp_slp/ and root must have zero .slp files before test (found: ${preExistingSlp.join(', ')})`
    );

    // Stream multiple games continuously while polling filesystem
    const startRes = await requestHttp(`${baseUrl}/api/broadcast/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port: 0 }),
    });
    const broadcastPort = startRes.json.port;

    let diskPollViolations = [];
    const poller = setInterval(() => {
      const found = checkSlpAccumulation(['temp_slp', '.']);
      if (found.length > 0) diskPollViolations.push(...found);
    }, 10);

    // Stream 3 different replays
    for (const sample of sampleReplays.slice(0, 3)) {
      const fileBuffer = fs.readFileSync(sample.path);
      const client = net.connect(broadcastPort, '127.0.0.1');
      await new Promise((r) => client.once('connect', r));
      client.write(fileBuffer.subarray(0, 16384));
      await new Promise((r) => setTimeout(r, 30));
      client.destroy();
      await new Promise((r) => setTimeout(r, 20));
    }

    clearInterval(poller);
    await requestHttp(`${baseUrl}/api/broadcast/session`, { method: 'DELETE' });

    // Assert zero slp accumulation during polling
    assertCheck(
      diskPollViolations.length === 0,
      `Zero .slp files must be created during streaming (detected: ${diskPollViolations.join(', ')})`
    );

    // Post-check
    const postSlp = checkSlpAccumulation(['temp_slp', '.']);
    assertCheck(
      postSlp.length === 0,
      `Zero .slp files after streaming (found: ${postSlp.join(', ')})`
    );

    console.log('    ✔ Zero disk accumulation confirmed: 0 files written to temp_slp/ or root during or after streaming.\n');

    // -------------------------------------------------------------------------
    // CHALLENGE 5: ERROR RESILIENCE & PROCESS CRASH VULNERABILITY AUDIT
    // -------------------------------------------------------------------------
    console.log('--- CHALLENGE 5: Process Integrity & Port Conflict Error Handling ---');
    let portConflictCrashDetected = false;
    {
      const conflictPort = 51449;
      const blocker = net.createServer();
      await new Promise((r) => blocker.listen(conflictPort, '127.0.0.1', r));

      const { spawn } = await import('node:child_process');
      const childScript = `
        import http from "node:http";
        import { createServer } from "./src/server/server.js";
        const server = createServer();
        server.listen(0, "127.0.0.1", () => {
          console.log("READY:" + server.address().port);
        });
      `;

      const child = spawn('node', ['--no-warnings', '--input-type=module', '-e', childScript], {
        env: { ...process.env, NODE_NO_WARNINGS: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let childStderr = '';
      child.stderr.on('data', (d) => (childStderr += d.toString()));

      let targetPort = null;
      await new Promise((resolve, reject) => {
        child.stdout.on('data', (chunk) => {
          const match = chunk.toString().match(/READY:(\d+)/);
          if (match) {
            targetPort = Number(match[1]);
            resolve();
          }
        });
        child.once('error', reject);
        child.once('exit', (code) => reject(new Error(`Child exited prematurely with code ${code}`)));
      });

      let serverRespondedGracefully = false;
      try {
        const res = await requestHttp(`http://127.0.0.1:${targetPort}/api/broadcast/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ port: conflictPort, host: '127.0.0.1' }),
        });
        if (res.statusCode === 500) {
          serverRespondedGracefully = true;
        }
      } catch (err) {
        // Expected connection drop if server crashes
      }

      const [exitCode, signal] = await new Promise((resolve) => {
        if (child.exitCode !== null) return resolve([child.exitCode, child.signalCode]);
        const timer = setTimeout(() => {
          child.kill();
          resolve([null, null]);
        }, 500);
        child.once('exit', (code, sig) => {
          clearTimeout(timer);
          resolve([code, sig]);
        });
      });

      blocker.close();

      if (childStderr.includes("Emitted 'error' event on BroadcastService instance") || exitCode === 7) {
        portConflictCrashDetected = true;
        console.log(`    ⚠️ DETECTED VULNERABILITY: Server crashed with exit code ${exitCode} due to unhandled EventEmitter 'error' event!`);
        console.log('       Location: src/broadcast/broadcastService.js:212 -> this.emit("error", err)');
        console.log('       Impact: EADDRINUSE/EACCES causes fatal uncaught exception, bypassing server.js try/catch and killing the process.');
      } else if (serverRespondedGracefully) {
        console.log('    ✔ Server returned HTTP 500 without crashing.');
      }

      const strictAudit = process.argv.includes('--strict-audit');
      if (strictAudit) {
        assertCheck(
          !portConflictCrashDetected,
          `Process must not crash on port conflict (crashed with exit code ${exitCode} due to unhandled EventEmitter 'error' event in broadcastService.js:212)`
        );
      }
    }

    console.log('======================================================================');
    console.log(`CORE CHALLENGE VERDICT: ALL ${passedAssertions}/${totalAssertions} CORE ASSERTIONS PASSED`);
    if (portConflictCrashDetected) {
      console.log('ADVERSARIAL STRESS FINDING: 1 CRITICAL FLAW DETECTED (Port Conflict Process Crash)');
    }
    console.log('======================================================================');
  } finally {
    server.close();
    closeDatabase();
    resetBroadcastService();
  }
}

runEmpiricalChallenge().catch((err) => {
  console.error('\n❌ EMPIRICAL CHALLENGE FAILED:', err);
  process.exit(1);
});
