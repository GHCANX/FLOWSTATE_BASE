import { getDatabase } from '../database/db.js';
import { PayloadBuilder } from '../analysis/payloadBuilder.js';

export class AnalyticsService {
  /**
   * @param {string} [dbPath]
   * @param {PayloadBuilder} [payloadBuilder]
   */
  constructor(dbPath = './analytics.db', payloadBuilder = new PayloadBuilder()) {
    this.db = getDatabase(dbPath);
    this.payloadBuilder = payloadBuilder;
  }

  /**
   * Returns high-level global dataset overview
   */
  getGlobalOverview() {
    const totalGames = this.db.prepare('SELECT COUNT(*) as count FROM games').get().count;
    const totalPlayers = this.db.prepare('SELECT COUNT(DISTINCT connect_code) as count FROM game_players WHERE connect_code IS NOT NULL').get().count;
    const dateRange = this.db.prepare('SELECT MIN(start_at) as earliest, MAX(start_at) as latest FROM games').get();
    
    const topChars = this.db.prepare(`
      SELECT character_id, COUNT(*) as games_played
      FROM game_players
      GROUP BY character_id
      ORDER BY games_played DESC
      LIMIT 5
    `).all();

    const avgMechanics = this.db.prepare(`
      SELECT 
        AVG(l_cancel_rate) as avg_l_cancel_rate,
        AVG(wavedash_count) as avg_wavedashes,
        AVG(dash_dance_turns) as avg_dash_turns,
        AVG(shield_drops) as avg_shield_drops
      FROM player_mechanics_stats
    `).get();

    return {
      totalGames,
      totalPlayers,
      dateRange,
      topCharacters: topChars,
      averageMechanics: avgMechanics,
    };
  }

  /**
   * Generates a player scouting summary across all their recorded matches
   * @param {string} connectCode e.g. 'MANG#0'
   */
  getPlayerScoutingReport(connectCode) {
    const playerGames = this.db.prepare(`
      SELECT gp.*, g.stage_id, g.start_at, g.duration_seconds
      FROM game_players gp
      JOIN games g ON gp.game_id = g.game_id
      WHERE gp.connect_code = ?
      ORDER BY g.start_at DESC
    `).all(connectCode);

    if (playerGames.length === 0) {
      return null;
    }

    const wins = playerGames.filter(g => g.is_winner).length;
    const losses = playerGames.length - wins;

    const mechStats = this.db.prepare(`
      SELECT 
        AVG(m.l_cancel_rate) as avg_l_cancel_rate,
        SUM(m.wavedash_count) as total_wavedashes,
        AVG(m.wavedash_count) as avg_wavedashes,
        SUM(m.ledgedash_count) as total_ledgedashes,
        AVG(m.avg_galint_frames) as avg_galint,
        SUM(m.shield_drops) as total_shield_drops,
        SUM(m.crouch_cancels) as total_crouch_cancels,
        SUM(m.tech_neutral) as tech_neutral,
        SUM(m.tech_in) as tech_in,
        SUM(m.tech_away) as tech_away,
        SUM(m.tech_miss) as tech_miss,
        SUM(m.oos_grabs) as oos_grabs,
        SUM(m.oos_aerials) as oos_aerials,
        SUM(m.oos_wavedashes) as oos_wavedashes
      FROM player_mechanics_stats m
      JOIN game_players gp ON m.game_id = gp.game_id AND m.player_index = gp.player_index
      WHERE gp.connect_code = ?
    `).get(connectCode);

    const overallStats = this.db.prepare(`
      SELECT 
        AVG(ipm) as avg_ipm,
        AVG(openings_per_kill) as avg_openings_per_kill,
        AVG(damage_per_opening) as avg_damage_per_opening,
        AVG(neutral_win_ratio) as avg_neutral_win_ratio
      FROM player_overall_stats os
      JOIN game_players gp ON os.game_id = gp.game_id AND os.player_index = gp.player_index
      WHERE gp.connect_code = ?
    `).get(connectCode);

    return {
      connectCode,
      totalGames: playerGames.length,
      record: { wins, losses, winRate: (wins / playerGames.length) * 100 },
      overall: overallStats,
      mechanics: mechStats,
    };
  }

