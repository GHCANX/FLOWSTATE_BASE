import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AnalyticsService } from '../../src/query/analyticsService.js';
import { PayloadBuilder } from '../../src/analysis/payloadBuilder.js';
import { ReplayRepository } from '../../src/database/repository.js';
import { getDatabase, closeDatabase } from '../../src/database/db.js';

const TEST_DB = path.resolve('./test_analytics_db.db');
const TEST_PAYLOADS = path.resolve('./test_analytics_payloads');

function createFullMechanics(playerIndex, overrides = {}) {
  return {
    playerIndex,
    lCancelSuccess: 0,
    lCancelFail: 0,
    lCancelRate: 0,
    wavedashCount: 0,
    wavelandCount: 0,
    dashDanceTurns: 0,
    dashDanceStrings: 0,
    edgeCancels: 0,
    ledgeGrabs: 0,
    ledgedashCount: 0,
    avgGalintFrames: 0,
    shieldDrops: 0,
    crouchCancels: 0,
    amsahTechs: 0,
    vCancels: 0,
    slideOffs: 0,
    powershieldsPhysical: 0,
    powershieldsProjectile: 0,
    oosGrabs: 0,
    oosAerials: 0,
    oosSmashes: 0,
    oosWavedashes: 0,
    oosRolls: 0,
    oosSpotdodges: 0,
    techNeutral: 0,
    techIn: 0,
    techAway: 0,
    techMiss: 0,
    wallTechSuccess: 0,
    wallTechMiss: 0,
    sdiInputs: 0,
    phantomHits: 0,
    floatCancels: 0,
    jcGrabs: 0,
    boostGrabs: 0,
    multishines: 0,
    ...overrides,
  };
}

