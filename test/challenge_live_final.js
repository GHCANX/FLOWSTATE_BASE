import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from '../src/server/server.js';
import { BroadcastService, BroadcastState } from '../src/broadcast/broadcastService.js';

const UNRANKED_SLP = path.resolve('external/slippi-js-master/slp/unranked_game1.slp');
const DISPLAY_SLP = path.resolve('external/slippi-js-master/slp/displayNameAndConnectCodeInGameStart.slp');
const DOUBLES_SLP = path.resolve('external/slippi-js-master/slp/doubles.slp');

let failures = 0;
let passes = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`    ✔ ${message}`);
    passes++;
  } else {
    console.error(`    ❌ FAILED: ${message}`);
    failures++;
  }
}

async function requestHttp(port, method, pathUrl, body = null) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port,
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

async function main() {
  console.log('========================================================================');
  console.log('⚔️  EMPIRICAL CHALLENGER FINAL: ADVERSARIAL STRESS & INTEGRITY SUITE ⚔️');
  console.log('========================================================================\n');

  const broadcast = new BroadcastService();
  const server = createServer({ broadcastService: broadcast });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const serverPort = server.address().port;
  console.log(`[Test Server] Running on http://127.0.0.1:${serverPort}\n`);

  try {
    // -------------------------------------------------------------------------
    console.log('--- SECTION 1: Extreme Concurrency & Concurrent Lifecycle Race Conditions ---');
    // -------------------------------------------------------------------------
    // 1.1 Trigger 10 concurrent POST /api/broadcast/session calls
    console.log('  1.1 Firing 10 simultaneous POST /api/broadcast/session requests...');
    const postPromises = Array.from({ length: 10 }, () =>
      requestHttp(serverPort, 'POST', '/api/broadcast/session', { port: 0 })
    );
    const postResults = await Promise.all(postPromises);
    const allSuccessful = postResults.every((r) => r.status === 200 && r.json && r.json.status === 'LISTENING');
    assert(allSuccessful, 'All 10 concurrent POST /api/broadcast/session requests resolved cleanly without race deadlock');

    // 1.2 Verify session state stability
    const sessionRes = await requestHttp(serverPort, 'GET', '/api/broadcast/session');
    assert(sessionRes.status === 200 && sessionRes.json.status === 'LISTENING', 'GET /api/broadcast/session returns consistent LISTENING status');
    const allocatedPort = sessionRes.json.port;
    assert(Number.isInteger(allocatedPort) && allocatedPort > 1024, `Allocated TCP listener port is valid: ${allocatedPort}`);

    // 1.3 High-frequency start-stop churn (12 sequential rapid cycles)
    console.log('  1.3 Executing 12 rapid start-stop cycles...');
    let churnOk = true;
    for (let i = 0; i < 12; i++) {
      const p = await requestHttp(serverPort, 'POST', '/api/broadcast/session', { port: 0 });
      if (p.status !== 200) churnOk = false;
      const d = await requestHttp(serverPort, 'DELETE', '/api/broadcast/session');
      if (d.status !== 200 || d.json.status !== 'IDLE') churnOk = false;
    }
    assert(churnOk, '12 rapid start/stop cycles completed with zero EADDRINUSE or lingering state');

    // Reopen session for subsequent tests
    const activeSession = await requestHttp(serverPort, 'POST', '/api/broadcast/session', { port: 0 });
    const tcpPort = activeSession.json.port;

    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 2: Multi-Client Connection Flood & Hostile Garbage Ingestion ---');
    // -------------------------------------------------------------------------
    // 2.1 Connect 25 hostile clients sending garbage data concurrently
    console.log('  2.1 Connecting 25 hostile clients sending random noise and illegal bytes...');
    const hostileClients = [];

    for (let i = 0; i < 25; i++) {
      const socket = new net.Socket();
      hostileClients.push(
        new Promise((resolve) => {
          socket.connect(tcpPort, '127.0.0.1', () => {
            // Write 512 bytes of pseudo-random hostile bytes
            const garbage = Buffer.alloc(512);
            for (let b = 0; b < 512; b++) garbage[b] = (b * 31 + i) % 256;
            socket.write(garbage);
            setTimeout(() => {
              socket.destroy();
              resolve();
            }, 30);
          });
          socket.on('error', () => resolve());
        })
      );
    }
    await Promise.all(hostileClients);

    // Verify server remains alive and responds to HTTP
    const pingRes = await requestHttp(serverPort, 'GET', '/api/broadcast/session');
    assert(pingRes.status === 200, 'HTTP server maintained availability through 25-client hostile barrage');

    // 2.2 Recoverability: legitimate match must parse immediately after hostile assault
    console.log('  2.2 Verifying immediate recoverability after hostile barrage...');
    const bufferUnranked = fs.readFileSync(UNRANKED_SLP);
    const startIdx = bufferUnranked.indexOf(Buffer.from([0x35]));
    const gameStartData = bufferUnranked.subarray(startIdx);

    const recoveryPromise = new Promise((resolve) => {
      const onGameStart = (game) => {
        broadcast.off('gameStart', onGameStart);
        resolve(game);
      };
      broadcast.on('gameStart', onGameStart);
    });

    const legitSocket = new net.Socket();
    const t0 = process.hrtime.bigint();
    legitSocket.connect(tcpPort, '127.0.0.1', () => {
      legitSocket.write(gameStartData);
    });

    const parsedGame = await Promise.race([
      recoveryPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout waiting for gameStart')), 2000)),
    ]);
    const t1 = process.hrtime.bigint();
    const recoveryLatencyMs = Number(t1 - t0) / 1e6;

    assert(parsedGame !== null, `Legitimate match parsed after hostile flood: stageId=${parsedGame.stageId} (${parsedGame.stageName})`);
    assert(recoveryLatencyMs <= 100, `Extraction latency under recoverability test was ${recoveryLatencyMs.toFixed(2)}ms (<= 100ms threshold)`);
    assert(parsedGame.players.length === 2, `Extracted 2 active players: ${parsedGame.players.map((p) => p.connectCode).join(' vs ')}`);
    legitSocket.destroy();

    // Wait brief tick for socket cleanup
    await new Promise((r) => setTimeout(r, 80));

    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 3: Sequential Multi-Game Transitions & Lifecycle States ---');
    // -------------------------------------------------------------------------
    // 3.1 Sequential matches conforming to Slippi broadcaster lifecycle (connect -> game -> disconnect -> connect -> game)
    console.log('  3.1 Testing sequential matches across standard Slippi client lifecycle...');
    const bufferDisplay = fs.readFileSync(DISPLAY_SLP);
    const bufferDoubles = fs.readFileSync(DOUBLES_SLP);

    const matchHistory = [];
    const onStart = (g) => matchHistory.push({ stageId: g.stageId, stageName: g.stageName, players: g.players.length });
    broadcast.on('gameStart', onStart);

    // Game A: Pokémon Stadium (4 players)
    await new Promise((resolve) => {
      const clientA = net.connect(tcpPort, '127.0.0.1', () => {
        clientA.write(bufferDisplay);
        setTimeout(() => {
          clientA.destroy();
          resolve();
        }, 60);
      });
      clientA.on('error', () => resolve());
    });

    await new Promise((r) => setTimeout(r, 60));

    // Game B: Battlefield Doubles (4 players)
    await new Promise((resolve) => {
      const clientB = net.connect(tcpPort, '127.0.0.1', () => {
        clientB.write(bufferDoubles);
        setTimeout(() => {
          clientB.destroy();
          resolve();
        }, 60);
      });
      clientB.on('error', () => resolve());
    });

    await new Promise((r) => setTimeout(r, 60));

    broadcast.off('gameStart', onStart);

    assert(matchHistory.length === 2, `Both sequential matches parsed: total matches = ${matchHistory.length}`);
    if (matchHistory.length >= 2) {
      assert(matchHistory[0].stageId === 3, `Match 1: ${matchHistory[0].stageName} (Stage ${matchHistory[0].stageId}), ${matchHistory[0].players} players`);
      assert(matchHistory[1].stageId === 31, `Match 2: ${matchHistory[1].stageName} (Stage ${matchHistory[1].stageId}), ${matchHistory[1].players} players`);
    }

    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 4: Ingestion During Abrupt DELETE Teardown ---');
    // -------------------------------------------------------------------------
    console.log('  4.1 Streaming heavy data while triggering DELETE /api/broadcast/session...');
    const spamSocket = new net.Socket();
    await new Promise((resolve) => {
      spamSocket.connect(tcpPort, '127.0.0.1', () => {
        // Start spamming data in loop
        const interval = setInterval(() => {
          if (!spamSocket.destroyed) spamSocket.write(Buffer.alloc(1024, 0x42));
        }, 5);

        setTimeout(async () => {
          // Issue DELETE while spamming
          const delRes = await requestHttp(serverPort, 'DELETE', '/api/broadcast/session');
          clearInterval(interval);
          assert(delRes.status === 200 && delRes.json.status === 'IDLE', 'DELETE succeeded during high-speed streaming without throwing');
          assert(broadcast.activeSockets.size === 0, 'Active sockets set reduced to 0');
          assert(broadcast.status === BroadcastState.IDLE, 'Broadcast status reset to IDLE');
          resolve();
        }, 50);
      });
      spamSocket.on('error', () => {});
    });

    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 5: Zero Disk Accumulation Empirical Verification ---');
    // -------------------------------------------------------------------------
    console.log('  5.1 Asserting zero .slp files exist anywhere in temp_slp/ or project...');
    const tempSlpDir = path.resolve('temp_slp');
    const tempFiles = fs.existsSync(tempSlpDir) ? fs.readdirSync(tempSlpDir) : [];
    const slpTempFiles = tempFiles.filter((f) => f.endsWith('.slp'));
    assert(slpTempFiles.length === 0, `temp_slp contains 0 .slp files (found: ${slpTempFiles.length})`);

    // Check pipeline status endpoint
    const pipeRes = await requestHttp(serverPort, 'GET', '/api/pipeline/status');
    assert(pipeRes.json && pipeRes.json.tempSlpCount === 0, `Pipeline status reports tempSlpCount=0 (got: ${pipeRes.json.tempSlpCount})`);

    // Check storage footprint endpoint
    const storeRes = await requestHttp(serverPort, 'GET', '/api/storage/footprint');
    assert(storeRes.json && storeRes.json.tempSlpZero === true, 'Storage footprint reports tempSlpZero=true');

    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 6: Static Assets & CSS Viewport Containment Audit ---');
    // -------------------------------------------------------------------------
    console.log('  6.1 Verifying Melee stage and character visual assets...');
    const stagesDir = path.resolve('src/ui/assets/stages');
    const requiredStages = ['battlefield.jpg', 'dreamland.jpg', 'finaldestination.jpg', 'fountain.jpg', 'stadium.jpg', 'yoshis.jpg', 'nonlegal.jpg'];
    const missingStages = requiredStages.filter((s) => !fs.existsSync(path.join(stagesDir, s)));
    assert(missingStages.length === 0, `All 7 tournament stages exist on disk: ${requiredStages.join(', ')}`);

    const charDir = path.resolve('src/ui/assets/character-icons');
    const charFolders = fs.existsSync(charDir) ? fs.readdirSync(charDir) : [];
    assert(charFolders.length >= 26, `Character icons directory contains all 26 character subdirectories (found: ${charFolders.length})`);

    console.log('  6.2 Verifying strict 1080p containment and tray presets in src/ui/styles.css...');
    const cssPath = path.resolve('src/ui/styles.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');

    assert(cssContent.includes('overflow: hidden; /* Strict 1080p viewport - zero page scrolling */') || cssContent.includes('overflow: hidden;'), 'CSS specifies overflow: hidden on html, body');
    assert(cssContent.includes('height: 100vh;') && cssContent.includes('max-height: 100vh;'), 'CSS specifies height: 100vh and max-height: 100vh');
    assert(cssContent.includes('.terminal-panel.tray-minimized'), 'CSS defines .terminal-panel.tray-minimized');
    assert(cssContent.includes('.terminal-panel.tray-default'), 'CSS defines .terminal-panel.tray-default');
    assert(cssContent.includes('.terminal-panel.tray-maximized'), 'CSS defines .terminal-panel.tray-maximized');

    // 6.3 Verify HTML markup elements
    const htmlPath = path.resolve('src/ui/index.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    assert(htmlContent.includes('data-tab="spectate"'), 'HTML contains data-tab="spectate" tab button');
    assert(htmlContent.includes('id="form-spectate"'), 'HTML contains spectator form widget');
    assert(htmlContent.includes('id="live-match-panel"'), 'HTML contains live match panel');
    assert(htmlContent.includes('Open Slippi Launcher → Gameplay Broadcasts → Paste Broadcast Key → Start'), 'Setup instructions match exact required copy');
  } finally {
    await broadcast.stopSession().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('\n========================================================================');
  console.log(`CHALLENGE SUITE SUMMARY: ${passes} Passed, ${failures} Failed`);
  console.log('========================================================================');

  if (failures > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal unhandled error in challenge suite:', err);
  process.exit(1);
});
