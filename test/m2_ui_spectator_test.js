import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { createServer } from '../src/server/server.js';
import { getBroadcastService, resetBroadcastService, BroadcastState } from '../src/broadcast/broadcastService.js';

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
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

async function runM2Tests() {
  console.log('===============================================================');
  console.log('⚡ FlowState Milestone M2: UI Integration & Visual Assets Test ⚡');
  console.log('===============================================================\n');

  resetBroadcastService();
  const broadcastService = getBroadcastService();
  const server = createServer({ broadcastService });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const serverPort = server.address().port;
  const baseUrl = `http://127.0.0.1:${serverPort}`;
  console.log(`Test server running on ${baseUrl}\n`);

  try {
    // -------------------------------------------------------------------------
    // 1. Static Asset Serving Verification
    // -------------------------------------------------------------------------
    console.log('--- 1. Verifying Static Asset Serving ---');

    const testStages = [
      { path: '/assets/stages/battlefield.jpg', name: 'Battlefield', ext: 'image/jpeg' },
      { path: '/assets/stages/finaldestination.jpg', name: 'Final Destination', ext: 'image/jpeg' },
      { path: '/assets/stages/dreamland.jpg', name: 'Dream Land', ext: 'image/jpeg' },
      { path: '/assets/stages/fountain.jpg', name: 'Fountain of Dreams', ext: 'image/jpeg' },
      { path: '/assets/stages/stadium.jpg', name: 'Pokemon Stadium', ext: 'image/jpeg' },
      { path: '/assets/stages/yoshis.jpg', name: "Yoshi's Story", ext: 'image/jpeg' },
      { path: '/assets/stages/nonlegal.jpg', name: 'Non-Legal Fallback', ext: 'image/jpeg' },
    ];

    for (const stage of testStages) {
      const res = await requestHttp(`${baseUrl}${stage.path}`);
      assert.strictEqual(res.statusCode, 200, `Stage ${stage.name} (${stage.path}) must return HTTP 200`);
      assert.strictEqual(res.headers['content-type'], stage.ext, `Stage ${stage.name} must have Content-Type: ${stage.ext}`);
      assert(res.buffer.length > 1000, `Stage ${stage.name} must have non-empty payload (>1000 bytes, got ${res.buffer.length})`);
      console.log(`  ✔ Stage asset: ${stage.name.padEnd(22)} (${res.buffer.length} bytes, ${res.headers['content-type']})`);
    }

    const testPortraits = [
      { path: '/assets/character-icons/fox/Default.png', char: 'Fox (Default)' },
      { path: '/assets/character-icons/fox/Red.png', char: 'Fox (Red)' },
      { path: '/assets/character-icons/marth/Default.png', char: 'Marth (Default)' },
      { path: '/assets/character-icons/marth/Red.png', char: 'Marth (Red)' },
      { path: '/assets/character-icons/falcon/Blue.png', char: 'Falcon (Blue)' },
      { path: '/assets/character-icons/falco/Green.png', char: 'Falco (Green)' },
      { path: '/assets/character-icons/sheik/White.png', char: 'Sheik (White)' },
      { path: '/assets/character-icons/peach/Daisy.png', char: 'Peach (Daisy)' },
      { path: '/assets/character-icons/puff/Crown.png', char: 'Puff (Crown)' },
      { path: '/assets/character-icons/pikachu/Party_Hat.png', char: 'Pikachu (Party Hat)' },
      { path: '/assets/character-icons/pikachu/Cowboy_Hat.png', char: 'Pikachu (Cowboy Hat)' },
      { path: '/assets/character-icons/ganon/Default.png', char: 'Ganondorf (Default)' },
    ];

    for (const portrait of testPortraits) {
      const res = await requestHttp(`${baseUrl}${portrait.path}`);
      assert.strictEqual(res.statusCode, 200, `Portrait ${portrait.char} (${portrait.path}) must return HTTP 200`);
      assert.strictEqual(res.headers['content-type'], 'image/png', `Portrait ${portrait.char} must have Content-Type: image/png`);
      assert(res.buffer.length > 500, `Portrait ${portrait.char} must have non-empty payload (>500 bytes, got ${res.buffer.length})`);
      console.log(`  ✔ Character portrait: ${portrait.char.padEnd(22)} (${res.buffer.length} bytes, image/png)`);
    }

    // -------------------------------------------------------------------------
    // 2. Broadcast Session API Endpoints
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Verifying Broadcast Session API Endpoints ---');

    // 2.1 Initial State
    const initRes = await requestHttp(`${baseUrl}/api/broadcast/session`);
    assert.strictEqual(initRes.statusCode, 200);
    assert.strictEqual(initRes.json.status, BroadcastState.IDLE);
    assert.strictEqual(initRes.json.broadcastKey, null);
    console.log('  ✔ GET /api/broadcast/session returns IDLE state initially');

    // 2.2 Start Session (POST)
    const testSpectatorPort = 51441;
    const startRes = await requestHttp(`${baseUrl}/api/broadcast/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port: testSpectatorPort }),
    });
    assert.strictEqual(startRes.statusCode, 200);
    assert.strictEqual(startRes.json.status, BroadcastState.LISTENING);
    assert(/^SLP-[A-F0-9]{4}-[A-F0-9]{4}$/.test(startRes.json.broadcastKey), `Valid broadcastKey format: ${startRes.json.broadcastKey}`);
    assert.strictEqual(startRes.json.port, testSpectatorPort);
    const activeKey = startRes.json.broadcastKey;
    console.log(`  ✔ POST /api/broadcast/session successfully provisioned key ${activeKey} on port ${testSpectatorPort}`);

    // 2.3 Query Active Session (GET)
    const activeRes = await requestHttp(`${baseUrl}/api/broadcast/session`);
    assert.strictEqual(activeRes.statusCode, 200);
    assert.strictEqual(activeRes.json.status, BroadcastState.LISTENING);
    assert.strictEqual(activeRes.json.broadcastKey, activeKey);
    console.log('  ✔ GET /api/broadcast/session matches active session key and LISTENING status');

    // 2.4 Stop Session (DELETE)
    const stopRes = await requestHttp(`${baseUrl}/api/broadcast/session`, { method: 'DELETE' });
    assert.strictEqual(stopRes.statusCode, 200);
    assert.strictEqual(stopRes.json.status, BroadcastState.IDLE);

    const postStopRes = await requestHttp(`${baseUrl}/api/broadcast/session`);
    assert.strictEqual(postStopRes.statusCode, 200);
    assert.strictEqual(postStopRes.json.status, BroadcastState.IDLE);
    assert.strictEqual(postStopRes.json.broadcastKey, null);
    console.log('  ✔ DELETE /api/broadcast/session cleanly releases port and resets to IDLE');

    // -------------------------------------------------------------------------
    // 3. SSE Message Dispatch (GET /api/broadcast/events)
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Verifying SSE Stream & Event Dispatch ---');

    const sseEvents = [];
    let sseConnected = false;

    const sseReq = http.request(`${baseUrl}/api/broadcast/events`, (res) => {
      assert.strictEqual(res.statusCode, 200);
      assert(res.headers['content-type'].includes('text/event-stream'));
      sseConnected = true;

      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n\n');
        buffer = lines.pop();

        for (const block of lines) {
          if (!block.trim()) continue;
          const line = block.replace(/^data:\s*/, '');
          try {
            const parsed = JSON.parse(line);
            sseEvents.push(parsed);
          } catch (_) {}
        }
      });
    });
    sseReq.end();

    // Wait for SSE handshake and initial 'session' event
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.strictEqual(sseConnected, true, 'SSE connection established');
    assert(sseEvents.length >= 1, 'Initial SSE event received');
    assert.strictEqual(sseEvents[0].type, 'session', 'First SSE event is "session"');
    console.log(`  ✔ SSE connected and received initial "session" event (status: ${sseEvents[0].status})`);

    // Start session and observe 'statusChange'
    await requestHttp(`${baseUrl}/api/broadcast/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port: 51441 }),
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    const statusListeningEvent = sseEvents.find((e) => e.type === 'statusChange' && e.status === 'LISTENING');
    assert(statusListeningEvent, 'SSE received statusChange: LISTENING');
    console.log(`  ✔ SSE received statusChange: LISTENING with key ${statusListeningEvent.broadcastKey}`);

    // Simulate gameStart emission
    const mockGame = {
      stageId: 31,
      stageName: 'Battlefield',
      players: [
        {
          port: 1,
          playerIndex: 0,
          connectCode: 'MANG#0',
          displayName: 'Mang0',
          characterId: 2,
          characterName: 'Fox',
          costumeIndex: 0,
        },
        {
          port: 2,
          playerIndex: 1,
          connectCode: 'ZAIN#0',
          displayName: 'Zain',
          characterId: 9,
          characterName: 'Marth',
          costumeIndex: 1,
        },
      ],
      isTeams: false,
      startedAt: new Date().toISOString(),
    };

    broadcastService.currentGame = mockGame;
    broadcastService._setStatus(BroadcastState.IN_GAME);
    broadcastService.emit('gameStart', mockGame);

    await new Promise((resolve) => setTimeout(resolve, 300));
    const gameStartEvent = sseEvents.find((e) => e.type === 'gameStart');
    assert(gameStartEvent, 'SSE received gameStart event');
    assert.strictEqual(gameStartEvent.stageId, 31);
    assert.strictEqual(gameStartEvent.stageName, 'Battlefield');
    assert.strictEqual(gameStartEvent.players.length, 2);
    assert.strictEqual(gameStartEvent.players[0].connectCode, 'MANG#0');
    assert.strictEqual(gameStartEvent.players[1].connectCode, 'ZAIN#0');
    console.log(`  ✔ SSE received gameStart event for ${gameStartEvent.stageName} (${gameStartEvent.players[0].displayName} vs ${gameStartEvent.players[1].displayName})`);

    // Simulate gameEnd emission
    broadcastService.currentGame = null;
    broadcastService._setStatus(BroadcastState.CONNECTED);
    broadcastService.emit('gameEnd', { previousGame: mockGame });

    await new Promise((resolve) => setTimeout(resolve, 300));
    const gameEndEvent = sseEvents.find((e) => e.type === 'gameEnd');
    assert(gameEndEvent, 'SSE received gameEnd event');
    console.log('  ✔ SSE received gameEnd event to reset match view to State A');

    // Teardown session and close SSE
    await requestHttp(`${baseUrl}/api/broadcast/session`, { method: 'DELETE' });
    await new Promise((resolve) => setTimeout(resolve, 200));
    sseReq.destroy();

    // -------------------------------------------------------------------------
    // 4. HTML DOM Contract & Element ID Verification
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Verifying HTML DOM Contract & Layout Specifications ---');
    const htmlContent = fs.readFileSync(path.resolve('src/ui/index.html'), 'utf8');

    // 4.1 Tab Button
    assert(
      htmlContent.includes('<button class="tab-btn" role="tab" aria-selected="false" data-tab="spectate">Live Spectate</button>'),
      'index.html must include Live Spectate tab button with role="tab" and data-tab="spectate"'
    );
    console.log('  ✔ Tab button: Live Spectate data-tab="spectate" confirmed');

    // 4.2 Spectator Connection Widget (#form-spectate)
    const requiredFormElements = [
      'id="form-spectate"',
      'id="spectator-status-badge"',
      'id="spectator-status-text"',
      'id="broadcast-key-val"',
      'id="btn-copy-broadcast-key"',
      'id="spectator-port"',
      'id="btn-start-spectator"',
      'id="btn-stop-spectator"',
    ];
    for (const elId of requiredFormElements) {
      assert(htmlContent.includes(elId), `index.html must include ${elId}`);
    }
    console.log('  ✔ Spectator Connection Widget: All required element IDs present');

    // 4.3 Setup Instructions Card
    const exactInstructions = 'Open Slippi Launcher → Gameplay Broadcasts → Paste Broadcast Key → Start';
    assert(htmlContent.includes(exactInstructions), `index.html must contain exact instruction string: "${exactInstructions}"`);
    console.log(`  ✔ Setup instructions card contains exact string: "${exactInstructions}"`);

    // 4.4 Live Match Panel (#live-match-panel)
    const requiredMatchElements = [
      'id="live-match-panel"',
      'id="live-match-heading"',
      'id="live-match-badge"',
      'id="live-match-badge-text"',
      'id="live-match-stage-pill"',
      'id="match-waiting-state"',
      'class="radar-pulse-ring"',
      'id="waiting-title-text"',
      'id="waiting-desc-text"',
      'id="match-active-card"',
      'id="match-stage-backdrop"',
      'id="match-stage-name"',
      'id="match-stage-tag"',
      'class="versus-arena"',
      'id="p1-card"',
      'id="p1-port"',
      'id="p1-code"',
      'id="p1-portrait-img"',
      'id="p1-fallback-avatar"',
      'id="p1-nametag"',
      'id="p1-char-name"',
      'id="vs-stage-label"',
      'id="p2-card"',
      'id="p2-port"',
      'id="p2-code"',
      'id="p2-portrait-img"',
      'id="p2-fallback-avatar"',
      'id="p2-nametag"',
      'id="p2-char-name"',
    ];
    for (const elId of requiredMatchElements) {
      assert(htmlContent.includes(elId), `index.html must include ${elId}`);
    }
    console.log('  ✔ Live Match Card Panel: All required State A and State B element IDs present');

    const exactWaitingDesc = 'Spectator listener is active. Once both players select characters and stage, live match data will appear immediately.';
    assert(htmlContent.includes(exactWaitingDesc), `index.html must include exact waiting description: "${exactWaitingDesc}"`);
    console.log(`  ✔ Waiting state description matches exact string`);

    // -------------------------------------------------------------------------
    // 5. CSS 1080p Viewport & Design System Compliance
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Verifying CSS 1080p Viewport Containment ---');
    const cssContent = fs.readFileSync(path.resolve('src/ui/styles.css'), 'utf8');

    assert(cssContent.includes('overflow: hidden; /* Strict 1080p viewport - zero page scrolling */'), 'CSS enforces zero page scrolling');
    assert(cssContent.includes('.tray-minimized {'), 'CSS defines tray-minimized');
    assert(cssContent.includes('.tray-default {'), 'CSS defines tray-default');
    assert(cssContent.includes('.tray-maximized {'), 'CSS defines tray-maximized');
    assert(cssContent.includes('.radar-pulse-ring {'), 'CSS defines .radar-pulse-ring');
    assert(cssContent.includes('@keyframes radarPulse {'), 'CSS defines @keyframes radarPulse');
    assert(cssContent.includes('.fallback-avatar {'), 'CSS defines .fallback-avatar');
    assert(cssContent.includes('.stage-backdrop {'), 'CSS defines .stage-backdrop');
    assert(cssContent.includes('.versus-arena {'), 'CSS defines .versus-arena');
    console.log('  ✔ 1080p Viewport containment, console tray presets, radar pulse animation, and arena CSS verified');

    console.log('\n===============================================================');
    console.log('🎉 ALL MILESTONE M2 UI & ASSET VERIFICATION TESTS PASSED 🎉');
    console.log('===============================================================\n');
  } finally {
    server.close();
    resetBroadcastService();
  }
}

runM2Tests().catch((err) => {
  console.error('\n❌ M2 Test Failure:', err);
  process.exit(1);
});
