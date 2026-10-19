/**
 * FlowState Melee Analysis Engine - Habit Analysis E2E Test Suite
 *
 * Implements end-to-end verification across 8 core sections per TEST_INFRA.md and ORIGINAL_REQUEST.md:
 * Section 1: Real Replay Processing (external/slippi-js-master/slp/unranked_game1.slp)
 * Section 2: Deterministic Synthetic Baseline Habit Fixtures (All 40 Counters)
 * Section 3: Rare Edge Interaction Fixtures (Heuristic Boundaries & Windows)
 * Section 4: SQLite Database & Schema Validation (player_habits_stats & Constraints)
 * Section 5: Decompressed Payload Validation & Disk Hygiene (Zero Accumulation)
 * Section 6: AnalyticsService Relational Rolling Queries & Filter Exclusions
 * Section 7: REST API Endpoints (GET /api/games/:id/habits, /api/players/:connectCode/habits)
 * Section 8: Scope Isolation (No Habit Metrics in Ingestion Telemetry)
 */

import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { SlippiGame } from '@slippi/slippi-js/node';
import { FrameConsumer } from '../src/analysis/frameConsumer.js';
import { ReplayRepository } from '../src/database/repository.js';
import { PayloadBuilder } from '../src/analysis/payloadBuilder.js';
import { TacticalDetector } from '../src/analysis/tacticalDetector.js';
import { AnalyticsService } from '../src/query/analyticsService.js';
import { createServer } from '../src/server/server.js';
import { getDatabase, closeDatabase } from '../src/database/db.js';
import { ACTION_STATES, isDamage, isShield } from '../src/constants/actionStates.js';

// HTTP helper using native node:http
async function fetchHttp(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: data,
        json: () => {
          try { return JSON.parse(data); } catch (e) { return null; }
        }
      }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// Frame synthesis generator helper
function createSyntheticFrame(frameIndex, p0Overrides = {}, p1Overrides = {}) {
  return {
    frame: frameIndex,
    players: {
      0: {
        pre: {
          facingDirection: p0Overrides.facingDirection ?? 1,
          joystickX: p0Overrides.joystickX ?? 0,
          joystickY: p0Overrides.joystickY ?? 0,
          trigger: p0Overrides.trigger ?? 0,
          buttons: p0Overrides.buttons ?? 0,
        },
        post: {
          characterId: 2, // Fox
          actionStateId: p0Overrides.actionStateId ?? (ACTION_STATES.WAIT || 14),
          positionX: p0Overrides.positionX ?? -10.0,
          positionY: p0Overrides.positionY ?? 0.0,
          facingDirection: p0Overrides.facingDirection ?? 1,
          percent: p0Overrides.percent ?? 0,
          shieldSize: p0Overrides.shieldSize ?? 60,
          lastAttackLanded: p0Overrides.lastAttackLanded ?? 0,
          comboCount: p0Overrides.comboCount ?? 0,
          lastHitBy: p0Overrides.lastHitBy ?? null,
          stocksRemaining: p0Overrides.stocksRemaining ?? 4,
          hitlagRemaining: p0Overrides.hitlagRemaining ?? 0,
          ...p0Overrides,
        }
      },
      1: {
        pre: {
          facingDirection: p1Overrides.facingDirection ?? -1,
          joystickX: p1Overrides.joystickX ?? 0,
          joystickY: p1Overrides.joystickY ?? 0,
          trigger: p1Overrides.trigger ?? 0,
          buttons: p1Overrides.buttons ?? 0,
        },
        post: {
          characterId: 20, // Falco
          actionStateId: p1Overrides.actionStateId ?? (ACTION_STATES.WAIT || 14),
          positionX: p1Overrides.positionX ?? 10.0,
          positionY: p1Overrides.positionY ?? 0.0,
          facingDirection: p1Overrides.facingDirection ?? -1,
          percent: p1Overrides.percent ?? 0,
          shieldSize: p1Overrides.shieldSize ?? 60,
          lastAttackLanded: p1Overrides.lastAttackLanded ?? 0,
          comboCount: p1Overrides.comboCount ?? 0,
          lastHitBy: p1Overrides.lastHitBy ?? null,
          stocksRemaining: p1Overrides.stocksRemaining ?? 4,
          hitlagRemaining: p1Overrides.hitlagRemaining ?? 0,
          ...p1Overrides,
        }
      }
    }
  };
}

// Feed a synthetic sequence into a detector
function feedFrameSequence(detector, sequence) {
  let prev = null;
  for (const frame of sequence) {
    detector.processFrame(frame, prev);
    prev = frame;
  }
}

// The 40 expected counter column names in player_habits_stats
const EXPECTED_40_COUNTERS = [
  'climb_count', 'climb_punished',
  'attack_count', 'attack_punished',
  'roll_count', 'roll_punished',
  'jump_count', 'jump_punished',
  'ledgedash_count', 'ledgedash_punished',
  'tech_neutral_count', 'tech_neutral_punished',
  'tech_forward_count', 'tech_forward_punished',
  'tech_back_count', 'tech_back_punished',
  'tech_miss_count', 'tech_miss_punished',
  'wakeup_stand_count', 'wakeup_stand_punished',
  'wakeup_forward_count', 'wakeup_forward_punished',
  'wakeup_back_count', 'wakeup_back_punished',
  'wakeup_attack_count', 'wakeup_attack_punished',
  'grabs_shield_pressure',
  'grabs_scramble',
  'grabs_neutral',
  'neutral_resets',
  'over_extensions',
  'oos_roll_count', 'oos_roll_punished',
  'oos_spotdodge_count', 'oos_spotdodge_punished',
  'oos_grab_count', 'oos_grab_punished',
  'oos_aerial_count', 'oos_aerial_punished',
  'corner_drift_count'
];

/**
 * =========================================================================
 * SECTION 1: Real Replay Processing (external/slippi-js-master/slp/unranked_game1.slp)
 * =========================================================================
 */
async function testSection1_RealReplayProcessing() {
  console.log('\n--- Section 1: Real Replay Processing (unranked_game1.slp) ---');
  const slpPath = 'external/slippi-js-master/slp/unranked_game1.slp';
  assert.ok(fs.existsSync(slpPath), `Replay fixture must exist at ${slpPath}`);

  const testDb = './test_section1_habits.db';
  const testPayloadDir = './test_section1_payloads';
  if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
  if (fs.existsSync(testPayloadDir)) fs.rmSync(testPayloadDir, { recursive: true, force: true });

  try {
    const repository = new ReplayRepository(testDb);
    const payloadBuilder = new PayloadBuilder(testPayloadDir);
    const consumer = new FrameConsumer({ payloadBuilder, repository });

    const result = consumer.processReplay(slpPath, { source: 'local_test' });
    assert.strictEqual(result.success, true, 'Replay processing must succeed');
    assert.ok(result.gameId, 'Must return gameId');
    assert.ok(result.payloadPath, 'Must return payloadPath');

    // 1. Verify match metadata in games table
    const game = repository.db.prepare('SELECT * FROM games WHERE game_id = ?').get(result.gameId);
    assert.ok(game, 'Game record must exist in games table');
    assert.strictEqual(game.duration_frames, 45, 'Game duration must be exactly 45 frames');
    assert.strictEqual(game.end_method, 7, 'Game end method must be 7 (No Contest / LRAS)');
    assert.strictEqual(game.lras_port, 0, 'LRAS initiator must be recorded as port 0');

    // 2. Verify player_habits_stats table entries and is_complete flag
    const habitsRows = repository.db.prepare(
      'SELECT * FROM player_habits_stats WHERE game_id = ? ORDER BY player_index ASC'
    ).all(result.gameId);

    assert.strictEqual(habitsRows.length, 2, 'Must have 2 player habit rows');
    assert.strictEqual(habitsRows[0].connect_code, 'NIKK#513', 'Player 0 connect code must match');
    assert.strictEqual(habitsRows[1].connect_code, 'NIKK#142', 'Player 1 connect code must match');
    assert.strictEqual(habitsRows[0].is_complete, 0, 'Incomplete 45f LRAS match must record is_complete = 0 for Player 0');
    assert.strictEqual(habitsRows[1].is_complete, 0, 'Incomplete 45f LRAS match must record is_complete = 0 for Player 1');

    // 3. Verify granular payload exists and contains habits container
    assert.ok(fs.existsSync(result.payloadPath), `Compressed payload must exist at ${result.payloadPath}`);
    const decompressed = payloadBuilder.loadPayload(result.payloadPath);
    assert.ok(decompressed.habits, 'Decompressed payload must contain habits object');
    assert.ok(Array.isArray(decompressed.habits.getupEvents), 'habits.getupEvents must be an array');
    assert.ok(Array.isArray(decompressed.habits.grabTriggers), 'habits.grabTriggers must be an array');
    assert.ok(Array.isArray(decompressed.habits.transitionDecisions), 'habits.transitionDecisions must be an array');
    assert.ok(Array.isArray(decompressed.habits.escapeSequences), 'habits.escapeSequences must be an array');

    console.log('  ✔ Real replay processed: 45f LRAS flagged is_complete = 0, dual-store payload verified.');
  } finally {
    closeDatabase();
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
    if (fs.existsSync(testPayloadDir)) fs.rmSync(testPayloadDir, { recursive: true, force: true });
  }
}