  /**
   * Retrieves full game data including decompressed deep payload
   * @param {string} gameId 
   */
  getFullGameDetails(gameId) {
    const game = this.db.prepare('SELECT * FROM games WHERE game_id = ?').get(gameId);
    if (!game) return null;

    const players = this.db.prepare('SELECT * FROM game_players WHERE game_id = ?').all(gameId);
    const overall = this.db.prepare('SELECT * FROM player_overall_stats WHERE game_id = ?').all(gameId);
    const mechanics = this.db.prepare('SELECT * FROM player_mechanics_stats WHERE game_id = ?').all(gameId);

    let deepPayload = null;
    if (game.payload_path) {
      try {
        deepPayload = this.payloadBuilder.loadPayload(game.payload_path);
      } catch (err) {
        console.warn(`Could not load deep payload for ${gameId}: ${err.message}`);
      }
    }

    return {
      game,
      players,
      overall,
      mechanics,
      deepPayload,
    };
  }

  /**
   * Generates a head-to-head matchup breakdown between two characters
   * @param {number} charA Character ID
   * @param {number} charB Character ID
   */
  getMatchupAnalysis(charA, charB) {
    const isMirror = charA === charB;
    const condition = isMirror
      ? 'pA.player_index < pB.player_index'
      : 'pA.player_index != pB.player_index';

    const query = `
      SELECT 
        g.game_id,
        g.stage_id,
        g.start_at,
        g.duration_seconds,
        pA.player_index as pA_index,
        pA.character_id as pA_char,
        pA.connect_code as pA_code,
        pA.is_winner as pA_winner,
        pB.player_index as pB_index,
        pB.character_id as pB_char,
        pB.connect_code as pB_code,
        pB.is_winner as pB_winner,
        mA.l_cancel_rate as mA_l_cancel_rate,
        mA.wavedash_count as mA_wavedashes,
        mA.dash_dance_turns as mA_dash_turns,
        mA.shield_drops as mA_shield_drops,
        mB.l_cancel_rate as mB_l_cancel_rate,
        mB.wavedash_count as mB_wavedashes,
        mB.dash_dance_turns as mB_dash_turns,
        mB.shield_drops as mB_shield_drops,
        oA.ipm as oA_ipm,
        oA.openings_per_kill as oA_opk,
        oA.damage_per_opening as oA_dpo,
        oB.ipm as oB_ipm,
        oB.openings_per_kill as oB_opk,
        oB.damage_per_opening as oB_dpo
      FROM games g
      JOIN game_players pA ON g.game_id = pA.game_id AND pA.character_id = ?
      JOIN game_players pB ON g.game_id = pB.game_id AND pB.character_id = ? AND ${condition}
      LEFT JOIN player_mechanics_stats mA ON g.game_id = mA.game_id AND pA.player_index = mA.player_index
      LEFT JOIN player_mechanics_stats mB ON g.game_id = mB.game_id AND pB.player_index = mB.player_index
      LEFT JOIN player_overall_stats oA ON g.game_id = oA.game_id AND pA.player_index = oA.player_index
      LEFT JOIN player_overall_stats oB ON g.game_id = oB.game_id AND pB.player_index = oB.player_index
      ORDER BY g.start_at DESC
    `;

    const rows = this.db.prepare(query).all(charA, charB);
    if (rows.length === 0) {
      return null;
    }

    let aWins = 0;
    let bWins = 0;
    const stageMap = new Map();

    const statsSum = {
      mA_l_cancel: 0, mA_l_cancel_cnt: 0,
      mB_l_cancel: 0, mB_l_cancel_cnt: 0,
      mA_wavedashes: 0, mB_wavedashes: 0,
      mA_dash_turns: 0, mB_dash_turns: 0,
      mA_shield_drops: 0, mB_shield_drops: 0,
      oA_ipm: 0, oB_ipm: 0,
      oA_opk: 0, oA_opk_cnt: 0,
      oB_opk: 0, oB_opk_cnt: 0,
      oA_dpo: 0, oA_dpo_cnt: 0,
      oB_dpo: 0, oB_dpo_cnt: 0,
    };

    for (const r of rows) {
      if (r.pA_winner) aWins++;
      if (r.pB_winner) bWins++;

      // Stage stats
      if (!stageMap.has(r.stage_id)) {
        stageMap.set(r.stage_id, { stageId: r.stage_id, total: 0, aWins: 0, bWins: 0 });
      }
      const s = stageMap.get(r.stage_id);
      s.total++;
      if (r.pA_winner) s.aWins++;
      if (r.pB_winner) s.bWins++;

      // Metric sums
      if (r.mA_l_cancel_rate != null) { statsSum.mA_l_cancel += r.mA_l_cancel_rate; statsSum.mA_l_cancel_cnt++; }
      if (r.mB_l_cancel_rate != null) { statsSum.mB_l_cancel += r.mB_l_cancel_rate; statsSum.mB_l_cancel_cnt++; }
      statsSum.mA_wavedashes += (r.mA_wavedashes || 0);
      statsSum.mB_wavedashes += (r.mB_wavedashes || 0);
      statsSum.mA_dash_turns += (r.mA_dash_turns || 0);
      statsSum.mB_dash_turns += (r.mB_dash_turns || 0);
      statsSum.mA_shield_drops += (r.mA_shield_drops || 0);
      statsSum.mB_shield_drops += (r.mB_shield_drops || 0);
      statsSum.oA_ipm += (r.oA_ipm || 0);
      statsSum.oB_ipm += (r.oB_ipm || 0);
      if (r.oA_opk != null) { statsSum.oA_opk += r.oA_opk; statsSum.oA_opk_cnt++; }
      if (r.oB_opk != null) { statsSum.oB_opk += r.oB_opk; statsSum.oB_opk_cnt++; }
      if (r.oA_dpo != null) { statsSum.oA_dpo += r.oA_dpo; statsSum.oA_dpo_cnt++; }
      if (r.oB_dpo != null) { statsSum.oB_dpo += r.oB_dpo; statsSum.oB_dpo_cnt++; }
    }

    const n = rows.length;
    const stages = Array.from(stageMap.values()).map(s => ({
      stageId: s.stageId,
      totalGames: s.total,
      charAWins: s.aWins,
      charBWins: s.bWins,
      charAWinRate: s.total > 0 ? (s.aWins / s.total) * 100 : 0,
    }));

    return {
      charA,
      charB,
      totalGames: n,
      charAWins: aWins,
      charBWins: bWins,
      charAWinRate: (aWins / n) * 100,
      stageBreakdown: stages,
      averages: {
        charA: {
          avg_l_cancel_rate: statsSum.mA_l_cancel_cnt ? statsSum.mA_l_cancel / statsSum.mA_l_cancel_cnt : 0,
          avg_wavedashes: statsSum.mA_wavedashes / n,
          avg_dash_turns: statsSum.mA_dash_turns / n,
          avg_shield_drops: statsSum.mA_shield_drops / n,
          avg_ipm: statsSum.oA_ipm / n,
          avg_openings_per_kill: statsSum.oA_opk_cnt ? statsSum.oA_opk / statsSum.oA_opk_cnt : 0,
          avg_damage_per_opening: statsSum.oA_dpo_cnt ? statsSum.oA_dpo / statsSum.oA_dpo_cnt : 0,
        },
        charB: {
          avg_l_cancel_rate: statsSum.mB_l_cancel_cnt ? statsSum.mB_l_cancel / statsSum.mB_l_cancel_cnt : 0,
          avg_wavedashes: statsSum.mB_wavedashes / n,
          avg_dash_turns: statsSum.mB_dash_turns / n,
          avg_shield_drops: statsSum.mB_shield_drops / n,
          avg_ipm: statsSum.oB_ipm / n,
          avg_openings_per_kill: statsSum.oB_opk_cnt ? statsSum.oB_opk / statsSum.oB_opk_cnt : 0,
          avg_damage_per_opening: statsSum.oB_dpo_cnt ? statsSum.oB_dpo / statsSum.oB_dpo_cnt : 0,
        },
      },
    };
  }

