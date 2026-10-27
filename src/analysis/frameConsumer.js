import crypto from 'node:crypto';
import fs from 'node:fs';
import { SlippiGame } from '@slippi/slippi-js/node';
import { MechanicsDetector } from './mechanicsDetector.js';
import { TacticalDetector } from './tacticalDetector.js';
import { PayloadBuilder } from './payloadBuilder.js';

export class FrameConsumer {
  /**
   * @param {Object} options 
   * @param {PayloadBuilder} [options.payloadBuilder]
   * @param {import('../database/repository.js').ReplayRepository} [options.repository]
   */
  constructor({ payloadBuilder = new PayloadBuilder(), repository = null } = {}) {
    this.payloadBuilder = payloadBuilder;
    this.repository = repository;
  }

  /**
   * Analyzes a single .slp replay file in a single unified pass.
   * @param {string} slpFilePath Path to .slp file
   * @param {Object} [metaOverrides] Optional external metadata (e.g. from Lunar Melee)
   * @returns {Object} Result summary and generated records
   */
  processReplay(slpFilePath, metaOverrides = {}) {
    if (!fs.existsSync(slpFilePath)) {
      throw new Error(`File does not exist: ${slpFilePath}`);
    }

    // Compute SHA-256 file hash
    const fileBuf = fs.readFileSync(slpFilePath);
    const fileHash = crypto.createHash('sha256').update(fileBuf).digest('hex');

    // Generate or use replayId
    const gameId = metaOverrides.replayId || metaOverrides._id || fileHash.slice(0, 24);

    // Fast deduplication check
    if (this.repository && this.repository.isProcessed(gameId, fileHash)) {
      return { skipped: true, reason: 'ALREADY_PROCESSED', gameId, fileHash };
    }

    let game;
    try {
      game = new SlippiGame(slpFilePath);
    } catch (err) {
      if (this.repository) {
        this.repository.recordStatus(gameId, fileHash, metaOverrides.source || 'local', 'FAILED_CORRUPT', err.message);
      }
      throw err;
    }

    const settings = game.getSettings();
    if (!settings) {
      const err = new Error('Replay missing GameStart settings');
      if (this.repository) {
        this.repository.recordStatus(gameId, fileHash, metaOverrides.source || 'local', 'FAILED_CORRUPT', err.message);
      }
      throw err;
    }

    const metadata = game.getMetadata() || {};
    const gameEnd = game.getGameEnd();
    const stats = game.getStats() || {};

    // Collect base timing
    const startAt = metaOverrides.startAt || metadata.startAt || new Date().toISOString();
    const lastFrame = metadata.lastFrame ?? (gameEnd ? stats.lastFrame ?? 0 : 0);
    const durationFrames = Math.max(0, lastFrame);
    const durationSeconds = durationFrames / 60.0;

    // Initialize single-pass state machines
    const mechDetector = new MechanicsDetector(settings);
    const tactDetector = new TacticalDetector(settings);

    const frames = game.getFrames();
    const frameKeys = Object.keys(frames).map(Number).sort((a, b) => a - b);

    let prevFrame = null;
    for (const f of frameKeys) {
      const currentFrame = frames[f];
      if (!currentFrame) continue;

      mechDetector.processFrame(currentFrame, prevFrame);
      tactDetector.processFrame(currentFrame, prevFrame);

      prevFrame = currentFrame;
    }

    const mechanicsMetrics = mechDetector.fetch();
    const tacticalMetrics = tactDetector.fetch();

    // Collect habit payload
    const habitPayload = tactDetector.getHabitPayload();

    // Determine match completion
    const endMethod = gameEnd?.gameEndMethod ?? null;
    const lrasPort = gameEnd?.lrasInitiatorIndex ?? null;
    const hasLras = lrasPort !== null && lrasPort !== -1 && lrasPort !== undefined;
    const isComplete = (durationFrames >= 1800) && (endMethod !== 7) && !hasLras;

    // Compile granular deep payload for .json.gz
    const deepPayload = {
      gameId,
      fileHash,
      startAt,
      stageId: settings.stageId,
      players: settings.players.map(p => ({
        playerIndex: p.playerIndex,
        port: p.port,
        characterId: p.characterId,
        connectCode: p.connectCode,
        displayName: p.displayName,
      })),
      stocks: tacticalMetrics.stocks,
      conversions: tacticalMetrics.conversions,
      edgeguards: tacticalMetrics.edgeguards,
      pressureEvents: tacticalMetrics.pressureEvents,
      phantomHits: tacticalMetrics.phantomHits,
      mechanicsSummary: mechanicsMetrics,
      habits: habitPayload,
    };

    // Save compressed payload
    const payloadPath = this.payloadBuilder.savePayload(deepPayload);

    // Prepare compact SQLite records
    const gameRecord = {
      gameId,
      lunarReplayId: metaOverrides.replayId || null,
      fileHash,
      slpVersion: settings.slpVersion || 'unknown',
      startAt,
      durationFrames,
      durationSeconds,
      stageId: settings.stageId,
      gameMode: settings.gameMode ?? 2,
      isTeams: settings.isTeams ?? false,
      winnerPort: stats.overall ? (stats.overall.find(o => o.killCount >= 4)?.playerIndex ?? null) : null,
      endMethod,
      lrasPort,
      payloadPath,
      source: metaOverrides.source || 'local',
    };

    const playersRecords = settings.players.map(p => {
      const pStocks = tacticalMetrics.stocks.filter(s => s.playerIndex === p.playerIndex);
      return {
        playerIndex: p.playerIndex,
        port: p.port,
        characterId: p.characterId,
        costumeIndex: p.characterColor ?? 0,
        connectCode: p.connectCode || null,
        displayName: p.displayName || null,
        nametag: p.nametag || null,
        userId: p.userId || null,
        startStocks: p.startStocks ?? 4,
        endStocks: Math.max(0, (p.startStocks ?? 4) - pStocks.length),
        placement: null,
        isWinner: false,
      };
    });

    // High level overall performance
    const overallStatsMap = new Map(stats.overall?.map(o => [o.playerIndex, o]) || []);
    const overallRecords = settings.players.map(p => {
      const pStats = overallStatsMap.get(p.playerIndex) || {};
      return {
        playerIndex: p.playerIndex,
        inputsTotal: pStats.inputCounts?.total ?? 0,
        ipm: pStats.inputsPerMinute?.ratio ?? 0,
        digitalIpm: pStats.digitalInputsPerMinute?.ratio ?? 0,
        neutralWinRatio: pStats.neutralWinRatio?.ratio ?? 0,
        counterHitRatio: pStats.counterHitRatio?.ratio ?? 0,
        beneficialTradeRatio: pStats.beneficialTradeRatio?.ratio ?? 0,
        openingsPerKill: pStats.openingsPerKill?.ratio ?? 0,
        damagePerOpening: pStats.damagePerOpening?.ratio ?? 0,
        totalDamageDealt: pStats.totalDamage ?? 0,
        killCount: pStats.killCount ?? 0,
        conversionCount: pStats.conversionCount ?? 0,
      };
    });

    // Habits records for SQLite
    const habitsRecords = settings.players.map(p => {
      const hStats = tactDetector.getHabitStats(p.playerIndex);
      return {
        gameId,
        playerIndex: p.playerIndex,
        connectCode: p.connectCode || null,
        characterId: p.characterId,
        isComplete: isComplete ? 1 : 0,
        ...hStats,
      };
    });

    // Save to SQLite
    if (this.repository) {
      this.repository.saveProcessedGame(
        gameRecord,
        playersRecords,
        overallRecords,
        mechanicsMetrics,
        habitsRecords
      );
    }

    return {
      success: true,
      gameId,
      fileHash,
      payloadPath,
      durationSeconds,
      metricsCount: mechanicsMetrics.length,
      stocksCount: tacticalMetrics.stocks.length,
      conversionsCount: tacticalMetrics.conversions.length,
    };
  }
}