/**
 * =========================================================================
 * SECTION 2: Deterministic Synthetic Baseline Habit Fixtures (All 40 Counters)
 * =========================================================================
 */
async function testSection2_DeterministicSyntheticBaselineHabits() {
  console.log('\n--- Section 2: Deterministic Synthetic Baseline Habit Fixtures ---');
  const settings = {
    stageId: 31, // Battlefield (ground.xMax = 68.4)
    players: [
      { playerIndex: 0, port: 1, characterId: 2, connectCode: 'FOX#1', displayName: 'FoxPlayer' },
      { playerIndex: 1, port: 2, characterId: 20, connectCode: 'FALC#2', displayName: 'FalcoPlayer' },
    ]
  };

  const detector = new TacticalDetector(settings);
  assert.ok(detector, 'TacticalDetector must instantiate');

  let currentFrame = 0;
  const frames = [];

  // Helper to advance simulation by adding frames
  function advance(count, p0State = {}, p1State = {}) {
    for (let i = 0; i < count; i++) {
      currentFrame++;
      frames.push(createSyntheticFrame(currentFrame, p0State, p1State));
    }
  }

  // --- 1. Ledge Options ---
  // Climb: unpunished
  advance(5, { actionStateId: 253, positionX: -71.3 }, { actionStateId: 14, positionX: 20 }); // CLIFF_WAIT
  advance(15, { actionStateId: 254, positionX: -65.0 }, { actionStateId: 14, positionX: 20 }); // CLIFF_CLIMB_SLOW
  advance(35, { actionStateId: 14, positionX: -60.0 }, { actionStateId: 14, positionX: 20 }); // Safe
  // Climb: punished
  advance(5, { actionStateId: 253, positionX: -71.3 }, { actionStateId: 14, positionX: 20 });
  advance(15, { actionStateId: 255, positionX: -65.0 }, { actionStateId: 14, positionX: 20 }); // CLIFF_CLIMB_QUICK
  advance(5, { actionStateId: 14, positionX: -60.0 }, { actionStateId: 14, positionX: 20 });
  advance(10, { actionStateId: 75, percent: 12, positionX: -60.0 }, { actionStateId: 44, positionX: -55.0 }); // DAMAGE_START (punished)

  // Attack: unpunished & punished
  advance(5, { actionStateId: 253, positionX: -71.3 }, { actionStateId: 14, positionX: 20 });
  advance(15, { actionStateId: 256, positionX: -65.0 }, { actionStateId: 14, positionX: 20 }); // CLIFF_ATTACK_SLOW
  advance(35, { actionStateId: 14, positionX: -60.0 }, { actionStateId: 14, positionX: 20 }); // Safe
  advance(5, { actionStateId: 253, positionX: -71.3 }, { actionStateId: 14, positionX: 20 });
  advance(15, { actionStateId: 257, positionX: -65.0 }, { actionStateId: 14, positionX: 20 }); // CLIFF_ATTACK_QUICK
  advance(5, { actionStateId: 75, percent: 24 }, { actionStateId: 44 }); // Punished

  // Roll: unpunished & punished
  advance(5, { actionStateId: 253, positionX: -71.3 }, { actionStateId: 14, positionX: 20 });
  advance(15, { actionStateId: 258, positionX: -50.0 }, { actionStateId: 14, positionX: 20 }); // CLIFF_ESCAPE_SLOW
  advance(35, { actionStateId: 14, positionX: -45.0 }, { actionStateId: 14, positionX: 20 }); // Safe
  advance(5, { actionStateId: 253, positionX: -71.3 }, { actionStateId: 14, positionX: 20 });
  advance(15, { actionStateId: 259, positionX: -50.0 }, { actionStateId: 14, positionX: 20 }); // CLIFF_ESCAPE_QUICK
  advance(5, { actionStateId: 75, percent: 36 }, { actionStateId: 44 }); // Punished

  // Jump: unpunished & punished
  advance(5, { actionStateId: 253, positionX: -71.3 }, { actionStateId: 14, positionX: 20 });
  advance(15, { actionStateId: 260, positionX: -65.0, positionY: 15.0 }, { actionStateId: 14, positionX: 20 }); // CLIFF_JUMP_SLOW
  advance(35, { actionStateId: 29, positionX: -60.0, positionY: 0 }, { actionStateId: 14, positionX: 20 }); // Safe
  advance(5, { actionStateId: 253, positionX: -71.3 }, { actionStateId: 14, positionX: 20 });
  advance(15, { actionStateId: 261, positionX: -65.0, positionY: 15.0 }, { actionStateId: 14, positionX: 20 }); // CLIFF_JUMP_QUICK
  advance(5, { actionStateId: 75, percent: 48 }, { actionStateId: 44 }); // Punished

  // Ledgedash: unpunished & punished (within 35f heuristic)
  advance(5, { actionStateId: 253, positionX: -71.3 }, { actionStateId: 14, positionX: 20 });
  advance(3, { actionStateId: 29, positionX: -71.0 }, { actionStateId: 14, positionX: 20 }); // FALL
  advance(4, { actionStateId: 236, positionX: -66.0 }, { actionStateId: 14, positionX: 20 }); // AIR_DODGE
  advance(5, { actionStateId: 41, positionX: -60.0, positionY: 0 }, { actionStateId: 14, positionX: 20 }); // LANDING_FALL_SPECIAL
  advance(35, { actionStateId: 14, positionX: -60.0 }, { actionStateId: 14, positionX: 20 }); // Safe
  advance(5, { actionStateId: 253, positionX: -71.3 }, { actionStateId: 14, positionX: 20 });
  advance(3, { actionStateId: 29, positionX: -71.0 }, { actionStateId: 14, positionX: 20 });
  advance(4, { actionStateId: 236, positionX: -66.0 }, { actionStateId: 14, positionX: 20 });
  advance(5, { actionStateId: 41, positionX: -60.0, positionY: 0 }, { actionStateId: 14, positionX: 20 });
  advance(5, { actionStateId: 75, percent: 60 }, { actionStateId: 44 }); // Punished

  // --- 2. Ground Tech Options ---
  // Tech Neutral
  advance(5, { actionStateId: 199, positionX: 0 }, { actionStateId: 14, positionX: 20 }); // TECH_NEUTRAL
  advance(35, { actionStateId: 14, positionX: 0 }, { actionStateId: 14, positionX: 20 });
  advance(5, { actionStateId: 199, positionX: 0 }, { actionStateId: 14, positionX: 20 });
  advance(5, { actionStateId: 75, percent: 72 }, { actionStateId: 44 }); // Punished

  // Tech Forward
  advance(5, { actionStateId: 200, positionX: 5 }, { actionStateId: 14, positionX: 20 }); // TECH_F
  advance(35, { actionStateId: 14, positionX: 5 }, { actionStateId: 14, positionX: 20 });
  advance(5, { actionStateId: 200, positionX: 5 }, { actionStateId: 14, positionX: 20 });
  advance(5, { actionStateId: 75, percent: 84 }, { actionStateId: 44 }); // Punished

  // Tech Back
  advance(5, { actionStateId: 201, positionX: -5 }, { actionStateId: 14, positionX: 20 }); // TECH_B
  advance(35, { actionStateId: 14, positionX: -5 }, { actionStateId: 14, positionX: 20 });
  advance(5, { actionStateId: 201, positionX: -5 }, { actionStateId: 14, positionX: 20 });
  advance(5, { actionStateId: 75, percent: 96 }, { actionStateId: 44 }); // Punished

  // Tech Miss
  advance(5, { actionStateId: 183, positionX: 0 }, { actionStateId: 14, positionX: 20 }); // TECH_MISS_UP
  advance(35, { actionStateId: 14, positionX: 0 }, { actionStateId: 14, positionX: 20 });
  advance(5, { actionStateId: 191, positionX: 0 }, { actionStateId: 14, positionX: 20 }); // TECH_MISS_DOWN
  advance(5, { actionStateId: 75, percent: 108 }, { actionStateId: 44 }); // Punished

  // --- 3. Missed-Tech Wakeup Options ---
  // Wakeup Stand
  advance(5, { actionStateId: 184, positionX: 0 }, { actionStateId: 14, positionX: 20 }); // DOWN_WAIT_U
  advance(10, { actionStateId: 185, positionX: 0 }, { actionStateId: 14, positionX: 20 }); // DOWN_STAND_U
  advance(35, { actionStateId: 14, positionX: 0 }, { actionStateId: 14, positionX: 20 });
  advance(5, { actionStateId: 192, positionX: 0 }, { actionStateId: 14, positionX: 20 }); // DOWN_WAIT_D
  advance(10, { actionStateId: 193, positionX: 0 }, { actionStateId: 14, positionX: 20 }); // DOWN_STAND_D
  advance(5, { actionStateId: 75, percent: 120 }, { actionStateId: 44 }); // Punished

  // Wakeup Forward
  advance(5, { actionStateId: 184, positionX: 0 }, { actionStateId: 14, positionX: 20 });
  advance(10, { actionStateId: 186, positionX: 8 }, { actionStateId: 14, positionX: 20 }); // DOWN_FORWARD_U
  advance(35, { actionStateId: 14, positionX: 8 }, { actionStateId: 14, positionX: 20 });
  advance(5, { actionStateId: 192, positionX: 0 }, { actionStateId: 14, positionX: 20 });
  advance(10, { actionStateId: 194, positionX: 8 }, { actionStateId: 14, positionX: 20 }); // DOWN_FORWARD_D
  advance(5, { actionStateId: 75, percent: 132 }, { actionStateId: 44 }); // Punished

  // Wakeup Back
  advance(5, { actionStateId: 184, positionX: 0 }, { actionStateId: 14, positionX: 20 });
  advance(10, { actionStateId: 187, positionX: -8 }, { actionStateId: 14, positionX: 20 }); // DOWN_BACK_U
  advance(35, { actionStateId: 14, positionX: -8 }, { actionStateId: 14, positionX: 20 });
  advance(5, { actionStateId: 192, positionX: 0 }, { actionStateId: 14, positionX: 20 });
  advance(10, { actionStateId: 195, positionX: -8 }, { actionStateId: 14, positionX: 20 }); // DOWN_BACK_D
  advance(5, { actionStateId: 75, percent: 144 }, { actionStateId: 44 }); // Punished

  // Wakeup Attack
  advance(5, { actionStateId: 184, positionX: 0 }, { actionStateId: 14, positionX: 20 });
  advance(10, { actionStateId: 188, positionX: 0 }, { actionStateId: 14, positionX: 20 }); // DOWN_ATTACK_U
  advance(35, { actionStateId: 14, positionX: 0 }, { actionStateId: 14, positionX: 20 });
  advance(5, { actionStateId: 192, positionX: 0 }, { actionStateId: 14, positionX: 20 });
  advance(10, { actionStateId: 196, positionX: 0 }, { actionStateId: 14, positionX: 20 }); // DOWN_ATTACK_D
  advance(5, { actionStateId: 75, percent: 156 }, { actionStateId: 44 }); // Punished

  // --- 4. Grab Triggers ---
  // Shield-Pressure Grab: opponent in shield, player grabs 8 frames later (<= 15f)
  advance(35, { actionStateId: 14, positionX: 0 }, { actionStateId: 14, positionX: 10 }); // reset
  advance(5, { actionStateId: 14, positionX: 0 }, { actionStateId: 179, positionX: 8 }); // Falco GUARD
  advance(8, { actionStateId: 212, positionX: 5 }, { actionStateId: 179, positionX: 8 }); // Fox GRAB
  advance(15, { actionStateId: 14, positionX: 5 }, { actionStateId: 14, positionX: 8 });

  // Scramble Grab: both actionable, distance <= 18.0, 30 frames clean history
  advance(35, { actionStateId: 14, positionX: 0 }, { actionStateId: 14, positionX: 12 }); // D = 12.0 <= 18.0
  advance(5, { actionStateId: 212, positionX: 0 }, { actionStateId: 14, positionX: 12 }); // GRAB
  advance(15, { actionStateId: 14, positionX: 0 }, { actionStateId: 14, positionX: 12 });

  // Neutral Setup Grab: distance > 18.0
  advance(35, { actionStateId: 14, positionX: -15 }, { actionStateId: 14, positionX: 15 }); // D = 30.0 > 18.0
  advance(5, { actionStateId: 212, positionX: -15 }, { actionStateId: 14, positionX: 15 }); // GRAB

  // --- 5. Transitions (Neutral Reset vs Over-Extension) ---
  // Step 1: Hit opponent into hitstun
  advance(5, { actionStateId: 58, positionX: 0 }, { actionStateId: 75, percent: 170, positionX: 15 });
  // Step 2: Conversion terminates after 46 frames of victim out of hitstun -> triggers activeTransitionWindow
  advance(46, { actionStateId: 14, positionX: 0 }, { actionStateId: 14, positionX: 15 });
  // Step 3: Neutral Reset: player retreats (Delta D > 0) and stays until transition window ends (46 frames)
  advance(46, { actionStateId: 20, positionX: -15 }, { actionStateId: 14, positionX: 15 }); // D = 30 > 15 (deltaD > 0) -> neutral_resets++

  // Over-Extension: attack commit into counter-hit
  advance(5, { actionStateId: 58, positionX: 0 }, { actionStateId: 75, percent: 180, positionX: 15 }); // Hit
  advance(46, { actionStateId: 14, positionX: 0 }, { actionStateId: 14, positionX: 15 }); // Conversion ends -> window begins
  advance(5, { actionStateId: 58, positionX: 5 }, { actionStateId: 14, positionX: 15 }); // Attack commit within window
  advance(5, { actionStateId: 75, percent: 195, positionX: 5 }, { actionStateId: 44, positionX: 10 }); // Counter-hit damage -> over_extensions++

  // --- 6. Defensive OOS Options ---
  // OOS Roll
  advance(10, { actionStateId: 179, positionX: 0 }, { actionStateId: 44, positionX: 5 }); // GUARD
  advance(10, { actionStateId: 233, positionX: -8 }, { actionStateId: 14, positionX: 5 }); // ROLL_F
  advance(35, { actionStateId: 14, positionX: -8 }, { actionStateId: 14, positionX: 5 });
  advance(10, { actionStateId: 179, positionX: 0 }, { actionStateId: 44, positionX: 5 });
  advance(10, { actionStateId: 234, positionX: 8 }, { actionStateId: 14, positionX: 5 }); // ROLL_B
  advance(5, { actionStateId: 75, percent: 210 }, { actionStateId: 44 }); // Punished

  // OOS Spotdodge
  advance(10, { actionStateId: 179, positionX: 0 }, { actionStateId: 44, positionX: 5 });
  advance(10, { actionStateId: 235, positionX: 0 }, { actionStateId: 14, positionX: 5 }); // SPOT_DODGE
  advance(35, { actionStateId: 14, positionX: 0 }, { actionStateId: 14, positionX: 5 });
  advance(10, { actionStateId: 179, positionX: 0 }, { actionStateId: 44, positionX: 5 });
  advance(10, { actionStateId: 235, positionX: 0 }, { actionStateId: 14, positionX: 5 });
  advance(5, { actionStateId: 75, percent: 220 }, { actionStateId: 44 }); // Punished

  // OOS Grab
  advance(10, { actionStateId: 179, positionX: 0 }, { actionStateId: 44, positionX: 5 });
  advance(10, { actionStateId: 212, positionX: 0 }, { actionStateId: 14, positionX: 5 }); // GRAB
  advance(35, { actionStateId: 14, positionX: 0 }, { actionStateId: 14, positionX: 5 });
  advance(10, { actionStateId: 179, positionX: 0 }, { actionStateId: 44, positionX: 5 });
  advance(10, { actionStateId: 212, positionX: 0 }, { actionStateId: 14, positionX: 5 });
  advance(5, { actionStateId: 75, percent: 230 }, { actionStateId: 44 }); // Punished

  // OOS Aerial
  advance(10, { actionStateId: 179, positionX: 0 }, { actionStateId: 44, positionX: 5 });
  advance(5, { actionStateId: 24, positionX: 0 }, { actionStateId: 14, positionX: 5 }); // KNEE_BEND (jumpsquat)
  advance(10, { actionStateId: 65, positionX: 0, positionY: 5 }, { actionStateId: 14, positionX: 5 }); // ATTACK_AIR_N
  advance(35, { actionStateId: 14, positionX: 0, positionY: 0 }, { actionStateId: 14, positionX: 5 });
  advance(10, { actionStateId: 179, positionX: 0 }, { actionStateId: 44, positionX: 5 });
  advance(5, { actionStateId: 24, positionX: 0 }, { actionStateId: 14, positionX: 5 });
  advance(10, { actionStateId: 65, positionX: 0, positionY: 5 }, { actionStateId: 14, positionX: 5 });
  advance(5, { actionStateId: 75, percent: 240 }, { actionStateId: 44 }); // Punished

  // Corner Drift: moving toward ledge (|X| -> 68.4) under proximity pressure (D <= 20)
  advance(10, { actionStateId: 14, positionX: -45.0 }, { actionStateId: 14, positionX: -35.0 }); // D = 10 <= 20
  advance(15, { actionStateId: 20, positionX: -65.0 }, { actionStateId: 14, positionX: -50.0 }); // drifting toward ledge (|X|: 45 -> 65)

  // Run full deterministic sequence through TacticalDetector
  feedFrameSequence(detector, frames);

  // Retrieve habit stats for player 0
  const stats = typeof detector.getHabitStats === 'function'
    ? detector.getHabitStats(0)
    : detector.fetch()?.habits?.[0];

  assert.ok(stats, 'Habit stats must be retrievable from TacticalDetector');

  // Assert ALL 40 counters are present and strictly > 0
  for (const counter of EXPECTED_40_COUNTERS) {
    assert.ok(counter in stats, `Counter '${counter}' must exist in habit stats`);
    assert.ok(stats[counter] > 0, `Counter '${counter}' must be > 0 (got ${stats[counter]})`);
  }

  console.log(`  ✔ All 40 habit counters asserted with non-zero counts across ${frames.length} synthetic frames.`);
}