  /**
   * Export summary dataset for data science and visualization
   * @param {'json' | 'csv'} [format]
   */
  exportDataset(format = 'json') {
    const games = this.db.prepare(`
      SELECT 
        g.game_id, g.start_at, g.duration_seconds, g.stage_id, g.winner_port,
        p.player_index, p.port, p.character_id, p.connect_code, p.is_winner,
        m.l_cancel_rate, m.wavedash_count, m.dash_dance_turns, m.shield_drops,
        m.crouch_cancels, m.avg_galint_frames, m.ledgedash_count,
        o.ipm, o.openings_per_kill, o.damage_per_opening, o.total_damage_dealt
      FROM games g
      JOIN game_players p ON g.game_id = p.game_id
      LEFT JOIN player_mechanics_stats m ON g.game_id = m.game_id AND p.player_index = m.player_index
      LEFT JOIN player_overall_stats o ON g.game_id = o.game_id AND p.player_index = o.player_index
      ORDER BY g.start_at DESC
    `).all();

    if (format === 'csv') {
      if (games.length === 0) return 'game_id,start_at,duration_seconds,stage_id,winner_port,player_index,port,character_id,connect_code,is_winner,l_cancel_rate,wavedash_count,dash_dance_turns,shield_drops,crouch_cancels,avg_galint_frames,ledgedash_count,ipm,openings_per_kill,damage_per_opening,total_damage_dealt\n';
      const headers = Object.keys(games[0]).join(',');
      const rows = games.map(row => 
        Object.values(row).map(val => (val === null || val === undefined ? '' : JSON.stringify(val))).join(',')
      );
      return [headers, ...rows].join('\n');
    }

    return JSON.stringify(games, null, 2);
  }