describe('AnalyticsService Integration', () => {
  let repository;
  let payloadBuilder;
  let analytics;

  beforeEach(() => {
    closeDatabase();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    if (fs.existsSync(`${TEST_DB}-wal`)) fs.unlinkSync(`${TEST_DB}-wal`);
    if (fs.existsSync(`${TEST_DB}-shm`)) fs.unlinkSync(`${TEST_DB}-shm`);
    if (fs.existsSync(TEST_PAYLOADS)) fs.rmSync(TEST_PAYLOADS, { recursive: true, force: true });

    fs.mkdirSync(TEST_PAYLOADS, { recursive: true });

    getDatabase(TEST_DB);
    repository = new ReplayRepository(TEST_DB);
    payloadBuilder = new PayloadBuilder(TEST_PAYLOADS);
    analytics = new AnalyticsService(TEST_DB, payloadBuilder);

    // Seed match 1: Complete match between Fox (P1#001) and Marth (P2#002) on Battlefield
    const pPath1 = payloadBuilder.savePayload({
      gameId: 'game_comp_1',
      startAt: '2023-03-01T10:00:00Z',
      stageId: 31,
      stocks: [{ playerIndex: 0, frame: 1000 }],
      conversions: [],
      habits: {},
    });

    repository.saveProcessedGame(
      {
        gameId: 'game_comp_1',
        fileHash: 'hash_comp_1',
        startAt: '2023-03-01T10:00:00Z',
        durationFrames: 4000,
        durationSeconds: 66.6,
        stageId: 31,
        gameMode: 2,
        isTeams: false,
        winnerPort: 1,
        payloadPath: pPath1,
      },
      [
        { playerIndex: 0, port: 1, characterId: 2, connectCode: 'P1#001', isWinner: true },
        { playerIndex: 1, port: 2, characterId: 9, connectCode: 'P2#002', isWinner: false },
      ],
      [
        { playerIndex: 0, inputsTotal: 500, ipm: 300, digitalIpm: 250, neutralWinRatio: 0.6, counterHitRatio: 0.1, beneficialTradeRatio: 0.2, openingsPerKill: 2.0, damagePerOpening: 30.0, totalDamageDealt: 120, killCount: 4, conversionCount: 4 },
        { playerIndex: 1, inputsTotal: 400, ipm: 240, digitalIpm: 200, neutralWinRatio: 0.4, counterHitRatio: 0.2, beneficialTradeRatio: 0.1, openingsPerKill: 4.0, damagePerOpening: 20.0, totalDamageDealt: 80, killCount: 1, conversionCount: 2 },
      ],
      [
        createFullMechanics(0, { lCancelSuccess: 15, lCancelFail: 5, lCancelRate: 75.0, wavedashCount: 10 }),
        createFullMechanics(1, { lCancelSuccess: 10, lCancelFail: 5, lCancelRate: 66.7, wavedashCount: 6 }),
      ],
      [
        { playerIndex: 0, connectCode: 'P1#001', characterId: 2, isComplete: 1, climb_count: 4, climb_punished: 1 },
        { playerIndex: 1, connectCode: 'P2#002', characterId: 9, isComplete: 1, climb_count: 5, climb_punished: 2 },
      ]
    );

    // Seed match 2: Incomplete match (LRAS / short match)
    const pPath2 = payloadBuilder.savePayload({
      gameId: 'game_incomp_2',
      startAt: '2023-03-02T10:00:00Z',
      stageId: 32,
      habits: {},
    });

    repository.saveProcessedGame(
      {
        gameId: 'game_incomp_2',
        fileHash: 'hash_incomp_2',
        startAt: '2023-03-02T10:00:00Z',
        durationFrames: 500,
        durationSeconds: 8.3,
        stageId: 32,
        gameMode: 2,
        isTeams: false,
        winnerPort: 2,
        payloadPath: pPath2,
      },
      [
        { playerIndex: 0, port: 1, characterId: 2, connectCode: 'P1#001', isWinner: false },
        { playerIndex: 1, port: 2, characterId: 9, connectCode: 'P2#002', isWinner: true },
      ],
      [
        { playerIndex: 0, inputsTotal: 100, ipm: 300, digitalIpm: 250, neutralWinRatio: 0.2, counterHitRatio: 0.1, beneficialTradeRatio: 0.1, openingsPerKill: 0, damagePerOpening: 0, totalDamageDealt: 10, killCount: 0, conversionCount: 0 },
        { playerIndex: 1, inputsTotal: 120, ipm: 350, digitalIpm: 300, neutralWinRatio: 0.8, counterHitRatio: 0.1, beneficialTradeRatio: 0.1, openingsPerKill: 1.0, damagePerOpening: 50.0, totalDamageDealt: 50, killCount: 1, conversionCount: 1 },
      ],
      [
        createFullMechanics(0, { lCancelSuccess: 2, lCancelRate: 100.0, wavedashCount: 2 }),
        createFullMechanics(1, { lCancelSuccess: 3, lCancelRate: 100.0, wavedashCount: 3 }),
      ],
      [
        // Flagged isComplete = 0
        { playerIndex: 0, connectCode: 'P1#001', characterId: 2, isComplete: 0, climb_count: 10, climb_punished: 10 },
        { playerIndex: 1, connectCode: 'P2#002', characterId: 9, isComplete: 0, climb_count: 10, climb_punished: 10 },
      ]
    );
  });

  afterEach(() => {
    closeDatabase();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    if (fs.existsSync(`${TEST_DB}-wal`)) fs.unlinkSync(`${TEST_DB}-wal`);
    if (fs.existsSync(`${TEST_DB}-shm`)) fs.unlinkSync(`${TEST_DB}-shm`);
    if (fs.existsSync(TEST_PAYLOADS)) fs.rmSync(TEST_PAYLOADS, { recursive: true, force: true });
  });

  it('computes global overview statistics', () => {
    const overview = analytics.getGlobalOverview();
    assert.strictEqual(overview.totalGames, 2);
    assert.strictEqual(overview.totalPlayers, 2);
    assert.ok(overview.topCharacters.length >= 2);
    assert.ok(overview.averageMechanics);
    assert.ok(overview.averageMechanics.avg_l_cancel_rate > 0);
  });

  it('generates player scouting report for known player and null for unknown', () => {
    const report = analytics.getPlayerScoutingReport('P1#001');
    assert.ok(report);
    assert.strictEqual(report.totalGames, 2);
    assert.strictEqual(report.record.wins, 1);
    assert.strictEqual(report.record.losses, 1);
    assert.strictEqual(report.record.winRate, 50.0);
    assert.strictEqual(report.overall.avg_ipm, 300);

    const unknownReport = analytics.getPlayerScoutingReport('NONEXISTENT#999');
    assert.strictEqual(unknownReport, null);
  });

  it('retrieves full game details with decompressed payload', () => {
    const details = analytics.getFullGameDetails('game_comp_1');
    assert.ok(details);
    assert.strictEqual(details.game.game_id, 'game_comp_1');
    assert.strictEqual(details.players.length, 2);
    assert.ok(details.deepPayload);
    assert.strictEqual(details.deepPayload.gameId, 'game_comp_1');
    assert.strictEqual(details.deepPayload.stocks.length, 1);

    const missingDetails = analytics.getFullGameDetails('missing_game_id');
    assert.strictEqual(missingDetails, null);
  });

  it('analyzes head-to-head matchup between Fox and Marth', () => {
    // Fox = 2, Marth = 9
    const analysis = analytics.getMatchupAnalysis(2, 9);
    assert.ok(analysis);
    assert.strictEqual(analysis.totalGames, 2);
    assert.strictEqual(analysis.charAWins, 1);
    assert.strictEqual(analysis.charBWins, 1);
    assert.strictEqual(analysis.charAWinRate, 50.0);
    assert.strictEqual(analysis.stageBreakdown.length, 2);

    const emptyAnalysis = analytics.getMatchupAnalysis(0, 1); // Falcon vs DK (no games)
    assert.strictEqual(emptyAnalysis, null);
  });

  it('exports dataset in JSON and CSV formats', () => {
    const jsonStr = analytics.exportDataset('json');
    const parsed = JSON.parse(jsonStr);
    assert.ok(Array.isArray(parsed));
    assert.strictEqual(parsed.length, 4); // 2 games * 2 players

    const csvStr = analytics.exportDataset('csv');
    assert.ok(csvStr.startsWith('game_id,start_at,duration_seconds,stage_id'));
    assert.ok(csvStr.includes('game_comp_1'));
    assert.ok(csvStr.includes('game_incomp_2'));
  });

  it('retrieves match-level habits with stats', () => {
    const habits = analytics.getGameHabits('game_comp_1');
    assert.ok(habits);
    assert.strictEqual(habits.gameId, 'game_comp_1');
    assert.strictEqual(habits.players.length, 2);

    const p0Habits = habits.players[0];
    assert.strictEqual(p0Habits.stats.climb_count, 4);
    assert.strictEqual(p0Habits.stats.climb_punished, 1);
  });

  it('strictly excludes incomplete matches from rolling player habits profiles', () => {
    const profile = analytics.getPlayerHabitsProfile('P1#001');
    assert.ok(profile);
    assert.strictEqual(profile.connectCode, 'P1#001');
    // Only game_comp_1 should be counted (game_incomp_2 had is_complete = 0)
    assert.strictEqual(profile.totalGames, 1);
    assert.strictEqual(profile.totals.climb_count, 4);
    assert.strictEqual(profile.totals.climb_punished, 1);
  });

  it('applies query filters to rolling player habit profile', () => {
    // Filter matching Battlefield (stageId = 31)
    const profileBf = analytics.getPlayerHabitsProfile('P1#001', { stageId: 31 });
    assert.strictEqual(profileBf.totalGames, 1);

    // Filter non-matching stage (e.g. Yoshi's Story = 8)
    const profileYs = analytics.getPlayerHabitsProfile('P1#001', { stageId: 8 });
    assert.strictEqual(profileYs.totalGames, 0);

    // Filter by opponent connect code
    const profileOpp = analytics.getPlayerHabitsProfile('P1#001', { opponentConnectCode: 'P2#002' });
    assert.strictEqual(profileOpp.totalGames, 1);
  });
});