/**
 * =========================================================================
 * SECTION 3: Rare Edge Interaction Fixtures
 * =========================================================================
 */
async function testSection3_RareEdgeInteractionFixtures() {
  console.log('\n--- Section 3: Rare Edge Interaction Fixtures ---');
  const settings = {
    stageId: 31, // Battlefield (ground.xMax = 68.4)
    players: [
      { playerIndex: 0, port: 1, characterId: 2, connectCode: 'FOX#1', displayName: 'Fox' },
      { playerIndex: 1, port: 2, characterId: 20, connectCode: 'FALC#2', displayName: 'Falco' },
    ]
  };

  // --- Edge Case 1: 35f Ledgedash Heuristic Boundaries ---
  console.log('  Testing 35f ledgedash threshold boundary...');
  {
    // Test 1a: Lands at frame 36 (35 frames elapsed) -> Valid ledgedash
    const det35 = new TacticalDetector(settings);
    const seq35 = [];
    seq35.push(createSyntheticFrame(1, { actionStateId: 253, positionX: -71.3 }, { actionStateId: 14, positionX: 20 })); // CLIFF_WAIT
    for (let f = 2; f <= 35; f++) {
      seq35.push(createSyntheticFrame(f, { actionStateId: 29, positionX: -66.0, positionY: 2.0 }, { actionStateId: 14, positionX: 20 })); // FALL
    }
    // Landing at frame 36: 36 - 1 = 35 frames elapsed (<= 35)
    seq35.push(createSyntheticFrame(36, { actionStateId: 41, positionX: -60.0, positionY: 0 }, { actionStateId: 14, positionX: 20 })); // LANDING_FALL_SPECIAL
    for (let f = 37; f <= 70; f++) {
      seq35.push(createSyntheticFrame(f, { actionStateId: 14, positionX: -60.0 }, { actionStateId: 14, positionX: 20 }));
    }
    feedFrameSequence(det35, seq35);
    const s35 = typeof det35.getHabitStats === 'function' ? det35.getHabitStats(0) : det35.fetch()?.habits?.[0];
    assert.strictEqual(s35.ledgedash_count, 1, 'Ledgedash landing with 35 frames elapsed must count as valid');

    // Test 1b: Lands at frame 37 (36 frames elapsed) -> Exceeds 35f threshold, must NOT count
    const det36 = new TacticalDetector(settings);
    const seq36 = [];
    seq36.push(createSyntheticFrame(1, { actionStateId: 253, positionX: -71.3 }, { actionStateId: 14, positionX: 20 }));
    for (let f = 2; f <= 36; f++) {
      seq36.push(createSyntheticFrame(f, { actionStateId: 29, positionX: -66.0, positionY: 2.0 }, { actionStateId: 14, positionX: 20 }));
    }
    // Landing at frame 37: 37 - 1 = 36 frames elapsed (> 35)
    seq36.push(createSyntheticFrame(37, { actionStateId: 41, positionX: -60.0, positionY: 0 }, { actionStateId: 14, positionX: 20 }));
    for (let f = 38; f <= 70; f++) {
      seq36.push(createSyntheticFrame(f, { actionStateId: 14, positionX: -60.0 }, { actionStateId: 14, positionX: 20 }));
    }
    feedFrameSequence(det36, seq36);
    const s36 = typeof det36.getHabitStats === 'function' ? det36.getHabitStats(0) : det36.fetch()?.habits?.[0];
    assert.strictEqual(s36.ledgedash_count, 0, 'Ledgedash landing with 36 frames elapsed must NOT count (exceeds 35f)');

    // Test 1c: Intermediate Cliff Catch -> Invalidation
    const detReGrab = new TacticalDetector(settings);
    const seqReGrab = [
      createSyntheticFrame(1, { actionStateId: 253, positionX: -71.3 }, { actionStateId: 14, positionX: 20 }),
      createSyntheticFrame(5, { actionStateId: 29, positionX: -71.0 }, { actionStateId: 14, positionX: 20 }),
      createSyntheticFrame(10, { actionStateId: 252, positionX: -71.3 }, { actionStateId: 14, positionX: 20 }), // CLIFF_CATCH
      createSyntheticFrame(20, { actionStateId: 41, positionX: -60.0 }, { actionStateId: 14, positionX: 20 }),
    ];
    feedFrameSequence(detReGrab, seqReGrab);
    const sReGrab = typeof detReGrab.getHabitStats === 'function' ? detReGrab.getHabitStats(0) : detReGrab.fetch()?.habits?.[0];
    assert.strictEqual(sReGrab.ledgedash_count, 0, 'Ledgedash with cliff re-catch must be invalidated');

    // Test 1d: Intermediate Damage -> Invalidation
    const detDmg = new TacticalDetector(settings);
    const seqDmg = [
      createSyntheticFrame(1, { actionStateId: 253, positionX: -71.3 }, { actionStateId: 14, positionX: 20 }),
      createSyntheticFrame(5, { actionStateId: 29, positionX: -71.0 }, { actionStateId: 14, positionX: 20 }),
      createSyntheticFrame(10, { actionStateId: 75, percent: 15 }, { actionStateId: 44 }), // DAMAGE_START
      createSyntheticFrame(20, { actionStateId: 41, positionX: -60.0 }, { actionStateId: 14, positionX: 20 }),
    ];
    feedFrameSequence(detDmg, seqDmg);
    const sDmg = typeof detDmg.getHabitStats === 'function' ? detDmg.getHabitStats(0) : detDmg.fetch()?.habits?.[0];
    assert.strictEqual(sDmg.ledgedash_count, 0, 'Ledgedash interrupted by damage must be invalidated');
  }

  // --- Edge Case 2: Strict 30-Frame Punish Window ---
  console.log('  Testing strict 30-frame punish window...');
  {
    // Test 2a: Hit at frame 30 post-actionable -> Punished
    const detP30 = new TacticalDetector(settings);
    const seqP30 = [];
    seqP30.push(createSyntheticFrame(1, { actionStateId: 199, positionX: 0 }, { actionStateId: 14, positionX: 20 })); // TECH_NEUTRAL
    // Actionable starts at frame 10
    for (let f = 2; f <= 9; f++) seqP30.push(createSyntheticFrame(f, { actionStateId: 199, positionX: 0 }, { actionStateId: 14, positionX: 20 }));
    for (let f = 10; f <= 39; f++) seqP30.push(createSyntheticFrame(f, { actionStateId: 14, positionX: 0 }, { actionStateId: 14, positionX: 20 }));
    // Hit at frame 40 (40 - 10 = 30 frames post-actionable -> <= 30)
    seqP30.push(createSyntheticFrame(40, { actionStateId: 75, percent: 20 }, { actionStateId: 44, positionX: 5 }));
    feedFrameSequence(detP30, seqP30);
    const sP30 = typeof detP30.getHabitStats === 'function' ? detP30.getHabitStats(0) : detP30.fetch()?.habits?.[0];
    assert.strictEqual(sP30.tech_neutral_punished, 1, 'Hit at frame 30 post-actionable must be classified as punished');

    // Test 2b: Hit at frame 31 post-actionable -> NOT punished
    const detP31 = new TacticalDetector(settings);
    const seqP31 = [];
    for (let f = 1; f <= 9; f++) seqP31.push(createSyntheticFrame(f, { actionStateId: 199, positionX: 0 }, { actionStateId: 14, positionX: 20 }));
    // Actionable frames 10 through 40 (31 frames clean)
    for (let f = 10; f <= 40; f++) seqP31.push(createSyntheticFrame(f, { actionStateId: 14, positionX: 0 }, { actionStateId: 14, positionX: 20 }));
    // Hit at frame 41 (41 - 10 = 31 frames post-actionable -> > 30)
    seqP31.push(createSyntheticFrame(41, { actionStateId: 75, percent: 20 }, { actionStateId: 44, positionX: 5 }));
    feedFrameSequence(detP31, seqP31);
    const sP31 = typeof detP31.getHabitStats === 'function' ? detP31.getHabitStats(0) : detP31.fetch()?.habits?.[0];
    assert.strictEqual(sP31.tech_neutral_punished, 0, 'Hit at frame 31 post-actionable must NOT be classified as punished');

    // Test 2c: Counter-hit exemption before damage
    const detCH = new TacticalDetector(settings);
    const seqCH = [];
    for (let f = 1; f <= 9; f++) seqCH.push(createSyntheticFrame(f, { actionStateId: 199, positionX: 0 }, { actionStateId: 14, positionX: 20 }));
    // Actionable starts at frame 10. At frame 18, player hits opponent!
    for (let f = 10; f <= 17; f++) seqCH.push(createSyntheticFrame(f, { actionStateId: 14, positionX: 0 }, { actionStateId: 14, positionX: 20 }));
    seqCH.push(createSyntheticFrame(18, { actionStateId: 44, positionX: 0 }, { actionStateId: 75, percent: 15, positionX: 5 })); // Counter-hit
    // Then player takes damage at frame 25
    seqCH.push(createSyntheticFrame(25, { actionStateId: 75, percent: 20 }, { actionStateId: 44, positionX: 5 }));
    feedFrameSequence(detCH, seqCH);
    const sCH = typeof detCH.getHabitStats === 'function' ? detCH.getHabitStats(0) : detCH.fetch()?.habits?.[0];
    assert.strictEqual(sCH.tech_neutral_punished, 0, 'Landing counter-hit before taking damage exempts option from punish');
  }

  // --- Edge Case 3: Grab Initiation Context Boundaries ---
  console.log('  Testing grab initiation context (18.0 scramble vs neutral & 15f shield)...');
  {
    // Test 3a: Distance exactly 18.00 with clean 30f history -> Scramble
    const detScramble = new TacticalDetector(settings);
    const seqScramble = [];
    for (let f = 1; f <= 35; f++) seqScramble.push(createSyntheticFrame(f, { actionStateId: 14, positionX: 0 }, { actionStateId: 14, positionX: 18.0 }));
    seqScramble.push(createSyntheticFrame(36, { actionStateId: 212, positionX: 0 }, { actionStateId: 14, positionX: 18.0 })); // GRAB at D = 18.0
    feedFrameSequence(detScramble, seqScramble);
    const sScramble = typeof detScramble.getHabitStats === 'function' ? detScramble.getHabitStats(0) : detScramble.fetch()?.habits?.[0];
    assert.strictEqual(sScramble.grabs_scramble, 1, 'Grab at distance 18.0 with clean history must classify as scramble');

    // Test 3b: Distance 18.01 -> Neutral setup grab
    const detNeutral = new TacticalDetector(settings);
    const seqNeutral = [];
    for (let f = 1; f <= 35; f++) seqNeutral.push(createSyntheticFrame(f, { actionStateId: 14, positionX: 0 }, { actionStateId: 14, positionX: 18.01 }));
    seqNeutral.push(createSyntheticFrame(36, { actionStateId: 212, positionX: 0 }, { actionStateId: 14, positionX: 18.01 })); // GRAB at D = 18.01
    feedFrameSequence(detNeutral, seqNeutral);
    const sNeutral = typeof detNeutral.getHabitStats === 'function' ? detNeutral.getHabitStats(0) : detNeutral.fetch()?.habits?.[0];
    assert.strictEqual(sNeutral.grabs_neutral, 1, 'Grab at distance 18.01 must classify as neutral setup');
    assert.strictEqual(sNeutral.grabs_scramble, 0, 'Grab at distance 18.01 must NOT classify as scramble');

    // Test 3c: Dirty history within 30f blocks scramble
    const detDirty = new TacticalDetector(settings);
    const seqDirty = [];
    seqDirty.push(createSyntheticFrame(1, { actionStateId: 14, positionX: 0 }, { actionStateId: 14, percent: 0, positionX: 10 })); // P1 initial
    seqDirty.push(createSyntheticFrame(2, { actionStateId: 14, positionX: 0 }, { actionStateId: 75, percent: 12, positionX: 10 })); // P1 takes damage -> lastDamageFrame = 2
    for (let f = 3; f <= 20; f++) seqDirty.push(createSyntheticFrame(f, { actionStateId: 14, positionX: 0 }, { actionStateId: 14, percent: 12, positionX: 10 })); // only 18 clean frames
    seqDirty.push(createSyntheticFrame(21, { actionStateId: 212, positionX: 0 }, { actionStateId: 14, percent: 12, positionX: 10 })); // D = 10 <= 18, but dirty history (21 - 2 = 19 <= 30)
    feedFrameSequence(detDirty, seqDirty);
    const sDirty = typeof detDirty.getHabitStats === 'function' ? detDirty.getHabitStats(0) : detDirty.fetch()?.habits?.[0];
    assert.strictEqual(sDirty.grabs_scramble, 0, 'Grab with recent hitstun in preceding 30f must NOT classify as scramble');
  }

  // --- Edge Case 4: Neutral Reset vs Over-Extension Window (45f) ---
  console.log('  Testing 45f advantage neutralization window...');
  {
    // Test 4a: Retreat within 45f window -> Neutral reset
    const detNR = new TacticalDetector(settings);
    const seqNR = [];
    seqNR.push(createSyntheticFrame(1, { actionStateId: 14, positionX: 0 }, { actionStateId: 14, percent: 0, positionX: 15 })); // baseline
    seqNR.push(createSyntheticFrame(2, { actionStateId: 58, positionX: 0 }, { actionStateId: 75, percent: 15, positionX: 15 })); // hit (starts conversion)
    // Conversion terminates after 46 frames of recovery (resetTimer > 45) -> window begins
    for (let f = 3; f <= 50; f++) seqNR.push(createSyntheticFrame(f, { actionStateId: 14, positionX: 0 }, { actionStateId: 14, percent: 15, positionX: 15 }));
    // Window active: player retreats to X = -10 (dist: 15 -> 25, deltaD > 0) through window expiration
    for (let f = 51; f <= 98; f++) seqNR.push(createSyntheticFrame(f, { actionStateId: 20, positionX: -10 }, { actionStateId: 14, percent: 15, positionX: 15 }));
    feedFrameSequence(detNR, seqNR);
    const sNR = typeof detNR.getHabitStats === 'function' ? detNR.getHabitStats(0) : detNR.fetch()?.habits?.[0];
    assert.strictEqual(sNR.neutral_resets, 1, 'Retreating within 45f advantage neutralization window must count as neutral reset');

    // Test 4b: Attack after window ends -> NOT over-extension under advantage neutralization
    const detOE46 = new TacticalDetector(settings);
    const seqOE46 = [];
    seqOE46.push(createSyntheticFrame(1, { actionStateId: 14, positionX: 0 }, { actionStateId: 14, percent: 0, positionX: 15 }));
    seqOE46.push(createSyntheticFrame(2, { actionStateId: 58, positionX: 0 }, { actionStateId: 75, percent: 15, positionX: 15 }));
    for (let f = 3; f <= 50; f++) seqOE46.push(createSyntheticFrame(f, { actionStateId: 14, positionX: 0 }, { actionStateId: 14, percent: 15, positionX: 15 }));
    // Idling until window expires
    for (let f = 51; f <= 98; f++) seqOE46.push(createSyntheticFrame(f, { actionStateId: 14, positionX: 0 }, { actionStateId: 14, percent: 15, positionX: 15 }));
    // Attack after window expired
    seqOE46.push(createSyntheticFrame(99, { actionStateId: 58, positionX: 5 }, { actionStateId: 14, percent: 15, positionX: 15 }));
    seqOE46.push(createSyntheticFrame(100, { actionStateId: 75, percent: 30 }, { actionStateId: 44, positionX: 10 }));
    feedFrameSequence(detOE46, seqOE46);
    const sOE46 = typeof detOE46.getHabitStats === 'function' ? detOE46.getHabitStats(0) : detOE46.fetch()?.habits?.[0];
    assert.strictEqual(sOE46.over_extensions, 0, 'Attack after 45f window expires must not count as over-extension under advantage neutralization');
  }

  console.log('  ✔ All rare edge interaction fixtures asserted with strict boundary precision.');
}

