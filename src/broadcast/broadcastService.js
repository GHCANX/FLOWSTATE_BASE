import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { SlpStream, SlpStreamEvent, Command } from '@slippi/slippi-js/node';
import { getStageName } from '../constants/stageGeometry.js';
import { getCharacterName } from '../constants/characters.js';
import { getSlippiAuth } from './slippiAuth.js';
import { FrameConsumer } from '../analysis/frameConsumer.js';
import { PayloadBuilder } from '../analysis/payloadBuilder.js';
import { ReplayRepository } from '../database/repository.js';
import { getDatabase } from '../database/db.js';
import { LunarClient } from '../lunar/lunarClient.js';

export const BroadcastState = Object.freeze({
  IDLE: 'IDLE',
  CONNECTING: 'CONNECTING',
  LISTENING: 'LISTENING',
  CONNECTED: 'CONNECTED',
  CONNECTED_TO_STREAM: 'CONNECTED_TO_STREAM',
  MENUS_ACTIVE: 'MENUS_ACTIVE',
  IN_GAME: 'IN_GAME',
});

export const OFFICIAL_SLIPPI_RELAY_URL = 'wss://broadcast-dot-slippi.uc.r.appspot.com/';

export class BroadcastService extends EventEmitter {
  /**
   * @param {Object} [options]
   * @param {import('./slippiAuth.js').SlippiAuthClient} [options.auth]
   * @param {string} [options.relayUrl]
   * @param {boolean} [options.autoFollow=true]
   * @param {boolean} [options.autoArchive=true]
   * @param {boolean} [options.lunarUpload=true]
   * @param {FrameConsumer} [options.frameConsumer]
   * @param {LunarClient} [options.lunarClient]
   */
  constructor(options = {}) {
    super();
    this.auth = options.auth || getSlippiAuth();
    this.relayUrl = options.relayUrl || process.env.SLIPPI_RELAY_URL || OFFICIAL_SLIPPI_RELAY_URL;
    this.autoFollow = options.autoFollow ?? true;
    this.autoArchive = options.autoArchive ?? true;
    this.lunarUpload = options.lunarUpload ?? true;

    this.status = BroadcastState.IDLE;
    this.parserState = BroadcastState.IDLE;
    this.sessionId = null;
    this.ws = null;
    this.slpStream = null;
    this._commandListener = null;

    this.activeBroadcasts = [];
    this.currentBroadcastId = null;
    this.currentBroadcaster = null;
    this.currentGame = null;
    this.currentMatchChunks = [];
    this.sessionStartTime = null;
    this.pollTimer = null;
    this.reconnectTimer = null;

    this.telemetry = {
      packetCount: 0,
      chunkCount: 0,
      byteCount: 0,
      totalBytes: 0,
      throughputKbps: 0,
      throughputRate: 0,
      parserState: BroadcastState.IDLE,
      status: BroadcastState.IDLE,
    };
    this._recentBytes = [];
    this._lastTelemetryTime = 0;
    this._telemetryTimer = null;
    this._decayTimer = null;
    this._telemetryPending = false;
    this._handshakeBuffer = Buffer.alloc(0);
    this._menuActiveEmitted = false;

    this.frameConsumer = options.frameConsumer || null;
    this.lunarClient = options.lunarClient || new LunarClient();
    this.activeArchives = 0;

    // Defensively attach error listener to prevent uncaught EventEmitter exceptions
    this.on('error', () => {});
  }

  /**
   * Derive granular parser state from high-level status
   * @param {string} status
   * @returns {string}
   * @private
   */
  _deriveParserState(status) {
    switch (status) {
      case BroadcastState.IN_GAME:
        return BroadcastState.IN_GAME;
      case BroadcastState.MENUS_ACTIVE:
        return BroadcastState.MENUS_ACTIVE;
      case BroadcastState.CONNECTED:
      case BroadcastState.CONNECTED_TO_STREAM:
        return this.parserState === BroadcastState.MENUS_ACTIVE
          ? BroadcastState.MENUS_ACTIVE
          : BroadcastState.CONNECTED_TO_STREAM;
      case BroadcastState.LISTENING:
        return BroadcastState.LISTENING;
      case BroadcastState.CONNECTING:
        return BroadcastState.CONNECTING;
      default:
        return BroadcastState.IDLE;
    }
  }

