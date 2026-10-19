import { getDatabase } from './db.js';

export class ReplayRepository {
  /**
   * @param {string} [dbPath]
   */
  constructor(dbPath = './analytics.db') {
    this.db = getDatabase(dbPath);
    this._prepareStatements();
  }

  _prepareStatements() {
    this.stmts = {
      recordStatus: this.db.prepare(`
        INSERT INTO replay_status (replay_id, file_hash, source, status, error_message, processed_at)
        VALUES (?, ?, ?, ?, ?, DATETIME('now'))
        ON CONFLICT(replay_id) DO UPDATE SET
          status = excluded.status,
          error_message = excluded.error_message,
          processed_at = DATETIME('now')
      `),

      checkProcessed: this.db.prepare(`
        SELECT replay_id, status FROM replay_status WHERE replay_id = ? OR file_hash = ?
      `),

      insertGame: this.db.prepare(`
        INSERT INTO games (
          game_id, lunar_replay_id, file_hash, slp_version, start_at,
          duration_frames, duration_seconds, stage_id, game_mode, is_teams,
          winner_port, end_method, lras_port, payload_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(game_id) DO UPDATE SET
          payload_path = excluded.payload_path,
          winner_port = excluded.winner_port
      `),

      insertPlayer: this.db.prepare(`
        INSERT INTO game_players (
          game_id, player_index, port, character_id, costume_index,
          connect_code, display_name, nametag, user_id, start_stocks,
          end_stocks, placement, is_winner
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(game_id, player_index) DO UPDATE SET
          connect_code = excluded.connect_code,
          display_name = excluded.display_name,
          character_id = excluded.character_id,
          is_winner = excluded.is_winner
      `),

      insertOverall: this.db.prepare(`
        INSERT INTO player_overall_stats (
          game_id, player_index, inputs_total, ipm, digital_ipm,
          neutral_win_ratio, counter_hit_ratio, beneficial_trade_ratio,
          openings_per_kill, damage_per_opening, total_damage_dealt,
          kill_count, conversion_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(game_id, player_index) DO UPDATE SET
          ipm = excluded.ipm,
          total_damage_dealt = excluded.total_damage_dealt,
          kill_count = excluded.kill_count
      `),

      insertMechanics: this.db.prepare(`
        INSERT INTO player_mechanics_stats (
          game_id, player_index,
          l_cancel_success, l_cancel_fail, l_cancel_rate,
          wavedash_count, waveland_count, dash_dance_turns, dash_dance_strings, edge_cancels,
          ledge_grabs, ledgedash_count, avg_galint_frames,
          shield_drops, crouch_cancels, amsah_techs, v_cancels, slide_offs,
          powershields_physical, powershields_projectile,
          oos_grabs, oos_aerials, oos_smashes, oos_wavedashes, oos_rolls, oos_spotdodges,
          tech_neutral, tech_in, tech_away, tech_miss, wall_tech_success, wall_tech_miss,
          sdi_inputs, phantom_hits, float_cancels, jc_grabs, boost_grabs, multishines
        ) VALUES (
          ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?
        )
        ON CONFLICT(game_id, player_index) DO UPDATE SET
          l_cancel_rate = excluded.l_cancel_rate,
          wavedash_count = excluded.wavedash_count
      `),

      getCheckpoint: this.db.prepare(`
        SELECT * FROM ingestion_progress WHERE run_name = ? ORDER BY id DESC LIMIT 1
      `),

      insertCheckpoint: this.db.prepare(`
        INSERT INTO ingestion_progress (
          run_name, current_year, current_date, current_page,
          last_processed_replay_id, total_downloaded, total_processed, total_failed, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),

      updateCheckpointCounters: this.db.prepare(`
        UPDATE ingestion_progress
        SET total_downloaded = total_downloaded + ?,
            total_processed = total_processed + ?,
            total_failed = total_failed + ?,
            current_date = ?,
            current_page = ?,
            last_processed_replay_id = ?,
            updated_at = DATETIME('now')
        WHERE id = ?
      `),

      insertBatchRun: this.db.prepare(`
        INSERT INTO batch_runs (
          batch_id, run_name, lifecycle_state, filter_criteria, batch_size, started_at
        ) VALUES (?, ?, ?, ?, ?, DATETIME('now'))
      `),

      updateBatchRun: this.db.prepare(`
        UPDATE batch_runs
        SET lifecycle_state = ?,
            discovered_count = ?,
            downloaded_count = ?,
            processed_count = ?,
            skipped_count = ?,
            failed_count = ?,
            storage_bytes = ?,
            throughput_rpm = ?,
            completed_at = ?,
            error_message = ?
        WHERE batch_id = ?
      `),

      getBatchRuns: this.db.prepare(`
        SELECT * FROM batch_runs ORDER BY started_at DESC LIMIT ?
      `),

      getBatchRun: this.db.prepare(`
        SELECT * FROM batch_runs WHERE batch_id = ?
      `),

      getLatestBatchRun: this.db.prepare(`
        SELECT * FROM batch_runs ORDER BY started_at DESC, rowid DESC LIMIT 1
      `)
    };
  }

  /**
   * Records processing status (e.g. COMPLETED or FAILED_CORRUPT)
   */
  recordStatus(replayId, fileHash, source, status, errorMessage = null) {
    this.stmts.recordStatus.run(replayId, fileHash || replayId, source, status, errorMessage);
  }

  /**
   * Checks if replay or file hash has already been successfully processed
   */
  isProcessed(replayId, fileHash = null) {
    const row = this.stmts.checkProcessed.get(replayId, fileHash || replayId);
    return row && row.status === 'COMPLETED';
  }

  /**
   * Insert a full parsed replay inside an atomic transaction
   */
  saveProcessedGame(game, players, overallStats, mechanicsStats) {
    // Execute inside immediate transaction
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      this.stmts.insertGame.run(
        game.gameId,
        game.lunarReplayId || null,
        game.fileHash,
        game.slpVersion || 'unknown',
        game.startAt,
        game.durationFrames,
        game.durationSeconds,
        game.stageId,
        game.gameMode,
        game.isTeams ? 1 : 0,
        game.winnerPort ?? null,
        game.endMethod ?? null,
        game.lrasPort ?? null,
        game.payloadPath
      );

      for (const p of players) {
        this.stmts.insertPlayer.run(
          game.gameId,
          p.playerIndex,
          p.port,
          p.characterId,
          p.costumeIndex ?? 0,
          p.connectCode ?? null,
          p.displayName ?? null,
          p.nametag ?? null,
          p.userId ?? null,
          p.startStocks ?? 4,
          p.endStocks ?? 0,
          p.placement ?? null,
          p.isWinner ? 1 : 0
        );
      }

      for (const o of overallStats) {
        this.stmts.insertOverall.run(
          game.gameId,
          o.playerIndex,
          o.inputsTotal,
          o.ipm,
          o.digitalIpm,
          o.neutralWinRatio,
          o.counterHitRatio,
          o.beneficialTradeRatio,
          o.openingsPerKill,
          o.damagePerOpening,
          o.totalDamageDealt,
          o.killCount,
          o.conversionCount
        );
      }

      for (const m of mechanicsStats) {
        this.stmts.insertMechanics.run(
          game.gameId,
          m.playerIndex,
          m.lCancelSuccess,
          m.lCancelFail,
          m.lCancelRate,
          m.wavedashCount,
          m.wavelandCount,
          m.dashDanceTurns,
          m.dashDanceStrings,
          m.edgeCancels,
          m.ledgeGrabs,
          m.ledgedashCount,
          m.avgGalintFrames,
          m.shieldDrops,
          m.crouchCancels,
          m.amsahTechs,
          m.vCancels,
          m.slideOffs,
          m.powershieldsPhysical,
          m.powershieldsProjectile,
          m.oosGrabs,
          m.oosAerials,
          m.oosSmashes,
          m.oosWavedashes,
          m.oosRolls,
          m.oosSpotdodges,
          m.techNeutral,
          m.techIn,
          m.techAway,
          m.techMiss,
          m.wallTechSuccess,
          m.wallTechMiss,
          m.sdiInputs,
          m.phantomHits,
          m.floatCancels,
          m.jcGrabs,
          m.boostGrabs,
          m.multishines
        );
      }

      this.stmts.recordStatus.run(
        game.gameId,
        game.fileHash,
        game.source || 'local',
        'COMPLETED',
        null
      );

      this.db.exec('COMMIT;');
      return true;
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  /**
   * Retrieves or initializes checkpoint for a sliding-window batch run
   */
  getOrInitCheckpoint(runName, startYear = 2018) {
    let cp = this.stmts.getCheckpoint.get(runName);
    if (!cp) {
      const startDate = `${startYear}-01-01T00:00:00Z`;
      this.stmts.insertCheckpoint.run(
        runName,
        startYear,
        startDate,
        1,
        null,
        0,
        0,
        0,
        1
      );
      cp = this.stmts.getCheckpoint.get(runName);
    }
    return cp;
  }

  /**
   * Updates progress counters after batch
   */
  updateProgress(checkpointId, currentDate, page, lastReplayId, dlDelta, procDelta, failDelta) {
    this.stmts.updateCheckpointCounters.run(
      dlDelta,
      procDelta,
      failDelta,
      currentDate,
      page,
      lastReplayId,
      checkpointId
    );
  }

  /**
   * Create a new operational batch run
   */
  createBatchRun({ batchId, runName, filterCriteria = null, batchSize = 100, lifecycleState = 'queued' }) {
    const filterJson = filterCriteria ? (typeof filterCriteria === 'string' ? filterCriteria : JSON.stringify(filterCriteria)) : null;
    this.stmts.insertBatchRun.run(batchId, runName, lifecycleState, filterJson, batchSize);
    return this.getBatchRun(batchId);
  }

  /**
   * Update lifecycle and counts for a batch run
   */
  updateBatchRun(batchId, updates = {}) {
    const current = this.getBatchRun(batchId);
    if (!current) return null;

    const lifecycleState = updates.lifecycleState ?? current.lifecycle_state;
    const discoveredCount = updates.discoveredCount ?? current.discovered_count;
    const downloadedCount = updates.downloadedCount ?? current.downloaded_count;
    const processedCount = updates.processedCount ?? current.processed_count;
    const skippedCount = updates.skippedCount ?? current.skipped_count;
    const failedCount = updates.failedCount ?? current.failed_count;
    const storageBytes = updates.storageBytes ?? current.storage_bytes;
    const throughputRpm = updates.throughputRpm ?? current.throughput_rpm;
    const completedAt = updates.completedAt ?? current.completed_at;
    const errorMessage = updates.errorMessage ?? current.error_message;

    this.stmts.updateBatchRun.run(
      lifecycleState,
      discoveredCount,
      downloadedCount,
      processedCount,
      skippedCount,
      failedCount,
      storageBytes,
      throughputRpm,
      completedAt,
      errorMessage,
      batchId
    );

    return this.getBatchRun(batchId);
  }

  /**
   * List recent batch runs
   */
  getBatchRuns(limit = 50) {
    return this.stmts.getBatchRuns.all(limit);
  }

  /**
   * Get single batch run by ID
   */
  getBatchRun(batchId) {
    return this.stmts.getBatchRun.get(batchId) || null;
  }

  /**
   * Get the most recent batch run
   */
  getLatestBatchRun() {
    return this.stmts.getLatestBatchRun.get() || null;
  }
}