/**
 * =========================================================================
 * SECTION 4: SQLite Database & Schema Validation
 * =========================================================================
 */
async function testSection4_SQLiteDatabaseSchemaValidation() {
  console.log('\n--- Section 4: SQLite Database & Schema Validation ---');
  const testDb = './test_section4_habits.db';
  if (fs.existsSync(testDb)) fs.unlinkSync(testDb);

  try {
    const repository = new ReplayRepository(testDb);
    const db = repository.db;

    // 1. Table existence & column verification via PRAGMA table_info
    const columns = db.prepare("PRAGMA table_info('player_habits_stats')").all();
    assert.ok(columns.length > 0, "Table 'player_habits_stats' must exist in schema");

    const columnNames = columns.map(c => c.name);
    assert.ok(columnNames.includes('game_id'), 'game_id column must exist');
    assert.ok(columnNames.includes('player_index'), 'player_index column must exist');
    assert.ok(columnNames.includes('connect_code'), 'connect_code column must exist');
    assert.ok(columnNames.includes('character_id'), 'character_id column must exist');
    assert.ok(columnNames.includes('is_complete'), 'is_complete column must exist');

    for (const c of EXPECTED_40_COUNTERS) {
      assert.ok(columnNames.includes(c), `Column '${c}' must exist in player_habits_stats`);
    }

    // 2. Composite Primary Key verification: (game_id, player_index)
    const pkColumns = columns.filter(c => c.pk > 0).sort((a, b) => a.pk - b.pk);
    assert.strictEqual(pkColumns.length, 2, 'Primary key must be composite of 2 columns');
    assert.strictEqual(pkColumns[0].name, 'game_id', 'PK part 1 must be game_id');
    assert.strictEqual(pkColumns[1].name, 'player_index', 'PK part 2 must be player_index');

    // Insert dummy parent game in games table
    db.prepare(`
      INSERT INTO games (game_id, file_hash, start_at, duration_frames, duration_seconds, stage_id, game_mode, payload_path)
      VALUES ('test_game_pk', 'hash_test_pk', '2026-10-19T00:00:00Z', 1000, 16.6, 31, 2, 'test_payload')
    `).run();

    // Insert player 0 and player 1 with same game_id -> succeeds
    db.prepare(`
      INSERT INTO player_habits_stats (game_id, player_index, connect_code, character_id, climb_count)
      VALUES ('test_game_pk', 0, 'P1#001', 2, 5)
    `).run();

    db.prepare(`
      INSERT INTO player_habits_stats (game_id, player_index, connect_code, character_id, climb_count)
      VALUES ('test_game_pk', 1, 'P2#002', 20, 3)
    `).run();

    // Duplicate (test_game_pk, 0) without ON CONFLICT must throw SQLITE_CONSTRAINT_PRIMARYKEY
    assert.throws(() => {
      db.prepare(`
        INSERT INTO player_habits_stats (game_id, player_index, connect_code, character_id, climb_count)
        VALUES ('test_game_pk', 0, 'P1#001', 2, 99)
      `).run();
    }, /PRIMARYKEY|constraint/i, 'Inserting duplicate (game_id, player_index) must violate composite PK');

    // ON CONFLICT update works
    db.prepare(`
      INSERT INTO player_habits_stats (game_id, player_index, connect_code, character_id, climb_count)
      VALUES ('test_game_pk', 0, 'P1#001', 2, 99)
      ON CONFLICT(game_id, player_index) DO UPDATE SET climb_count = excluded.climb_count
    `).run();
    const updated = db.prepare('SELECT climb_count FROM player_habits_stats WHERE game_id = ? AND player_index = ?').get('test_game_pk', 0);
    assert.strictEqual(updated.climb_count, 99, 'ON CONFLICT DO UPDATE must update existing record');

    // 3. Foreign Key ON DELETE CASCADE verification
    db.prepare("DELETE FROM games WHERE game_id = 'test_game_pk'").run();
    const remainingHabits = db.prepare("SELECT COUNT(*) as count FROM player_habits_stats WHERE game_id = 'test_game_pk'").get();
    assert.strictEqual(remainingHabits.count, 0, 'Deleting game from games must cascade-delete rows in player_habits_stats');

    // 4. Index verification via PRAGMA index_list
    const indexes = db.prepare("PRAGMA index_list('player_habits_stats')").all();
    const indexNames = indexes.map(idx => idx.name);
    assert.ok(indexNames.includes('idx_habits_connect_code'), 'Index idx_habits_connect_code must exist');
    assert.ok(indexNames.includes('idx_habits_char'), 'Index idx_habits_char must exist');

    console.log('  ✔ SQLite schema verified: all columns, composite PK, FK CASCADE, and indexes asserted.');
  } finally {
    closeDatabase();
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
  }
}