  /**
   * Sets the service status and emits statusChange if changed
   * @param {string} newStatus
   */
  _setStatus(newStatus) {
    if (this.status === newStatus) return;
    const previousStatus = this.status;
    this.status = newStatus;
    if (newStatus !== BroadcastState.MENUS_ACTIVE) {
      this._menuActiveEmitted = false;
    }
    this.parserState = this._deriveParserState(newStatus);
    this.telemetry.parserState = this.parserState;
    this.telemetry.status = this.status;

    this.emit('statusChange', {
      status: this.status,
      parserState: this.parserState,
      previousStatus,
      sessionId: this.sessionId,
      spectatorId: this.auth.fbUid || null,
      broadcastKey: this.auth.fbUid || null,
      currentBroadcaster: this.currentBroadcaster,
      currentGame: this.currentGame,
    });

    // Immediate dispatch without throttling on state transition
    this._emitTelemetry(true);
  }

  /**
   * Calculate rolling throughput rate in KB/s over 1 second window
   * @returns {number}
   * @private
   */
  _calculateThroughput() {
    const now = Date.now();
    const cutoff = now - 1000;
    let removeCount = 0;
    while (removeCount < this._recentBytes.length && this._recentBytes[removeCount].time < cutoff) {
      removeCount++;
    }
    if (removeCount > 0) {
      this._recentBytes.splice(0, removeCount);
    }
    const sumBytes = this._recentBytes.reduce((acc, curr) => acc + curr.bytes, 0);
    return Math.round((sumBytes / 1024) * 10) / 10;
  }

  /**
   * Emit telemetry event over SSE (throttled to 10 Hz unless forceImmediate=true)
   * @param {boolean} [forceImmediate=false]
   * @private
   */
  _emitTelemetry(forceImmediate = false) {
    if (this._telemetryTimer) {
      clearTimeout(this._telemetryTimer);
      this._telemetryTimer = null;
    }
    this._telemetryPending = false;
    this._lastTelemetryTime = Date.now();

    const kbps = this._calculateThroughput();
    this.telemetry.throughputKbps = kbps;
    this.telemetry.throughputRate = kbps;
    this.telemetry.parserState = this.parserState;
    this.telemetry.status = this.status;

    const payload = {
      type: 'telemetry',
      packetCount: this.telemetry.packetCount,
      chunkCount: this.telemetry.chunkCount,
      byteCount: this.telemetry.byteCount,
      totalBytes: this.telemetry.totalBytes,
      throughputKbps: this.telemetry.throughputKbps,
      throughputRate: this.telemetry.throughputRate,
      parserState: this.parserState,
      status: this.status,
      timestamp: this._lastTelemetryTime,
    };

    this.emit('telemetry', payload);

    // Schedule decay check if throughput is active so it resets to 0.0 KB/s on stream pause
    if (this._decayTimer) {
      clearTimeout(this._decayTimer);
      this._decayTimer = null;
    }
    if (kbps > 0) {
      this._decayTimer = setTimeout(() => {
        this._decayTimer = null;
        if (this._calculateThroughput() === 0 && this.telemetry.throughputKbps > 0) {
          this._emitTelemetry();
        }
      }, 1050);
    }
  }

  /**
   * Schedule throttled telemetry emission (10 Hz = 100ms)
   * @private
   */
  _scheduleTelemetryEmission() {
    if (this._telemetryPending) return;
    const now = Date.now();
    const elapsed = now - this._lastTelemetryTime;
    if (elapsed >= 100) {
      this._emitTelemetry();
    } else {
      this._telemetryPending = true;
      this._telemetryTimer = setTimeout(() => {
        this._telemetryPending = false;
        this._emitTelemetry();
      }, 100 - elapsed);
    }
  }

  /**
   * Record chunk ingestion in telemetry
   * @param {number} byteLength
   * @private
   */
  _recordChunkTelemetry(byteLength) {
    const validBytes = typeof byteLength === 'number' && !Number.isNaN(byteLength) && byteLength > 0
      ? Math.min(byteLength, 10 * 1024 * 1024)
      : 0;
    this.telemetry.packetCount++;
    this.telemetry.chunkCount = this.telemetry.packetCount;
    this.telemetry.byteCount += validBytes;
    this.telemetry.totalBytes = this.telemetry.byteCount;

    const now = Date.now();
    this._recentBytes.push({ time: now, bytes: validBytes });
    const cutoff = now - 1000;
    let removeCount = 0;
    while (removeCount < this._recentBytes.length && this._recentBytes[removeCount].time < cutoff) {
      removeCount++;
    }
    if (removeCount > 0) {
      this._recentBytes.splice(0, removeCount);
    }
    if (this._recentBytes.length > 2000) {
      this._recentBytes = this._recentBytes.slice(-1000);
    }

    if (this._decayTimer) {
      clearTimeout(this._decayTimer);
      this._decayTimer = null;
    }

    this._scheduleTelemetryEmission();
  }

