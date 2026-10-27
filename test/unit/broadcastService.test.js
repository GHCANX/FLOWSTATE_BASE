import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { WebSocketServer } from 'ws';
import { BroadcastService, BroadcastState } from '../../src/broadcast/broadcastService.js';

describe('BroadcastService', () => {
  let broadcastService;
  let mockAuth;
  let mockLunarClient;
  let mockFrameConsumer;
  let wss;
  let wssPort;

  beforeEach(async () => {
    // Setup a real mock WebSocket server for testing startSession
    wss = new WebSocketServer({ port: 0 }); // Random port
    await new Promise(resolve => wss.on('listening', resolve));
    wssPort = wss.address().port;

    mockAuth = {
      isAuthenticated: () => true,
      getValidIdToken: async () => 'mock_token',
      fbUid: 'mock_uid',
      getCredentialsSummary: () => ({ uid: 'mock_uid' })
    };

    mockLunarClient = {
      uploadReplay: mock.fn(async () => {})
    };

    mockFrameConsumer = {
      consumeFrame: mock.fn(),
      getRollingProfile: mock.fn(() => ({}))
    };

    broadcastService = new BroadcastService({
      auth: mockAuth,
      lunarClient: mockLunarClient,
      frameConsumer: mockFrameConsumer,
      relayUrl: `ws://localhost:${wssPort}`,
      autoFollow: true
    });
  });

  afterEach(async () => {
    if (broadcastService) {
      await broadcastService.stopSession();
    }
    if (wss) {
      wss.close();
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  });

  it('should initialize with DISCONNECTED state (or IDLE per implementation)', () => {
    // Note: The issue description mentions "this.state = BroadcastState.DISCONNECTED",
    // but the source code actually uses "this.status = BroadcastState.IDLE".
    // We will test what the actual constructor does based on the source code.
    assert.strictEqual(broadcastService.status, BroadcastState.IDLE);
    assert.strictEqual(broadcastService.parserState, BroadcastState.IDLE);
    assert.strictEqual(broadcastService.activeBroadcasts.length, 0);
  });

  it('should start session successfully and connect to websocket server', async () => {
    // Tell the WebSocket Server to respond to list-broadcasts when connected
    wss.on('connection', (ws) => {
      ws.on('message', (message) => {
        const msg = JSON.parse(message);
        if (msg.type === 'list-broadcasts') {
          ws.send(JSON.stringify({
            type: 'list-broadcasts-resp',
            broadcasts: []
          }));
        }
      });
    });

    const session = await broadcastService.startSession();

    assert.strictEqual(broadcastService.status, BroadcastState.LISTENING);
    assert.strictEqual(session.sessionId !== null, true);
    assert.strictEqual(session.spectatorId, 'mock_uid');
    assert.strictEqual(broadcastService.ws !== null, true);
  });

  it('should handle stopSession correctly', async () => {
    broadcastService.status = BroadcastState.LISTENING;
    broadcastService.sessionId = 'test_session_id';
    broadcastService.pollTimer = setInterval(() => {}, 1000);

    await broadcastService.stopSession();

    assert.strictEqual(broadcastService.status, BroadcastState.IDLE);
    assert.strictEqual(broadcastService.sessionId, null);
    assert.strictEqual(broadcastService.pollTimer, null);
  });

  it('should return session info via getSession', () => {
    broadcastService.sessionId = 'test_session';
    broadcastService.status = BroadcastState.LISTENING;
    broadcastService.activeBroadcasts = [{ broadcastId: 'test_b' }];

    const session = broadcastService.getSession();

    assert.strictEqual(session.sessionId, 'test_session');
    assert.strictEqual(session.status, BroadcastState.LISTENING);
    assert.strictEqual(session.spectatorId, 'mock_uid');
    assert.deepStrictEqual(session.activeBroadcasts, [{ broadcastId: 'test_b' }]);
  });

  it('should handle list-broadcasts-resp and watch autoFollow target', () => {
    let watchedBroadcast = null;
    broadcastService.watchBroadcast = (id) => { watchedBroadcast = id; };
    broadcastService.autoFollow = true;

    const msg = {
      type: 'list-broadcasts-resp',
      broadcasts: [
        { broadcastId: 'b1', target: 'someone_else' },
        { broadcastId: 'b2', target: 'mock_uid' } // matches mockAuth.fbUid
      ]
    };

    broadcastService._handleSingleMessage(msg);

    assert.strictEqual(broadcastService.activeBroadcasts.length, 2);
    assert.strictEqual(watchedBroadcast, 'b2');
  });

  it('should handle watch-broadcast-resp success', () => {
    broadcastService.currentBroadcastId = 'old_b';

    const msg = {
      type: 'watch-broadcast-resp',
      success: true,
      broadcastId: 'new_b'
    };

    broadcastService._handleSingleMessage(msg);

    assert.strictEqual(broadcastService.currentBroadcastId, 'new_b');
    assert.strictEqual(broadcastService.status, BroadcastState.CONNECTED);
    assert.strictEqual(broadcastService.parserState, BroadcastState.CONNECTED_TO_STREAM);
  });

  it('should derive parser state accurately via _setStatus', () => {
    broadcastService._setStatus(BroadcastState.CONNECTING);
    assert.strictEqual(broadcastService.parserState, BroadcastState.CONNECTING);

    broadcastService._setStatus(BroadcastState.IN_GAME);
    assert.strictEqual(broadcastService.parserState, BroadcastState.IN_GAME);

    // Testing the transition from MENUS_ACTIVE back to CONNECTED_TO_STREAM
    // Usually CONNECTED retains MENUS_ACTIVE if it was already MENUS_ACTIVE.
    broadcastService.parserState = BroadcastState.MENUS_ACTIVE;
    broadcastService._setStatus(BroadcastState.CONNECTED);
    assert.strictEqual(broadcastService.parserState, BroadcastState.MENUS_ACTIVE);
  });
});