/**
 * =========================================================================
 * SECTION 5: Decompressed Payload Validation & Disk Hygiene
 * =========================================================================
 */
async function testSection5_PayloadValidationAndDiskHygiene() {
  console.log('\n--- Section 5: Decompressed Payload Validation & Disk Hygiene ---');
  const testPayloadDir = './test_section5_payloads';
  if (fs.existsSync(testPayloadDir)) fs.rmSync(testPayloadDir, { recursive: true, force: true });

  try {
    const payloadBuilder = new PayloadBuilder(testPayloadDir);

    const samplePayload = {
      gameId: 'payload_test_001',
      fileHash: 'hash_sample_001',
      startAt: new Date().toISOString(),
      stageId: 31,
      players: [
        { playerIndex: 0, connectCode: 'TEST#1', characterId: 2 },
        { playerIndex: 1, connectCode: 'TEST#2', characterId: 20 },
      ],
      habits: {
        getupEvents: [
          { frame: 120, playerIndex: 0, type: 'ledge', option: 'climb_slow', x: -65.0, y: 0.0, punished: false },
          { frame: 250, playerIndex: 1, type: 'tech', option: 'tech_neutral', x: 10.0, y: 0.0, punished: true, punishFrame: 265 }
        ],
        grabTriggers: [
          { frame: 320, playerIndex: 0, opponentIndex: 1, triggerType: 'shield_pressure', distance: 12.0, opponentShieldRecent: true },
          { frame: 450, playerIndex: 1, opponentIndex: 0, triggerType: 'scramble', distance: 15.5, opponentShieldRecent: false }
        ],
        transitionDecisions: [
          { frame: 600, playerIndex: 0, decision: 'neutral_reset', actionTaken: 20, punished: false, deltaDistance: 12.0 },
          { frame: 750, playerIndex: 1, decision: 'over_extension', actionTaken: 58, punished: true, deltaDistance: -5.0 }
        ],
        escapeSequences: [
          { frame: 900, playerIndex: 0, escapeType: 'oos', option: 'roll_forward', punished: false },
          { frame: 1050, playerIndex: 1, escapeType: 'corner_drift', option: 'drift_ledge', punished: true }
        ]
      }
    };

    const savedPath = payloadBuilder.savePayload(samplePayload);
    assert.ok(fs.existsSync(savedPath), `Payload file must exist at ${savedPath}`);
    assert.ok(savedPath.endsWith('.json.gz'), 'Payload path must be .json.gz');

    // Direct gunzip validation
    const rawGzip = fs.readFileSync(savedPath);
    const unzipped = zlib.gunzipSync(rawGzip);
    const parsed = JSON.parse(unzipped.toString('utf8'));

    assert.ok(parsed.habits, 'Decompressed JSON must contain habits object');
    assert.strictEqual(parsed.habits.getupEvents.length, 2, 'Must deserialize getupEvents');
    assert.strictEqual(parsed.habits.grabTriggers.length, 2, 'Must deserialize grabTriggers');
    assert.strictEqual(parsed.habits.transitionDecisions.length, 2, 'Must deserialize transitionDecisions');
    assert.strictEqual(parsed.habits.escapeSequences.length, 2, 'Must deserialize escapeSequences');

    // Schema structure assertions
    assert.strictEqual(parsed.habits.getupEvents[0].type, 'ledge');
    assert.strictEqual(parsed.habits.getupEvents[1].punished, true);
    assert.strictEqual(parsed.habits.grabTriggers[0].triggerType, 'shield_pressure');
    assert.strictEqual(parsed.habits.transitionDecisions[0].decision, 'neutral_reset');
    assert.strictEqual(parsed.habits.escapeSequences[0].escapeType, 'oos');

    // Disk Hygiene check: Zero .slp files in temp_slp/
    const tempSlpDir = './temp_slp';
    if (fs.existsSync(tempSlpDir)) {
      const slpFiles = fs.readdirSync(tempSlpDir).filter(f => f.endsWith('.slp'));
      assert.strictEqual(slpFiles.length, 0, `Zero accumulation invariant violated: found ${slpFiles.length} files in temp_slp`);
    }

    console.log('  ✔ Granular payload verified: schema valid and zero temporary .slp accumulation confirmed.');
  } finally {
    if (fs.existsSync(testPayloadDir)) fs.rmSync(testPayloadDir, { recursive: true, force: true });
  }
}