  /**
   * Retrieves per-player habit breakdowns and event timelines for a game
   * @param {string} gameId 
   * @param {Object} [options]
   * @param {number} [options.playerIndex]
   * @param {number} [options.port]
   */
  getGameHabits(gameId, options = {}) {
    const game = this.db.prepare('SELECT * FROM games WHERE game_id = ?').get(gameId);
    if (!game) return null;

    let deepPayload = null;
    if (game.payload_path) {
      try {
        deepPayload = this.payloadBuilder.loadPayload(game.payload_path);
      } catch (err) {
        // payload file might not exist in mocked tests or uncompressed runs
      }
    }

    let query = `
      SELECT phs.*, gp.port, gp.connect_code as player_connect_code, gp.character_id as player_character_id
      FROM player_habits_stats phs
      LEFT JOIN game_players gp ON phs.game_id = gp.game_id AND phs.player_index = gp.player_index
      WHERE phs.game_id = ?
    `;
    const params = [gameId];

    if (options.playerIndex !== undefined && options.playerIndex !== null) {
      query += ' AND phs.player_index = ?';
      params.push(Number(options.playerIndex));
    } else if (options.port !== undefined && options.port !== null) {
      query += ' AND gp.port = ?';
      params.push(Number(options.port));
    }

    query += ' ORDER BY phs.player_index ASC';

    const rows = this.db.prepare(query).all(...params);
    const habitsData = deepPayload?.habits || {};

    const players = rows.map(row => {
      const pIdx = row.player_index;
      const events = {
        getupEvents: (habitsData.getupEvents || []).filter(e => e.playerIndex === pIdx),
        grabTriggers: (habitsData.grabTriggers || []).filter(e => e.playerIndex === pIdx),
        transitionDecisions: (habitsData.transitionDecisions || []).filter(e => e.playerIndex === pIdx),
        escapeSequences: (habitsData.escapeSequences || []).filter(e => e.playerIndex === pIdx),
      };

      const stats = {
        climb_count: row.climb_count,
        climb_punished: row.climb_punished,
        attack_count: row.attack_count,
        attack_punished: row.attack_punished,
        roll_count: row.roll_count,
        roll_punished: row.roll_punished,
        jump_count: row.jump_count,
        jump_punished: row.jump_punished,
        ledgedash_count: row.ledgedash_count,
        ledgedash_punished: row.ledgedash_punished,
        tech_neutral_count: row.tech_neutral_count,
        tech_neutral_punished: row.tech_neutral_punished,
        tech_forward_count: row.tech_forward_count,
        tech_forward_punished: row.tech_forward_punished,
        tech_back_count: row.tech_back_count,
        tech_back_punished: row.tech_back_punished,
        tech_miss_count: row.tech_miss_count,
        tech_miss_punished: row.tech_miss_punished,
        wakeup_stand_count: row.wakeup_stand_count,
        wakeup_stand_punished: row.wakeup_stand_punished,
        wakeup_forward_count: row.wakeup_forward_count,
        wakeup_forward_punished: row.wakeup_forward_punished,
        wakeup_back_count: row.wakeup_back_count,
        wakeup_back_punished: row.wakeup_back_punished,
        wakeup_attack_count: row.wakeup_attack_count,
        wakeup_attack_punished: row.wakeup_attack_punished,
        grabs_shield_pressure: row.grabs_shield_pressure,
        grabs_scramble: row.grabs_scramble,
        grabs_neutral: row.grabs_neutral,
        neutral_resets: row.neutral_resets,
        over_extensions: row.over_extensions,
        oos_roll_count: row.oos_roll_count,
        oos_roll_punished: row.oos_roll_punished,
        oos_spotdodge_count: row.oos_spotdodge_count,
        oos_spotdodge_punished: row.oos_spotdodge_punished,
        oos_grab_count: row.oos_grab_count,
        oos_grab_punished: row.oos_grab_punished,
        oos_aerial_count: row.oos_aerial_count,
        oos_aerial_punished: row.oos_aerial_punished,
        corner_drift_count: row.corner_drift_count,
      };

      return {
        playerIndex: row.player_index,
        port: row.port,
        connectCode: row.connect_code || row.player_connect_code,
        characterId: row.character_id || row.player_character_id,
        isComplete: Boolean(row.is_complete),
        stats,
        events,
        ...row,
      };
    });

    return {
      gameId: game.game_id,
      isComplete: rows.length > 0 ? Boolean(rows[0].is_complete) : true,
      players,
    };
  }

