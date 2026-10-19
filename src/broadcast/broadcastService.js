import net from 'node:net';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { SlpStream, SlpStreamEvent, Command } from '@slippi/slippi-js/node';
import { getStageName } from '../constants/stageGeometry.js';
import { getCharacterName } from '../constants/characters.js';

export const BroadcastState = Object.freeze({
  IDLE: 'IDLE',
  LISTENING: 'LISTENING',
  CONNECTED: 'CONNECTED',
  IN_GAME: 'IN_GAME',
});

export class BroadcastService extends EventEmitter {
  constructor() {
    super();
    this.status = BroadcastState.IDLE;
    this.sessionId = null;
    this.broadcastKey = null;
    this.port = null;
    this.host = null;
    this.tcpServer = null;
    this.activeSockets = new Set();
    this.slpStream = null;
    this.remotePeer = null;
    this.currentGame = null;
    this.sessionStartTime = null;
  }

  /**
   * Provisions a Slippi-compatible broadcast key format: SLP-XXXX-XXXX
   * @returns {string}
   */
  _generateBroadcastKey() {
    const part1 = crypto.randomBytes(2).toString('hex').toUpperCase();
    const part2 = crypto.randomBytes(2).toString('hex').toUpperCase();
    return `SLP-${part1}-${part2}`;
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
      broadcastKey: this.broadcastKey,
      remotePeer: this.remotePeer,
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
        this.currentGame = null;
        const nextStatus = this.activeSockets.size > 0 ? BroadcastState.CONNECTED : BroadcastState.LISTENING;
        this._setStatus(nextStatus);
        this.emit('gameEnd', { previousGame: endedGame, endPayload: payload });
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
   * Handle incoming TCP connection
   * @param {net.Socket} socket
   */
  _handleConnection(socket) {
    this.activeSockets.add(socket);
    this.remotePeer = {
      address: socket.remoteAddress,
      port: socket.remotePort,
      family: socket.remoteFamily,
    };
    this._setStatus(BroadcastState.CONNECTED);

    let pendingBuffer = Buffer.alloc(0);
    let handshakeProcessed = false;

    socket.on('data', (chunk) => {
      if (!this.slpStream) return;
      try {
        if (!handshakeProcessed) {
          pendingBuffer = Buffer.concat([pendingBuffer, chunk]);
          // Strip UBJSON header (0x7B) if present
          if (pendingBuffer.length > 0 && pendingBuffer[0] === 0x7b) {
            if (pendingBuffer.length < 15) return; // Wait for full 15-byte header
            pendingBuffer = pendingBuffer.subarray(15);
          }
          if (pendingBuffer.length === 0) return;
          // Wait for full 0x35 MESSAGE_SIZES command (29 bytes)
          if (pendingBuffer[0] === 0x35) {
            const neededLen = pendingBuffer.length > 1 ? 1 + pendingBuffer[1] : 29;
            if (pendingBuffer.length < neededLen) return; // Wait for full 0x35 payload
          }
          // Handshake is ready
          handshakeProcessed = true;
          const toProcess = pendingBuffer;
          pendingBuffer = null;
          this.slpStream.process(toProcess);
        } else {
          this.slpStream.process(chunk);
        }
      } catch (err) {
        this.emit('streamError', { error: err.message });
      }
    });

    let cleanedUp = false;
    const cleanupSocket = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      this.activeSockets.delete(socket);
      try {
        socket.destroy();
      } catch (_) {}

      if (this.activeSockets.size === 0 && this.status !== BroadcastState.IDLE) {
        const wasInGame = this.status === BroadcastState.IN_GAME;
        const previousGame = this.currentGame;
        this.remotePeer = null;
        this.currentGame = null;
        this._initSlpStream();
        this._setStatus(BroadcastState.LISTENING);
        if (wasInGame) {
          this.emit('gameEnd', { previousGame, reason: 'disconnect' });
        }
      }
    };

    socket.on('error', (err) => {
      this.emit('socketError', { error: err.message });
      cleanupSocket();
    });

    socket.on('close', () => {
      cleanupSocket();
    });
  }

  /**
   * Start a listening broadcast session
   * @param {Object} [options]
   * @param {number} [options.port=51441]
   * @param {string} [options.host='0.0.0.0']
   * @returns {Promise<Object>}
   */
  async startSession({ port = 51441, host = '0.0.0.0' } = {}) {
    if (this.status !== BroadcastState.IDLE) {
      await this.stopSession();
    }

    const targetPort = Number.isInteger(Number(port)) ? Number(port) : 51441;
    const targetHost = host || '0.0.0.0';

    this.sessionId = crypto.randomUUID();
    this.broadcastKey = this._generateBroadcastKey();
    this.host = targetHost;
    this.sessionStartTime = new Date().toISOString();
    this.currentGame = null;
    this.remotePeer = null;

    this._initSlpStream();

    return new Promise((resolve, reject) => {
      let isBound = false;
      const server = net.createServer((socket) => this._handleConnection(socket));

      server.on('error', (err) => {
        if (this.listenerCount('error') > 0) {
          this.emit('error', err);
        }
        if (this.status === BroadcastState.IDLE || !isBound) {
          this.status = BroadcastState.IDLE;
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
          reject(err);
        }
      });

      server.listen(targetPort, targetHost, () => {
        isBound = true;
        const address = server.address();
        this.port = typeof address === 'object' && address !== null ? address.port : targetPort;
        this.tcpServer = server;
        this._setStatus(BroadcastState.LISTENING);
        resolve(this.getSession());
      });
    });
  }

  /**
   * Stop session, close TCP server, destroy all client sockets, release ports
   * @returns {Promise<Object>}
   */
  async stopSession() {
    for (const socket of this.activeSockets) {
      try {
        socket.removeAllListeners();
        socket.destroy();
      } catch (_) {}
    }
    this.activeSockets.clear();

    if (this.tcpServer) {
      await new Promise((resolve) => {
        this.tcpServer.close(() => resolve());
      });
      this.tcpServer.unref();
      this.tcpServer = null;
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
    this.broadcastKey = null;
    this.port = null;
    this.host = null;
    this.remotePeer = null;
    this.currentGame = null;
    this.sessionStartTime = null;

    if (previousStatus !== BroadcastState.IDLE) {
      this.emit('statusChange', {
        status: BroadcastState.IDLE,
        previousStatus,
        sessionId: null,
        broadcastKey: null,
        remotePeer: null,
        currentGame: null,
      });
    }

    return { status: BroadcastState.IDLE, message: 'Session stopped and resources released.' };
  }

  /**
   * Returns current session metadata
   * @returns {Object}
   */
  getSession() {
    return {
      sessionId: this.sessionId,
      broadcastKey: this.broadcastKey,
      status: this.status,
      port: this.port,
      host: this.host,
      remotePeer: this.remotePeer,
      currentGame: this.currentGame,
      sessionStartTime: this.sessionStartTime,
      instructions: 'Open Slippi Launcher → Gameplay Broadcasts → Paste Broadcast Key → Start',
    };
  }
}

let globalBroadcastService = null;

/**
 * Returns singleton BroadcastService instance
 * @returns {BroadcastService}
 */
export function getBroadcastService() {
  if (!globalBroadcastService) {
    globalBroadcastService = new BroadcastService();
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