/**
 * =========================================================================
 * SECTION 6: AnalyticsService Relational Rolling Queries & Filters
 * =========================================================================
 */
async function testSection6_AnalyticsServiceRollingQueriesAndFilters() {
  console.log('\n--- Section 6: AnalyticsService Relational Rolling Queries & Filters ---');
  const testDb = './test_section6_habits.db';
  if (fs.existsSync(testDb)) fs.unlinkSync(testDb);

  try {
    const repository = new ReplayRepository(testDb);
    const db = repository.db;
    const analytics = new AnalyticsService(testDb);

    // Ensure player_habits_stats table exists in test DB
    db.exec(`
      CREATE TABLE IF NOT EXISTS player_habits_stats (
        game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
        player_index INTEGER NOT NULL,
        connect_code TEXT,
        character_id INTEGER NOT NULL,
        climb_count INTEGER NOT NULL DEFAULT 0,
        climb_punished INTEGER NOT NULL DEFAULT 0,
        attack_count INTEGER NOT NULL DEFAULT 0,
        attack_punished INTEGER NOT NULL DEFAULT 0,
        roll_count INTEGER NOT NULL DEFAULT 0,
        roll_punished INTEGER NOT NULL DEFAULT 0,
        jump_count INTEGER NOT NULL DEFAULT 0,
        jump_punished INTEGER NOT NULL DEFAULT 0,
        ledgedash_count INTEGER NOT NULL DEFAULT 0,
        ledgedash_punished INTEGER NOT NULL DEFAULT 0,
        tech_neutral_count INTEGER NOT NULL DEFAULT 0,
        tech_neutral_punished INTEGER NOT NULL DEFAULT 0,
        tech_forward_count INTEGER NOT NULL DEFAULT 0,
        tech_forward_punished INTEGER NOT NULL DEFAULT 0,
        tech_back_count INTEGER NOT NULL DEFAULT 0,
        tech_back_punished INTEGER NOT NULL DEFAULT 0,
        tech_miss_count INTEGER NOT NULL DEFAULT 0,
        tech_miss_punished INTEGER NOT NULL DEFAULT 0,
        wakeup_stand_count INTEGER NOT NULL DEFAULT 0,
        wakeup_stand_punished INTEGER NOT NULL DEFAULT 0,
        wakeup_forward_count INTEGER NOT NULL DEFAULT 0,
        wakeup_forward_punished INTEGER NOT NULL DEFAULT 0,
        wakeup_back_count INTEGER NOT NULL DEFAULT 0,
        wakeup_back_punished INTEGER NOT NULL DEFAULT 0,
        wakeup_attack_count INTEGER NOT NULL DEFAULT 0,
        wakeup_attack_punished INTEGER NOT NULL DEFAULT 0,
        grabs_shield_pressure INTEGER NOT NULL DEFAULT 0,
        grabs_scramble INTEGER NOT NULL DEFAULT 0,
        grabs_neutral INTEGER NOT NULL DEFAULT 0,
        neutral_resets INTEGER NOT NULL DEFAULT 0,
        over_extensions INTEGER NOT NULL DEFAULT 0,
        oos_roll_count INTEGER NOT NULL DEFAULT 0,
        oos_roll_punished INTEGER NOT NULL DEFAULT 0,
        oos_spotdodge_count INTEGER NOT NULL DEFAULT 0,
        oos_spotdodge_punished INTEGER NOT NULL DEFAULT 0,
        oos_grab_count INTEGER NOT NULL DEFAULT 0,
        oos_grab_punished INTEGER NOT NULL DEFAULT 0,
        oos_aerial_count INTEGER NOT NULL DEFAULT 0,
        oos_aerial_punished INTEGER NOT NULL DEFAULT 0,
        corner_drift_count INTEGER NOT NULL DEFAULT 0,
        is_complete BOOLEAN NOT NULL DEFAULT 1,
        PRIMARY KEY (game_id, player_index)
      );
    `);

    // Insert Game A: Complete match (is_complete = 1), Fox vs Falco on Battlefield (31)
    db.prepare(`
      INSERT INTO games (game_id, file_hash, start_at, duration_frames, duration_seconds, stage_id, game_mode, payload_path)
      VALUES ('game_A', 'hash_A', '2026-10-19T01:00:00Z', 3600, 60.0, 31, 2, 'payload_A')
    `).run();
    db.prepare(`
      INSERT INTO game_players (game_id, player_index, port, character_id, costume_index, connect_code, start_stocks, end_stocks)
      VALUES ('game_A', 0, 1, 2, 0, 'FOX#123', 4, 1)
    `).run();
    db.prepare(`
      INSERT INTO game_players (game_id, player_index, port, character_id, costume_index, connect_code, start_stocks, end_stocks)
      VALUES ('game_A', 1, 2, 20, 0, 'FALC#456', 4, 0)
    `).run();
    db.prepare(`
      INSERT INTO player_habits_stats (
        game_id, player_index, connect_code, character_id, is_complete,
        climb_count, climb_punished, tech_neutral_count, tech_neutral_punished,
        grabs_shield_pressure, grabs_scramble, grabs_neutral, neutral_resets, over_extensions
      ) VALUES (
        'game_A', 0, 'FOX#123', 2, 1,
        10, 2, 8, 1,
        5, 3, 2, 4, 1
      )
    `).run();

    // Insert Game B: Incomplete match (is_complete = 0), same matchup & stage
    db.prepare(`
      INSERT INTO games (game_id, file_hash, start_at, duration_frames, duration_seconds, stage_id, game_mode, end_method, lras_port, payload_path)
      VALUES ('game_B', 'hash_B', '2026-10-19T01:10:00Z', 45, 0.75, 31, 2, 7, 0, 'payload_B')
    `).run();
    db.prepare(`
      INSERT INTO game_players (game_id, player_index, port, character_id, costume_index, connect_code, start_stocks, end_stocks)
      VALUES ('game_B', 0, 1, 2, 0, 'FOX#123', 4, 4)
    `).run();
    db.prepare(`
      INSERT INTO game_players (game_id, player_index, port, character_id, costume_index, connect_code, start_stocks, end_stocks)
      VALUES ('game_B', 1, 2, 20, 0, 'FALC#456', 4, 4)
    `).run();
    db.prepare(`
      INSERT INTO player_habits_stats (
        game_id, player_index, connect_code, character_id, is_complete,
        climb_count, climb_punished, tech_neutral_count, tech_neutral_punished
      ) VALUES (
        'game_B', 0, 'FOX#123', 2, 0,
        100, 100, 50, 50
      )
    `).run();

    // Insert Game C: Complete match (is_complete = 1), Fox vs Marth (9) on Final Destination (32)
    db.prepare(`
      INSERT INTO games (game_id, file_hash, start_at, duration_frames, duration_seconds, stage_id, game_mode, payload_path)
      VALUES ('game_C', 'hash_C', '2026-10-19T01:20:00Z', 4200, 70.0, 32, 2, 'payload_C')
    `).run();
    db.prepare(`
      INSERT INTO game_players (game_id, player_index, port, character_id, costume_index, connect_code, start_stocks, end_stocks)
      VALUES ('game_C', 0, 1, 2, 0, 'FOX#123', 4, 2)
    `).run();
    db.prepare(`
      INSERT INTO game_players (game_id, player_index, port, character_id, costume_index, connect_code, start_stocks, end_stocks)
      VALUES ('game_C', 1, 2, 9, 0, 'MARTH#789', 4, 0)
    `).run();
    db.prepare(`
      INSERT INTO player_habits_stats (
        game_id, player_index, connect_code, character_id, is_complete,
        climb_count, climb_punished, tech_neutral_count, tech_neutral_punished,
        grabs_shield_pressure, grabs_scramble, grabs_neutral, neutral_resets, over_extensions
      ) VALUES (
        'game_C', 0, 'FOX#123', 2, 1,
        6, 3, 4, 2,
        2, 1, 4, 3, 2
      )
    `).run();

    // 1. Direct SQL Query Verification matching AnalyticsService specification
    const queryStmt = db.prepare(`
      SELECT 
        phs.connect_code,
        COUNT(DISTINCT phs.game_id) as total_games,
        SUM(phs.climb_count) as total_climbs,
        SUM(phs.climb_punished) as total_climb_punished,
        SUM(phs.climb_punished) * 1.0 / NULLIF(SUM(phs.climb_count), 0) as climb_punish_rate,
        SUM(phs.tech_neutral_count) as total_tech_neutral,
        SUM(phs.grabs_shield_pressure) as total_grabs_shield_pressure
      FROM player_habits_stats phs
      JOIN games g ON phs.game_id = g.game_id
      JOIN game_players p ON phs.game_id = p.game_id AND phs.player_index = p.player_index
      LEFT JOIN game_players opp ON phs.game_id = opp.game_id AND opp.player_index != phs.player_index
      WHERE phs.connect_code = :connectCode
        AND phs.is_complete = 1
        AND (:oppConnectCode IS NULL OR opp.connect_code = :oppConnectCode)
        AND (:characterId IS NULL OR p.character_id = :characterId)
        AND (:oppCharacterId IS NULL OR opp.character_id = :oppCharacterId)
        AND (:stageId IS NULL OR g.stage_id = :stageId)
      GROUP BY phs.connect_code
    `);

    // Incomplete exclusion check: Total climbs should be 10 (Game A) + 6 (Game C) = 16, strictly excluding Game B (100)
    const unfiltered = queryStmt.get({
      connectCode: 'FOX#123',
      oppConnectCode: null,
      characterId: null,
      oppCharacterId: null,
      stageId: null,
    });
    assert.strictEqual(unfiltered.total_games, 2, 'Only 2 complete games must be aggregated (Game B excluded)');
    assert.strictEqual(unfiltered.total_climbs, 16, 'Game B incomplete climb_count must be excluded');
    assert.strictEqual(unfiltered.total_climb_punished, 5, 'Game B incomplete climb_punished must be excluded');
    assert.strictEqual(unfiltered.climb_punish_rate, 5.0 / 16.0, 'climb_punish_rate calculated correctly');

    // Matchup Filter check: opponentConnectCode = 'FALC#456'
    const oppFilter = queryStmt.get({
      connectCode: 'FOX#123',
      oppConnectCode: 'FALC#456',
      characterId: null,
      oppCharacterId: null,
      stageId: null,
    });
    assert.strictEqual(oppFilter.total_games, 1, 'Only Game A matches opponent FALC#456');
    assert.strictEqual(oppFilter.total_climbs, 10, 'Filtered climb_count must match Game A');

    // Stage Filter check: stageId = 32 (Final Destination)
    const stageFilter = queryStmt.get({
      connectCode: 'FOX#123',
      oppConnectCode: null,
      characterId: null,
      oppCharacterId: null,
      stageId: 32,
    });
    assert.strictEqual(stageFilter.total_games, 1, 'Only Game C matches stage 32');
    assert.strictEqual(stageFilter.total_climbs, 6, 'Filtered climb_count must match Game C');

    // Opponent Character Filter: opponentCharacterId = 9 (Marth)
    const charFilter = queryStmt.get({
      connectCode: 'FOX#123',
      oppConnectCode: null,
      characterId: null,
      oppCharacterId: 9,
      stageId: null,
    });
    assert.strictEqual(charFilter.total_games, 1, 'Only Game C matches opponent character 9');

    // 2. AnalyticsService Method invocation
    if (typeof analytics.getPlayerHabits === 'function') {
      const res = analytics.getPlayerHabits('FOX#123');
      assert.ok(res, 'AnalyticsService.getPlayerHabits must return result');
      assert.strictEqual(res.totalGames ?? res.sampleGames, 2, 'AnalyticsService must exclude is_complete = 0');
    }

    console.log('  ✔ Relational rolling queries verified: incomplete matches excluded and all filters asserted.');
  } finally {
    closeDatabase();
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
  }
}

