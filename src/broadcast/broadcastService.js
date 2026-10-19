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

    this.frameConsumer = options.frameConsumer || null;
    this.lunarClient = options.lunarClient || new LunarClient();
    this.activeArchives = 0;

    // Defensively attach error listener to prevent uncaught EventEmitter exceptions
    this.on('error', () => {});
  }

  /**
   * Sets the service status and emits statusChange if changed
   * @param {string} newStatus
   */
  _setStatus(newStatus) {
    if (this.status === newStatus) return;
    const previousStatus = this.status;
    this.status = newStatus;
    this.emit('statusChange', {
      status: this.status,
      previousStatus,
      sessionId: this.sessionId,
      spectatorId: this.auth.fbUid,
      broadcastKey: this.auth.fbUid,
      currentBroadcaster: this.currentBroadcaster,
      currentGame: this.currentGame,
    });
  }

  /**
   * Initialize or reset the SlpStream parser
   */
  _initSlpStream() {
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
        this._setStatus(nextStatus);

        this.emit('gameEnd', { previousGame: endedGame, endPayload: payload });

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

    const tempDir = path.resolve(process.cwd(), 'temp_slp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempFileName = `spectate_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.slp`;
    const tempFilePath = path.join(tempDir, tempFileName);

    this.activeArchives++;
    try {
      // 1. Stage raw .slp temporarily in ./temp_slp/
      fs.writeFileSync(tempFilePath, fullBuffer);

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
   * @param {Buffer} chunk
   */
  processRawChunk(chunk) {
    if (!this.slpStream) {
      this._initSlpStream();
    }
    this.currentMatchChunks.push(chunk);
    this.slpStream.process(chunk);
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
        this._setStatus(BroadcastState.IDLE);
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
          this._setStatus(BroadcastState.IDLE);
          reject(err);
        }
      });

      this.ws.on('close', (code, reason) => {
        if (!isSettled) {
          isSettled = true;
          this._setStatus(BroadcastState.IDLE);
          reject(new Error(`WebSocket closed before connecting: code ${code} (${reason})`));
          return;
        }

        if (this.status !== BroadcastState.IDLE) {
          const wasInGame = this.status === BroadcastState.IN_GAME;
          const previousGame = this.currentGame;
          this._setStatus(BroadcastState.IDLE);
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
    let msg;
    try {
      const text = typeof rawData === 'string' ? rawData : rawData.toString('utf8');
      msg = JSON.parse(text);
    } catch (_) {
      return;
    }

    if (!msg || typeof msg !== 'object') return;

    switch (msg.type) {
      case 'list-broadcasts-resp': {
        const broadcasts = Array.isArray(msg.broadcasts) ? msg.broadcasts : [];
        this.activeBroadcasts = broadcasts;
        this.emit('broadcastsUpdated', broadcasts);

        // If auto-follow is active and we are not watching a match, check for targets
        if (this.autoFollow && !this.currentBroadcastId && broadcasts.length > 0) {
          // Look for broadcasts targeting our spectator ID
          const targeted = broadcasts.find(
            (b) => b.target && b.target.toLowerCase() === (this.auth.fbUid || '').toLowerCase()
          );
          const toWatch = targeted || broadcasts[0];
          if (toWatch && toWatch.broadcastId) {
            this.watchBroadcast(toWatch.broadcastId);
          }
        }
        break;
      }

      case 'watch-broadcast-resp': {
        if (msg.success !== false) {
          this.currentBroadcastId = msg.broadcastId || this.currentBroadcastId;
          const matchBrd = this.activeBroadcasts.find((b) => b.broadcastId === this.currentBroadcastId);
          this.currentBroadcaster = matchBrd ? (matchBrd.broadcaster || null) : null;
          this._setStatus(BroadcastState.CONNECTED);
        }
        break;
      }

      case 'events': {
        if (Array.isArray(msg.events)) {
          for (const ev of msg.events) {
            if (ev.type === 'game_event' && typeof ev.payload === 'string') {
              const chunk = Buffer.from(ev.payload, 'base64');
              this.processRawChunk(chunk);
            }
          }
        }
        break;
      }

      case 'broadcast-ended':
      case 'stream-ended': {
        if (!msg.broadcastId || msg.broadcastId === this.currentBroadcastId) {
          this.currentBroadcastId = null;
          this.currentBroadcaster = null;
          const wasInGame = this.status === BroadcastState.IN_GAME;
          const previousGame = this.currentGame;
          this.currentGame = null;
          this._initSlpStream();
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
   * @param {string} broadcastId
   */
  watchBroadcast(broadcastId) {
    if (!broadcastId) return;
    this.currentBroadcastId = broadcastId;
    const matchBrd = this.activeBroadcasts.find((b) => b.broadcastId === broadcastId);
    this.currentBroadcaster = matchBrd ? (matchBrd.broadcaster || null) : null;
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
    this.sessionId = null;
    this.currentBroadcastId = null;
    this.currentBroadcaster = null;
    this.currentGame = null;
    this.currentMatchChunks = [];
    this.activeBroadcasts = [];
    this.sessionStartTime = null;

    if (previousStatus !== BroadcastState.IDLE) {
      this.emit('statusChange', {
        status: BroadcastState.IDLE,
        previousStatus,
        sessionId: null,
        spectatorId: this.auth.fbUid,
        broadcastKey: this.auth.fbUid,
        currentBroadcaster: null,
        currentGame: null,
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
      broadcastKey: spectatorId || 'NO ACTIVE SESSION',
      spectatorId,
      account: creds,
      status: this.status,
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