  /**
   * Safely decode payload across binary Buffer, byte array, or base64 string formats
   * @param {any} payload
   * @returns {Buffer|null}
   * @private
   */
  _decodePayload(payload) {
    if (!payload) return null;
    try {
      if (Buffer.isBuffer(payload)) {
        return payload.length > 0 ? payload : null;
      }
      if (payload instanceof Uint8Array) {
        return payload.byteLength > 0 ? Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength) : null;
      }
      if (Array.isArray(payload)) {
        return payload.length > 0 ? Buffer.from(payload) : null;
      }
      if (typeof payload === 'string') {
        const trimmed = payload.trim();
        if (trimmed.length === 0) return null;
        const buf = Buffer.from(trimmed, 'base64');
        return buf.length > 0 ? buf : null;
      }
      if (typeof payload === 'object' && payload.data && (Array.isArray(payload.data) || Buffer.isBuffer(payload.data) || payload.data instanceof Uint8Array)) {
        const buf = Buffer.from(payload.data);
        return buf.length > 0 ? buf : null;
      }
    } catch (_) {
      return null;
    }
    return null;
  }

  /**
   * Normalize broadcaster and relay schema variations
   * @param {Object} b
   * @returns {Object}
   * @private
   */
  _normalizeBroadcast(b) {
    if (!b || typeof b !== 'object') return b;
    const broadcastId = b.broadcastId || b.id || b.broadcast_id || null;
    const target = b.target || b.viewerKey || b.spectatorId || b.viewer_key || b.spectator_id || b.key || null;
    let rawBroadcaster = b.broadcaster || b.player || b.user || {};
    if (typeof rawBroadcaster === 'string') {
      rawBroadcaster = { displayName: rawBroadcaster };
    }
    const displayName = rawBroadcaster.displayName || rawBroadcaster.name || b.displayName || b.broadcasterName || 'Player';
    const connectCode = rawBroadcaster.connectCode || rawBroadcaster.code || b.connectCode || b.broadcasterCode || b.code || null;

    return {
      ...b,
      broadcastId,
      id: broadcastId,
      target,
      viewerKey: target,
      spectatorId: target,
      broadcaster: {
        ...rawBroadcaster,
        displayName,
        connectCode,
      },
    };
  }

  /**
   * Initialize or reset the SlpStream parser
   */
  _initSlpStream() {
    this._handshakeBuffer = Buffer.alloc(0);
    this.currentMatchChunks = [];
    if (this.slpStream) {
      if (this._commandListener) {
        this.slpStream.removeListener(SlpStreamEvent.COMMAND, this._commandListener);
        this._commandListener = null;
      }
      if (typeof this.slpStream.removeAllListeners === 'function') {
        this.slpStream.removeAllListeners();
      }
      this.slpStream = null;
    }

    this.slpStream = new SlpStream({ suppressErrors: true });
    this._commandListener = ({ command, payload }) => {
      if (command === Command.GAME_START) {
        this.currentGame = this._normalizeGameStart(payload);
        this.parserState = BroadcastState.IN_GAME;
        this._setStatus(BroadcastState.IN_GAME);
        this.emit('gameStart', this.currentGame);
      } else if (command === Command.GAME_END) {
        const endedGame = this.currentGame;
        const matchChunks = this.currentMatchChunks;
        this.currentMatchChunks = [];
        this.currentGame = null;

        // Reset SlpStream parser for consecutive match support (AGENTS.md rule 8)
        this._initSlpStream();

        const nextStatus = this.ws && this.ws.readyState === WebSocket.OPEN
          ? (this.currentBroadcastId ? BroadcastState.CONNECTED : BroadcastState.LISTENING)
          : BroadcastState.IDLE;
        if (this.currentBroadcastId) {
          this.parserState = BroadcastState.MENUS_ACTIVE;
        }
        this._setStatus(nextStatus);

        this.emit('gameEnd', { previousGame: endedGame, endPayload: payload });
        this._emitTelemetry(true);

        // Auto-archive and upload asynchronously
        if (this.autoArchive && matchChunks.length > 0) {
          this._archiveAndUploadMatch(endedGame, matchChunks).catch((err) => {
            this.emit('archiveError', { error: err.message });
          });
        }
      }
    };
    this.slpStream.on(SlpStreamEvent.COMMAND, this._commandListener);
  }

  /**
   * Normalize GAME_START settings payload into clean spectator metadata
   * @param {Object} settings
   * @returns {Object}
   */
  _normalizeGameStart(settings) {
    if (!settings) return null;
    const stageId = settings.stageId;
    const stageName = getStageName(stageId);

    const activePlayers = (settings.players || [])
      .filter((p) => p && p.type !== 3)
      .map((p) => ({
        port: p.port,
        playerIndex: p.playerIndex,
        connectCode: p.connectCode ? p.connectCode.trim() : null,
        displayName: (p.displayName || p.nametag || '').trim(),
        characterId: p.characterId,
        characterName: getCharacterName(p.characterId),
        costumeIndex: p.characterColor ?? 0,
      }));

    return {
      stageId,
      stageName,
      players: activePlayers,
      isTeams: Boolean(settings.isTeams),
      slpVersion: settings.slpVersion,
      startedAt: new Date().toISOString(),
    };
  }

  /**
   * Asynchronously commit completed match to SQLite + .json.gz and upload to Lunar Melee
   * @param {Object} gameInfo
   * @param {Array<Buffer>} chunks
   * @private
   */
  async _archiveAndUploadMatch(gameInfo, chunks) {
    if (!chunks || chunks.length === 0) return;

    const fullBuffer = Buffer.concat(chunks);
    if (fullBuffer.length < 50) return; // Ignore truncated or tiny buffers

    const UBJSON_SIG = Buffer.from([0x7b, 0x55, 0x03, 0x72, 0x61, 0x77, 0x5b, 0x24, 0x55, 0x23, 0x6c]);
    let cleanBuffer = fullBuffer;
    const ubjsonIdx = fullBuffer.indexOf(UBJSON_SIG);

    if (ubjsonIdx !== -1) {
      cleanBuffer = fullBuffer.subarray(ubjsonIdx);
    } else {
      const cmd35Idx = fullBuffer.indexOf(0x35);
      if (cmd35Idx === -1) return; // Not a valid Slippi replay stream
      const rawEvents = fullBuffer.subarray(cmd35Idx);
      const header = Buffer.alloc(15);
      header.write('{U\x03raw[$U#l', 0, 11, 'ascii');
      header.writeUInt32BE(rawEvents.length, 11);
      cleanBuffer = Buffer.concat([header, rawEvents]);
    }

    const tempDir = path.resolve(process.cwd(), 'temp_slp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempFileName = `spectate_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.slp`;
    const tempFilePath = path.join(tempDir, tempFileName);

    this.activeArchives++;
    try {
      // 1. Stage raw .slp temporarily in ./temp_slp/
      fs.writeFileSync(tempFilePath, cleanBuffer);

      // 2. Local Dual-Storage Persistence (SQLite + date-sharded .json.gz)
      if (!this.frameConsumer) {
        const repository = new ReplayRepository();
        const payloadBuilder = new PayloadBuilder();
        this.frameConsumer = new FrameConsumer({ payloadBuilder, repository });
      }

      const archiveResult = this.frameConsumer.processReplay(tempFilePath, {
        source: 'spectator',
      });

      // 3. Upload to Lunar Melee
      let uploadResult = null;
      if (this.lunarUpload && this.lunarClient) {
        try {
          uploadResult = await this.lunarClient.uploadReplay(tempFilePath);
        } catch (uploadErr) {
          console.warn('[BroadcastService] Lunar Melee upload notice:', uploadErr.message);
          uploadResult = { error: uploadErr.message };
        }
      }

      this.emit('archiveComplete', {
        gameId: archiveResult.gameId,
        archiveResult,
        uploadResult,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.warn('[BroadcastService] Archive match failed:', err.message);
      this.emit('archiveError', { error: err.message });
    } finally {
      this.activeArchives--;
      // ZERO DISK ACCUMULATION INVARIANT:
      // Purge temporary .slp file immediately after dual-storage commit and upload attempt
      try {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      } catch (_) {}
    }
  }

  /**
   * Processes a raw Slippi binary chunk directly
   * @param {Buffer|Uint8Array|Array|string} rawChunk
   */
  processRawChunk(rawChunk) {
    const chunk = this._decodePayload(rawChunk);
    if (!chunk || chunk.length === 0) return;

    if (!this.slpStream) {
      this._initSlpStream();
    }

    this._recordChunkTelemetry(chunk.length);

    // Detect pre-match stream frames when connected prior to match launch
    if (this.status !== BroadcastState.IN_GAME &&
        (this.status === BroadcastState.CONNECTED || this.status === BroadcastState.CONNECTED_TO_STREAM) &&
        this.parserState === BroadcastState.CONNECTED_TO_STREAM) {
      this.parserState = BroadcastState.MENUS_ACTIVE;
      this._setStatus(BroadcastState.MENUS_ACTIVE);
    }

    // Handshake Chunk Buffering (AGENTS.md Rule 8):
    // Slippi binary streams may arrive fragmented down to 1 byte. Ingestion buffers
    // must accumulate incoming chunks until the full 0x35 MESSAGE_SIZES / gameStart
    // payload header is parsed, preventing DataView RangeError inside SlpStream.
    if (!this.slpStream.payloadSizes) {
      this._handshakeBuffer = Buffer.concat([this._handshakeBuffer, chunk]);

      // Guard against unbounded memory growth from hostile or noisy streams (Cap at 64 KB)
      const MAX_HANDSHAKE_BUFFER = 65536;
      if (this._handshakeBuffer.length > MAX_HANDSHAKE_BUFFER) {
        const pIdx = this._handshakeBuffer.indexOf(0x35);
        if (pIdx === -1) {
          // No 0x35 found in 64 KB; retain only latest 1024 bytes
          this._handshakeBuffer = this._handshakeBuffer.subarray(this._handshakeBuffer.length - 1024);
        } else if (pIdx > 0) {
          // Discard garbage prefix before 0x35
          this._handshakeBuffer = this._handshakeBuffer.subarray(pIdx);
        }
      }

      const idx = this._handshakeBuffer.indexOf(0x35);
      if (idx === -1 || this._handshakeBuffer.length < idx + 2) {
        return;
      }
      const msgSizesLen = this._handshakeBuffer[idx + 1];
      if (this._handshakeBuffer.length < idx + 2 + msgSizesLen) {
        return;
      }

      // Detect start of match payload (look for UBJSON signature {U\x03raw[$U#l prior to 0x35)
      const UBJSON_SIG = Buffer.from([0x7b, 0x55, 0x03, 0x72, 0x61, 0x77, 0x5b, 0x24, 0x55, 0x23, 0x6c]);
      const ubjsonOffset = this._handshakeBuffer.lastIndexOf(UBJSON_SIG, idx);
      const matchStartOffset = ubjsonOffset !== -1 ? ubjsonOffset : idx;

      const buffered = this._handshakeBuffer.subarray(matchStartOffset);
      this._handshakeBuffer = Buffer.alloc(0);
      this.currentMatchChunks = [buffered];

      try {
        this.slpStream.process(buffered);
      } catch (err) {
        console.warn('[BroadcastService] SlpStream handshake parse error:', err.message);
      }
      return;
    }

    this.currentMatchChunks.push(chunk);

    try {
      this.slpStream.process(chunk);
    } catch (err) {
      console.warn('[BroadcastService] SlpStream process error:', err.message);
    }
  }

  /**
   * Processes a menu_event payload (Character Select / Stage Select frames)
   * @param {any} payload
   */
  processMenuEvent(payload) {
    const chunk = this._decodePayload(payload);
    const byteLength = chunk ? chunk.length : (typeof payload === 'string' ? payload.length : 1);
    this._recordChunkTelemetry(byteLength);

    if (this.status !== BroadcastState.IN_GAME) {
      this.parserState = BroadcastState.MENUS_ACTIVE;
      this._setStatus(BroadcastState.MENUS_ACTIVE);
      if (!this._menuActiveEmitted) {
        this._menuActiveEmitted = true;
        this.emit('menuActive', {
          timestamp: new Date().toISOString(),
          broadcaster: this.currentBroadcaster,
        });
      }
    }
  }

  /**
   * Start a live spectator session connecting to Slippi Cloud Relay
   * @param {Object} [options]
   * @param {string} [options.relayUrl]
   * @param {boolean} [options.autoFollow]
   * @param {boolean} [options.autoArchive]
   * @param {boolean} [options.lunarUpload]
   * @param {string} [options.mockUid] Used for offline / unit tests
   * @returns {Promise<Object>}
   */
  async startSession(options = {}) {
    if (this.status !== BroadcastState.IDLE) {
      await this.stopSession();
    }

    if (options.relayUrl) this.relayUrl = options.relayUrl;
    if (options.autoFollow !== undefined) this.autoFollow = options.autoFollow;
    if (options.autoArchive !== undefined) this.autoArchive = options.autoArchive;
    if (options.lunarUpload !== undefined) this.lunarUpload = options.lunarUpload;

    // Check authentication or handle test mock
    if (!this.auth.isAuthenticated()) {
      if (options.mockUid || process.env.NODE_ENV === 'test') {
        this.auth.fbUid = options.mockUid || 'test_slippi_spectator_uid_123';
        this.auth.idToken = 'mock_id_token_test';
        this.auth.expiresAt = Date.now() + 3600000;
      } else if (process.env.SLIPPI_EMAIL && process.env.SLIPPI_PASSWORD) {
        await this.auth.login(process.env.SLIPPI_EMAIL, process.env.SLIPPI_PASSWORD);
      } else {
        throw new Error('Authentication required: please log into your Slippi account before starting a spectator session.');
      }
    }

    this.sessionId = crypto.randomUUID();
    this.sessionStartTime = new Date().toISOString();
    this.currentGame = null;
    this.currentMatchChunks = [];
    this.currentBroadcastId = null;
    this.currentBroadcaster = null;
    this.activeBroadcasts = [];
    this.telemetry = {
      packetCount: 0,
      chunkCount: 0,
      byteCount: 0,
      totalBytes: 0,
      throughputKbps: 0,
      throughputRate: 0,
      parserState: BroadcastState.CONNECTING,
      status: BroadcastState.CONNECTING,
    };
    this._recentBytes = [];
    this._lastTelemetryTime = Date.now();

    this._initSlpStream();
    this._setStatus(BroadcastState.CONNECTING);

    let idToken;
    try {
      idToken = await this.auth.getValidIdToken();
    } catch (_) {
      idToken = this.auth.idToken || 'mock_token';
    }

    return new Promise((resolve, reject) => {
      let isSettled = false;

      try {
        this.ws = new WebSocket(this.relayUrl, 'spectate-protocol', {
          headers: {
            'api-version': '2',
            'authorization': `Bearer ${idToken}`,
          },
        });
      } catch (err) {
        this.stopSession().catch(() => {});
        return reject(err);
      }

      this.ws.on('open', () => {
        this._setStatus(BroadcastState.LISTENING);

        // Immediately request list of active broadcasts
        this._sendWsMessage({ type: 'list-broadcasts' });

        // Polling interval to discover newly started broadcasts
        if (this.pollTimer) clearInterval(this.pollTimer);
        this.pollTimer = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this._sendWsMessage({ type: 'list-broadcasts' });
          }
        }, 8000);

        if (!isSettled) {
          isSettled = true;
          resolve(this.getSession());
        }
      });

      this.ws.on('message', (data) => {
        this._handleWsMessage(data);
      });

      this.ws.on('error', (err) => {
        this.emit('streamError', { error: err.message });
        if (!isSettled) {
          isSettled = true;
          this.stopSession().catch(() => {});
          reject(err);
        }
      });

      this.ws.on('close', (code, reason) => {
        if (!isSettled) {
          isSettled = true;
          this.stopSession().catch(() => {});
          reject(new Error(`WebSocket closed before connecting: code ${code} (${reason})`));
          return;
        }

        if (this.status !== BroadcastState.IDLE) {
          const wasInGame = this.status === BroadcastState.IN_GAME;
          const previousGame = this.currentGame;
          this.stopSession().catch(() => {});
          if (wasInGame) {
            this.emit('gameEnd', { previousGame, reason: 'relay_disconnect' });
          }
        }
      });
    });
  }

  /**
   * Send JSON message over WebSocket
   * @param {Object} obj
   * @private
   */
  _sendWsMessage(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(obj));
      } catch (err) {
        console.warn('[BroadcastService] WS send error:', err.message);
      }
    }
  }

  /**
   * Handle incoming message from Slippi Cloud Relay
   * @param {string|Buffer} rawData
   * @private
   */
  _handleWsMessage(rawData) {
    let msg = null;
    let isBinary = false;

    if (Array.isArray(rawData)) {
      rawData = Buffer.concat(rawData.map((c) => Buffer.isBuffer(c) ? c : Buffer.from(c)));
    } else if (rawData instanceof ArrayBuffer) {
      rawData = Buffer.from(rawData);
    } else if (rawData instanceof Uint8Array && !Buffer.isBuffer(rawData)) {
      rawData = Buffer.from(rawData.buffer, rawData.byteOffset, rawData.byteLength);
    }

    if (Buffer.isBuffer(rawData)) {
      const firstByte = rawData[0];
      if (firstByte === 0x7b || firstByte === 0x5b) { // '{' or '['
        try {
          msg = JSON.parse(rawData.toString('utf8'));
        } catch (_) {
          isBinary = true;
        }
      } else {
        isBinary = true;
      }
    } else if (typeof rawData === 'string') {
      try {
        msg = JSON.parse(rawData);
      } catch (_) {
        const trimmed = rawData.trim();
        if (trimmed.length > 0 && /^[A-Za-z0-9+/=]+$/.test(trimmed) && trimmed.length % 4 === 0) {
          try {
            const buf = Buffer.from(trimmed, 'base64');
            if (buf.length > 0) {
              this.processRawChunk(buf);
              return;
            }
          } catch (_) {}
        }
        return;
      }
    }

    if (isBinary && Buffer.isBuffer(rawData)) {
      this.processRawChunk(rawData);
      return;
    }

    if (!msg) return;

    if (Array.isArray(msg)) {
      for (const item of msg) {
        this._handleSingleMessage(item);
      }
      return;
    }

    this._handleSingleMessage(msg);
  }

  /**
   * Process a single normalized relay message object
   * @param {Object} msg
   * @private
   */
  _handleSingleMessage(msg) {
    if (!msg || typeof msg !== 'object') return;

    switch (msg.type) {
      case 'list-broadcasts-resp': {
        const rawList = Array.isArray(msg.broadcasts)
          ? msg.broadcasts
          : (Array.isArray(msg.data) ? msg.data : []);
        const broadcasts = rawList.map((b) => this._normalizeBroadcast(b));
        this.activeBroadcasts = broadcasts;
        this.emit('broadcastsUpdated', broadcasts);

        // If auto-follow is active and we are not watching a match, check for targets
        if (this.autoFollow && !this.currentBroadcastId && broadcasts.length > 0) {
          const myUid = (this.auth.fbUid || '').toLowerCase();
          const targeted = broadcasts.find((b) => {
            const tgt = (b.target || b.viewerKey || b.spectatorId || '').toLowerCase();
            return tgt && tgt === myUid;
          });
          const toWatch = targeted || broadcasts[0];
          if (toWatch && (toWatch.broadcastId || toWatch.id)) {
            this.watchBroadcast(toWatch.broadcastId || toWatch.id);
          }
        }
        break;
      }

      case 'watch-broadcast-resp': {
        if (msg.success !== false) {
          const respId = msg.broadcastId || msg.id || msg.broadcast_id || this.currentBroadcastId;
          if (respId !== this.currentBroadcastId) {
            this.currentGame = null;
            this.currentMatchChunks = [];
            this._initSlpStream();
          }
          this.currentBroadcastId = respId;
          const matchBrd = this.activeBroadcasts.find(
            (b) => b.broadcastId === this.currentBroadcastId || b.id === this.currentBroadcastId
          );
          if (matchBrd && matchBrd.broadcaster) {
            this.currentBroadcaster = matchBrd.broadcaster;
          }
          this.parserState = BroadcastState.CONNECTED_TO_STREAM;
          this._setStatus(BroadcastState.CONNECTED);
        } else {
          this.currentBroadcastId = null;
          this.currentBroadcaster = null;
          this._initSlpStream();
          this.parserState = BroadcastState.LISTENING;
          this._setStatus(BroadcastState.LISTENING);
          this.emit('streamError', { error: msg.error || 'Failed to watch broadcast' });
        }
        break;
      }

      case 'game_event': {
        const rawPayload = msg.payload !== undefined ? msg.payload : msg.data;
        if (rawPayload !== undefined) {
          const chunk = this._decodePayload(rawPayload);
          if (chunk) this.processRawChunk(chunk);
        }
        break;
      }

      case 'menu_event': {
        const rawPayload = msg.payload !== undefined ? msg.payload : msg.data;
        this.processMenuEvent(rawPayload);
        break;
      }

      case 'events': {
        if (Array.isArray(msg.events)) {
          for (const ev of msg.events) {
            if (!ev) continue;
            if (typeof ev === 'object') {
              const evType = ev.type || 'game_event';
              const rawPayload = ev.payload !== undefined ? ev.payload : (ev.data !== undefined ? ev.data : ev);
              if (evType === 'game_event') {
                const chunk = this._decodePayload(rawPayload);
                if (chunk) this.processRawChunk(chunk);
              } else if (evType === 'menu_event') {
                this.processMenuEvent(rawPayload);
              }
            } else {
              const chunk = this._decodePayload(ev);
              if (chunk) this.processRawChunk(chunk);
            }
          }
        }
        break;
      }

      case 'broadcast-ended':
      case 'stream-ended': {
        const brdId = msg.broadcastId || msg.id;
        if (!brdId || brdId === this.currentBroadcastId) {
          this.currentBroadcastId = null;
          this.currentBroadcaster = null;
          const wasInGame = this.status === BroadcastState.IN_GAME;
          const previousGame = this.currentGame;
          this.currentGame = null;
          this._initSlpStream();
          this.parserState = BroadcastState.LISTENING;
          this._setStatus(BroadcastState.LISTENING);
          if (wasInGame) {
            this.emit('gameEnd', { previousGame, reason: 'broadcast-ended' });
          }
        }
        break;
      }

      default:
        break;
    }
  }

  /**
   * Explicitly watch a specific broadcast ID
   * @param {string|Object} broadcastInput
   */
  watchBroadcast(broadcastInput) {
    if (!broadcastInput) return;
    const broadcastId = typeof broadcastInput === 'string'
      ? broadcastInput
      : (broadcastInput.broadcastId || broadcastInput.id || broadcastInput.broadcast_id || null);
    if (!broadcastId) return;

    if (broadcastId !== this.currentBroadcastId || this.currentGame || this.currentMatchChunks.length > 0) {
      this.currentGame = null;
      this.currentMatchChunks = [];
      this._initSlpStream();
    }

    this.currentBroadcastId = broadcastId;
    const matchBrd = this.activeBroadcasts.find(
      (b) => b.broadcastId === broadcastId || b.id === broadcastId
    );
    this.currentBroadcaster = matchBrd?.broadcaster ||
      (typeof broadcastInput === 'object' && broadcastInput.broadcaster ? broadcastInput.broadcaster : null) ||
      this.currentBroadcaster ||
      null;
    this.parserState = BroadcastState.CONNECTED_TO_STREAM;
    this._setStatus(BroadcastState.CONNECTED);
    this._sendWsMessage({
      type: 'watch-broadcast',
      broadcastId,
    });
  }

  /**
   * Stop session and disconnect from Slippi Cloud Relay
   * @returns {Promise<Object>}
   */
  async stopSession() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this._telemetryTimer) {
      clearTimeout(this._telemetryTimer);
      this._telemetryTimer = null;
    }
    if (this._decayTimer) {
      clearTimeout(this._decayTimer);
      this._decayTimer = null;
    }
    this._telemetryPending = false;
    this._recentBytes = [];
    this._handshakeBuffer = Buffer.alloc(0);

    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }

    if (this.slpStream) {
      if (this._commandListener) {
        this.slpStream.removeListener(SlpStreamEvent.COMMAND, this._commandListener);
        this._commandListener = null;
      }
      if (typeof this.slpStream.removeAllListeners === 'function') {
        this.slpStream.removeAllListeners();
      }
      this.slpStream = null;
    }

    const previousStatus = this.status;
    this.status = BroadcastState.IDLE;
    this.parserState = BroadcastState.IDLE;
    this.sessionId = null;
    this.currentBroadcastId = null;
    this.currentBroadcaster = null;
    this.currentGame = null;
    this.currentMatchChunks = [];
    this.activeBroadcasts = [];
    this.sessionStartTime = null;

    this.telemetry = {
      packetCount: 0,
      chunkCount: 0,
      byteCount: 0,
      totalBytes: 0,
      throughputKbps: 0,
      throughputRate: 0,
      parserState: BroadcastState.IDLE,
      status: BroadcastState.IDLE,
    };

    if (previousStatus !== BroadcastState.IDLE) {
      this.emit('statusChange', {
        status: BroadcastState.IDLE,
        parserState: BroadcastState.IDLE,
        previousStatus,
        sessionId: null,
        spectatorId: this.auth.fbUid,
        broadcastKey: this.auth.fbUid || null,
        currentBroadcaster: null,
        currentGame: null,
      });
      this.emit('telemetry', {
        type: 'telemetry',
        ...this.telemetry,
        timestamp: Date.now(),
      });
    }

    return { status: BroadcastState.IDLE, message: 'Cloud broadcast session stopped.' };
  }

  /**
   * Returns current session metadata
   * @returns {Object}
   */
  getSession() {
    const creds = this.auth.getCredentialsSummary();
    const spectatorId = creds.uid || null;

    return {
      sessionId: this.sessionId,
      broadcastKey: spectatorId || null,
      spectatorId,
      account: creds,
      status: this.status,
      parserState: this.parserState,
      telemetry: {
        packetCount: this.telemetry.packetCount,
        chunkCount: this.telemetry.chunkCount,
        byteCount: this.telemetry.byteCount,
        totalBytes: this.telemetry.totalBytes,
        throughputKbps: this._calculateThroughput(),
        throughputRate: this._calculateThroughput(),
        parserState: this.parserState,
        status: this.status,
      },
      activeBroadcasts: this.activeBroadcasts,
      currentBroadcastId: this.currentBroadcastId,
      currentBroadcaster: this.currentBroadcaster,
      currentGame: this.currentGame,
      sessionStartTime: this.sessionStartTime,
      autoArchive: this.autoArchive,
      lunarUpload: this.lunarUpload,
      relayUrl: this.relayUrl,
      instructions: 'Open Slippi Launcher → Gameplay Broadcasts → Paste Spectator ID → Start',
    };
  }
}

let globalBroadcastService = null;

/**
 * Returns singleton BroadcastService instance
 * @param {Object} [options]
 * @returns {BroadcastService}
 */
export function getBroadcastService(options) {
  if (!globalBroadcastService) {
    globalBroadcastService = new BroadcastService(options);
  }
  return globalBroadcastService;
}

/**
 * Reset singleton BroadcastService instance
 */
export function resetBroadcastService() {
  if (globalBroadcastService) {
    globalBroadcastService.stopSession().catch(() => {});
    globalBroadcastService = null;
  }
}