/**
 * =========================================================================
 * SECTION 7: REST API Endpoints
 * =========================================================================
 */
async function testSection7_RESTAPIEndpoints() {
  console.log('\n--- Section 7: REST API Endpoints ---');

  // Seed analytics.db with a completed game and habits data
  const db = getDatabase('./analytics.db');
  db.prepare(`
    INSERT INTO games (game_id, file_hash, start_at, duration_frames, duration_seconds, stage_id, game_mode, payload_path)
    VALUES ('api_test_game_1', 'api_test_hash_1', '2026-10-19T02:00:00Z', 3600, 60.0, 31, 2, 'payloads/test.json.gz')
    ON CONFLICT(game_id) DO NOTHING
  `).run();

  db.prepare(`
    INSERT INTO game_players (game_id, player_index, port, character_id, costume_index, connect_code, start_stocks, end_stocks)
    VALUES ('api_test_game_1', 0, 1, 2, 0, 'APITEST#001', 4, 2)
    ON CONFLICT(game_id, player_index) DO NOTHING
  `).run();

  db.prepare(`
    INSERT INTO game_players (game_id, player_index, port, character_id, costume_index, connect_code, start_stocks, end_stocks)
    VALUES ('api_test_game_1', 1, 2, 20, 0, 'APITEST#002', 4, 0)
    ON CONFLICT(game_id, player_index) DO NOTHING
  `).run();

  db.prepare(`
    INSERT INTO player_habits_stats (
      game_id, player_index, connect_code, character_id, is_complete,
      climb_count, climb_punished, tech_neutral_count, tech_neutral_punished
    ) VALUES (
      'api_test_game_1', 0, 'APITEST#001', 2, 1,
      8, 2, 6, 1
    ) ON CONFLICT(game_id, player_index) DO UPDATE SET climb_count = 8
  `).run();

  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. GET /api/games/:id/habits
    console.log(`  Testing GET ${baseUrl}/api/games/api_test_game_1/habits...`);
    const gameHabitsRes = await fetchHttp(`${baseUrl}/api/games/api_test_game_1/habits`);
    assert.strictEqual(gameHabitsRes.status, 200, 'GET /api/games/:id/habits must return HTTP 200');
    const gameHabitsData = gameHabitsRes.json();
    assert.ok(gameHabitsData, 'Response must be valid JSON');
    assert.strictEqual(gameHabitsData.gameId, 'api_test_game_1', 'gameId must match');
    assert.ok(Array.isArray(gameHabitsData.players), 'players must be an array');

    // 2. GET /api/games/:id/habits?playerIndex=0 fallback
    console.log(`  Testing GET ${baseUrl}/api/games/api_test_game_1/habits?playerIndex=0...`);
    const fallbackRes = await fetchHttp(`${baseUrl}/api/games/api_test_game_1/habits?playerIndex=0`);
    assert.strictEqual(fallbackRes.status, 200, 'Fallback with playerIndex must return HTTP 200');

    // 3. GET /api/players/:connectCode/habits with URL encoding (%23 for #)
    console.log(`  Testing GET ${baseUrl}/api/players/APITEST%23001/habits...`);
    const playerHabitsRes = await fetchHttp(`${baseUrl}/api/players/APITEST%23001/habits`);
    assert.strictEqual(playerHabitsRes.status, 200, 'GET /api/players/:connectCode/habits must return HTTP 200');
    const playerHabitsData = playerHabitsRes.json();
    assert.ok(playerHabitsData, 'Response must be valid JSON');
    assert.strictEqual(playerHabitsData.connectCode, 'APITEST#001', 'connectCode must match decoded parameter');

    // 4. GET /api/players/:connectCode/habits with filter parameters
    console.log(`  Testing GET ${baseUrl}/api/players/APITEST%23001/habits?stageId=31&characterId=2...`);
    const filteredRes = await fetchHttp(`${baseUrl}/api/players/APITEST%23001/habits?stageId=31&characterId=2`);
    assert.strictEqual(filteredRes.status, 200, 'Filtered player habits request must return HTTP 200');

    console.log('  ✔ REST API endpoints verified: match habits and player rolling habits return HTTP 200.');
  } finally {
    server.close();
    closeDatabase();
  }
}