  /**
   * Computes rolling aggregate habit frequencies and punish percentages for a player
   * @param {string} connectCode 
   * @param {Object} [filters]
   * @param {string} [filters.opponentConnectCode]
   * @param {number} [filters.characterId]
   * @param {number} [filters.opponentCharacterId]
   * @param {number} [filters.stageId]
   */
  getPlayerHabitsProfile(connectCode, filters = {}) {
    let query = `
      SELECT 
        phs.connect_code,
        COUNT(DISTINCT phs.game_id) as total_games,
        
        -- Ledge Options
        SUM(phs.climb_count) as climb_count,
        SUM(phs.climb_punished) as climb_punished,
        SUM(phs.climb_punished) * 1.0 / NULLIF(SUM(phs.climb_count), 0) as climb_punish_rate,

        SUM(phs.attack_count) as attack_count,
        SUM(phs.attack_punished) as attack_punished,
        SUM(phs.attack_punished) * 1.0 / NULLIF(SUM(phs.attack_count), 0) as attack_punish_rate,

        SUM(phs.roll_count) as roll_count,
        SUM(phs.roll_punished) as roll_punished,
        SUM(phs.roll_punished) * 1.0 / NULLIF(SUM(phs.roll_count), 0) as roll_punish_rate,

        SUM(phs.jump_count) as jump_count,
        SUM(phs.jump_punished) as jump_punished,
        SUM(phs.jump_punished) * 1.0 / NULLIF(SUM(phs.jump_count), 0) as jump_punish_rate,

        SUM(phs.ledgedash_count) as ledgedash_count,
        SUM(phs.ledgedash_punished) as ledgedash_punished,
        SUM(phs.ledgedash_punished) * 1.0 / NULLIF(SUM(phs.ledgedash_count), 0) as ledgedash_punish_rate,

        -- Ground Tech Options
        SUM(phs.tech_neutral_count) as tech_neutral_count,
        SUM(phs.tech_neutral_punished) as tech_neutral_punished,
        SUM(phs.tech_neutral_punished) * 1.0 / NULLIF(SUM(phs.tech_neutral_count), 0) as tech_neutral_punish_rate,

        SUM(phs.tech_forward_count) as tech_forward_count,
        SUM(phs.tech_forward_punished) as tech_forward_punished,
        SUM(phs.tech_forward_punished) * 1.0 / NULLIF(SUM(phs.tech_forward_count), 0) as tech_forward_punish_rate,

        SUM(phs.tech_back_count) as tech_back_count,
        SUM(phs.tech_back_punished) as tech_back_punished,
        SUM(phs.tech_back_punished) * 1.0 / NULLIF(SUM(phs.tech_back_count), 0) as tech_back_punish_rate,

        SUM(phs.tech_miss_count) as tech_miss_count,
        SUM(phs.tech_miss_punished) as tech_miss_punished,
        SUM(phs.tech_miss_punished) * 1.0 / NULLIF(SUM(phs.tech_miss_count), 0) as tech_miss_punish_rate,

        -- Missed-Tech Wakeup Options
        SUM(phs.wakeup_stand_count) as wakeup_stand_count,
        SUM(phs.wakeup_stand_punished) as wakeup_stand_punished,
        SUM(phs.wakeup_stand_punished) * 1.0 / NULLIF(SUM(phs.wakeup_stand_count), 0) as wakeup_stand_punish_rate,

        SUM(phs.wakeup_forward_count) as wakeup_forward_count,
        SUM(phs.wakeup_forward_punished) as wakeup_forward_punished,
        SUM(phs.wakeup_forward_punished) * 1.0 / NULLIF(SUM(phs.wakeup_forward_count), 0) as wakeup_forward_punish_rate,

        SUM(phs.wakeup_back_count) as wakeup_back_count,
        SUM(phs.wakeup_back_punished) as wakeup_back_punished,
        SUM(phs.wakeup_back_punished) * 1.0 / NULLIF(SUM(phs.wakeup_back_count), 0) as wakeup_back_punish_rate,

        SUM(phs.wakeup_attack_count) as wakeup_attack_count,
        SUM(phs.wakeup_attack_punished) as wakeup_attack_punished,
        SUM(phs.wakeup_attack_punished) * 1.0 / NULLIF(SUM(phs.wakeup_attack_count), 0) as wakeup_attack_punish_rate,

        -- Grab Triggers
        SUM(phs.grabs_shield_pressure) as grabs_shield_pressure,
        SUM(phs.grabs_scramble) as grabs_scramble,
        SUM(phs.grabs_neutral) as grabs_neutral,

        -- Transitions
        SUM(phs.neutral_resets) as neutral_resets,
        SUM(phs.over_extensions) as over_extensions,

        -- Out of Shield Choices
        SUM(phs.oos_roll_count) as oos_roll_count,
        SUM(phs.oos_roll_punished) as oos_roll_punished,
        SUM(phs.oos_roll_punished) * 1.0 / NULLIF(SUM(phs.oos_roll_count), 0) as oos_roll_punish_rate,

        SUM(phs.oos_spotdodge_count) as oos_spotdodge_count,
        SUM(phs.oos_spotdodge_punished) as oos_spotdodge_punished,
        SUM(phs.oos_spotdodge_punished) * 1.0 / NULLIF(SUM(phs.oos_spotdodge_count), 0) as oos_spotdodge_punish_rate,

        SUM(phs.oos_grab_count) as oos_grab_count,
        SUM(phs.oos_grab_punished) as oos_grab_punished,
        SUM(phs.oos_grab_punished) * 1.0 / NULLIF(SUM(phs.oos_grab_count), 0) as oos_grab_punish_rate,

        SUM(phs.oos_aerial_count) as oos_aerial_count,
        SUM(phs.oos_aerial_punished) as oos_aerial_punished,
        SUM(phs.oos_aerial_punished) * 1.0 / NULLIF(SUM(phs.oos_aerial_count), 0) as oos_aerial_punish_rate,

        SUM(phs.corner_drift_count) as corner_drift_count

      FROM player_habits_stats phs
      JOIN games g ON phs.game_id = g.game_id
      JOIN game_players p ON phs.game_id = p.game_id AND phs.player_index = p.player_index
      LEFT JOIN game_players opp ON phs.game_id = opp.game_id AND opp.player_index != phs.player_index
      WHERE phs.connect_code = ?
        AND phs.is_complete = 1
    `;

    const params = [connectCode];

    if (filters.opponentConnectCode) {
      query += ' AND opp.connect_code = ?';
      params.push(filters.opponentConnectCode);
    }
    if (filters.characterId != null) {
      query += ' AND p.character_id = ?';
      params.push(Number(filters.characterId));
    }
    if (filters.opponentCharacterId != null) {
      query += ' AND opp.character_id = ?';
      params.push(Number(filters.opponentCharacterId));
    }
    if (filters.stageId != null) {
      query += ' AND g.stage_id = ?';
      params.push(Number(filters.stageId));
    }

    query += ' GROUP BY phs.connect_code';

    const row = this.db.prepare(query).get(...params);
    const gamesAnalyzed = row?.total_games ?? 0;

    const totals = {
      climb_count: row?.climb_count ?? 0,
      climb_punished: row?.climb_punished ?? 0,
      attack_count: row?.attack_count ?? 0,
      attack_punished: row?.attack_punished ?? 0,
      roll_count: row?.roll_count ?? 0,
      roll_punished: row?.roll_punished ?? 0,
      jump_count: row?.jump_count ?? 0,
      jump_punished: row?.jump_punished ?? 0,
      ledgedash_count: row?.ledgedash_count ?? 0,
      ledgedash_punished: row?.ledgedash_punished ?? 0,
      tech_neutral_count: row?.tech_neutral_count ?? 0,
      tech_neutral_punished: row?.tech_neutral_punished ?? 0,
      tech_forward_count: row?.tech_forward_count ?? 0,
      tech_forward_punished: row?.tech_forward_punished ?? 0,
      tech_back_count: row?.tech_back_count ?? 0,
      tech_back_punished: row?.tech_back_punished ?? 0,
      tech_miss_count: row?.tech_miss_count ?? 0,
      tech_miss_punished: row?.tech_miss_punished ?? 0,
      wakeup_stand_count: row?.wakeup_stand_count ?? 0,
      wakeup_stand_punished: row?.wakeup_stand_punished ?? 0,
      wakeup_forward_count: row?.wakeup_forward_count ?? 0,
      wakeup_forward_punished: row?.wakeup_forward_punished ?? 0,
      wakeup_back_count: row?.wakeup_back_count ?? 0,
      wakeup_back_punished: row?.wakeup_back_punished ?? 0,
      wakeup_attack_count: row?.wakeup_attack_count ?? 0,
      wakeup_attack_punished: row?.wakeup_attack_punished ?? 0,
      grabs_shield_pressure: row?.grabs_shield_pressure ?? 0,
      grabs_scramble: row?.grabs_scramble ?? 0,
      grabs_neutral: row?.grabs_neutral ?? 0,
      neutral_resets: row?.neutral_resets ?? 0,
      over_extensions: row?.over_extensions ?? 0,
      oos_roll_count: row?.oos_roll_count ?? 0,
      oos_roll_punished: row?.oos_roll_punished ?? 0,
      oos_spotdodge_count: row?.oos_spotdodge_count ?? 0,
      oos_spotdodge_punished: row?.oos_spotdodge_punished ?? 0,
      oos_grab_count: row?.oos_grab_count ?? 0,
      oos_grab_punished: row?.oos_grab_punished ?? 0,
      oos_aerial_count: row?.oos_aerial_count ?? 0,
      oos_aerial_punished: row?.oos_aerial_punished ?? 0,
      corner_drift_count: row?.corner_drift_count ?? 0,
    };

    const rates = {
      climb_punish_rate: row?.climb_punish_rate ?? null,
      attack_punish_rate: row?.attack_punish_rate ?? null,
      roll_punish_rate: row?.roll_punish_rate ?? null,
      jump_punish_rate: row?.jump_punish_rate ?? null,
      ledgedash_punish_rate: row?.ledgedash_punish_rate ?? null,
      tech_neutral_punish_rate: row?.tech_neutral_punish_rate ?? null,
      tech_forward_punish_rate: row?.tech_forward_punish_rate ?? null,
      tech_back_punish_rate: row?.tech_back_punish_rate ?? null,
      tech_miss_punish_rate: row?.tech_miss_punish_rate ?? null,
      wakeup_stand_punish_rate: row?.wakeup_stand_punish_rate ?? null,
      wakeup_forward_punish_rate: row?.wakeup_forward_punish_rate ?? null,
      wakeup_back_punish_rate: row?.wakeup_back_punish_rate ?? null,
      wakeup_attack_punish_rate: row?.wakeup_attack_punish_rate ?? null,
      oos_roll_punish_rate: row?.oos_roll_punish_rate ?? null,
      oos_spotdodge_punish_rate: row?.oos_spotdodge_punish_rate ?? null,
      oos_grab_punish_rate: row?.oos_grab_punish_rate ?? null,
      oos_aerial_punish_rate: row?.oos_aerial_punish_rate ?? null,
    };

    return {
      connectCode,
      totalGames: gamesAnalyzed,
      gamesAnalyzed,
      total_games: gamesAnalyzed,
      total_climbs: totals.climb_count,
      total_climb_punished: totals.climb_punished,
      total_tech_neutral: totals.tech_neutral_count,
      total_grabs_shield_pressure: totals.grabs_shield_pressure,
      totals,
      rates,
      ...(row || {}),
    };
  }

  /**
   * Alias for getPlayerHabitsProfile for backward and test compatibility
   */
  getPlayerHabits(connectCode, filters = {}) {
    return this.getPlayerHabitsProfile(connectCode, filters);
  }
}