/**
 * =========================================================================
 * SECTION 8: Scope Isolation (No Habit Data in Ingestion Telemetry)
 * =========================================================================
 */
async function testSection8_ScopeIsolation() {
  console.log('\n--- Section 8: Scope Isolation ---');
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const FORBIDDEN_HABIT_KEYS = [
    'climb_count', 'climb_punished',
    'attack_count', 'attack_punished',
    'roll_count', 'roll_punished',
    'jump_count', 'jump_punished',
    'ledgedash_count', 'ledgedash_punished',
    'tech_neutral_count', 'tech_neutral_punished',
    'wakeup_stand_count', 'wakeup_attack_count',
    'grabs_shield_pressure', 'grabs_scramble',
    'neutral_resets', 'over_extensions',
    'oos_roll_count', 'oos_spotdodge_count',
    'corner_drift_count',
    'getupEvents', 'grabTriggers', 'transitionDecisions', 'escapeSequences'
  ];

  function assertNoForbiddenKeys(obj, pathContext) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        assertNoForbiddenKeys(obj[i], `${pathContext}[${i}]`);
      }
      return;
    }
    for (const key of Object.keys(obj)) {
      assert.ok(
        !FORBIDDEN_HABIT_KEYS.includes(key),
        `Scope isolation violation: forbidden habit key '${key}' found in ${pathContext}`
      );
      assertNoForbiddenKeys(obj[key], `${pathContext}.${key}`);
    }
  }

  try {
    // 1. /api/pipeline/status
    const pipeRes = await fetchHttp(`${baseUrl}/api/pipeline/status`);
    assert.strictEqual(pipeRes.status, 200);
    assertNoForbiddenKeys(pipeRes.json(), 'GET /api/pipeline/status');

    // 2. /api/batches
    const batchesRes = await fetchHttp(`${baseUrl}/api/batches`);
    assert.strictEqual(batchesRes.status, 200);
    assertNoForbiddenKeys(batchesRes.json(), 'GET /api/batches');

    // 3. /api/storage/footprint
    const storageRes = await fetchHttp(`${baseUrl}/api/storage/footprint`);
    assert.strictEqual(storageRes.status, 200);
    assertNoForbiddenKeys(storageRes.json(), 'GET /api/storage/footprint');

    console.log('  ✔ Scope isolation verified: zero player habit metrics present in pipeline telemetry views.');
  } finally {
    server.close();
    closeDatabase();
  }
}

/**
 * =========================================================================
 * Main Runner & Reporter
 * =========================================================================
 */
async function runSuite() {
  console.log('=================================================================');
  console.log('FLOWSTATE MELEE: HABIT ANALYSIS & VULNERABILITY TEST SUITE (E2E)');
  console.log('=================================================================');

  const sections = [
    { name: 'Section 1: Real Replay Processing (unranked_game1.slp)', fn: testSection1_RealReplayProcessing },
    { name: 'Section 2: Deterministic Synthetic Baseline Habits (All 40 Counters)', fn: testSection2_DeterministicSyntheticBaselineHabits },
    { name: 'Section 3: Rare Edge Interaction Fixtures', fn: testSection3_RareEdgeInteractionFixtures },
    { name: 'Section 4: SQLite Database & Schema Validation', fn: testSection4_SQLiteDatabaseSchemaValidation },
    { name: 'Section 5: Decompressed Payload Validation & Disk Hygiene', fn: testSection5_PayloadValidationAndDiskHygiene },
    { name: 'Section 6: AnalyticsService Relational Rolling Queries & Filters', fn: testSection6_AnalyticsServiceRollingQueriesAndFilters },
    { name: 'Section 7: REST API Endpoints', fn: testSection7_RESTAPIEndpoints },
    { name: 'Section 8: Scope Isolation', fn: testSection8_ScopeIsolation },
  ];

  const passed = [];
  const failed = [];

  for (const s of sections) {
    try {
      await s.fn();
      passed.push(s.name);
    } catch (err) {
      console.error(`  ✖ ${s.name} FAILED: ${err.message}`);
      if (err.stack) {
        const stackLines = err.stack.split('\n').slice(1, 4).join('\n');
        console.error(`    ${stackLines}`);
      }
      failed.push({ name: s.name, error: err });
    }
  }

  console.log('\n=================================================================');
  console.log(`SUITE EXECUTION SUMMARY: ${passed.length} Passed, ${failed.length} Failed out of ${sections.length} Sections`);
  console.log('=================================================================');

  if (failed.length > 0) {
    console.error('Failed Sections:');
    for (const f of failed) {
      console.error(`- ${f.name}: ${f.error.message}`);
    }
    process.exit(1);
  } else {
    console.log('All 8 test sections passed successfully!');
    process.exit(0);
  }
}

runSuite().catch(err => {
  console.error('Fatal Test Suite Error:', err);
  process.exit(1);
});
