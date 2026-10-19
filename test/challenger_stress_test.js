/**
 * FLOWSTATE MELEE EMPIRICAL CHALLENGER TEST SUITE
 *
 * Authored by: challenger_1 (Empirical Challenger)
 * Purpose: Adversarial stress test of Melee tactical & habit detection heuristics.
 *
 * Verifies:
 * 1. Boundary conditions that PASS in current implementation
 * 2. Reproducible heuristic bugs that FAIL against ORIGINAL_REQUEST and SKILL specifications
 */

import assert from 'node:assert';
import { TacticalDetector } from '../src/analysis/tacticalDetector.js';
import { MechanicsDetector } from '../src/analysis/mechanicsDetector.js';
import { ACTION_STATES, isDamage, isShield, isAttack, isWakeup, isDownWait } from '../src/constants/actionStates.js';

console.log('=================================================================');
console.log('FLOWSTATE CHALLENGER 1: ADVERSARIAL STRESS TEST SUITE');
console.log('=================================================================\n');

function createFrame(frameNum, p0Overrides = {}, p1Overrides = {}) {
  return {
    frame: frameNum,
    players: {
      0: {
        pre: { facingDirection: 1, joystickX: 0, joystickY: 0, trigger: 0, buttons: 0 },
        post: {
          characterId: 2,
          actionStateId: p0Overrides.anim ?? p0Overrides.actionStateId ?? ACTION_STATES.WAIT,
          positionX: p0Overrides.x ?? p0Overrides.positionX ?? 0.0,
          positionY: p0Overrides.y ?? p0Overrides.positionY ?? 0.0,
          percent: p0Overrides.percent ?? 0,
          stocksRemaining: 4,
          hitlagRemaining: 0,
          lastAttackLanded: 0,
          lastHitBy: null,
          ...p0Overrides,
        }
      },
      1: {
        pre: { facingDirection: -1, joystickX: 0, joystickY: 0, trigger: 0, buttons: 0 },
        post: {
          characterId: 20,
          actionStateId: p1Overrides.anim ?? p1Overrides.actionStateId ?? ACTION_STATES.WAIT,
          positionX: p1Overrides.x ?? p1Overrides.positionX ?? 10.0,
          positionY: p1Overrides.y ?? p1Overrides.positionY ?? 0.0,
          percent: p1Overrides.percent ?? 0,
          stocksRemaining: 4,
          hitlagRemaining: 0,
          lastAttackLanded: 0,
          lastHitBy: null,
          ...p1Overrides,
        }
      }
    }
  };
}

function feedSequence(detector, frames) {
  let prev = null;
  for (const f of frames) {
    detector.processFrame(f, prev);
    prev = f;
  }
}

const mockSettings = {
  stageId: 31, // Battlefield: ground.xMax = 68.4
  players: [
    { playerIndex: 0, port: 1, characterId: 2, startStocks: 4 },
    { playerIndex: 1, port: 2, characterId: 20, startStocks: 4 },
  ]
};

// ---------------------------------------------------------------------------
// SECTION 1: Verified Boundary Conditions (PASSED)
// ---------------------------------------------------------------------------
console.log('--- Section 1: Heuristic Boundary Precision (PASSING) ---');

// 1.1: 35f vs 36f Ledgedash threshold
{
  const tact35 = new TacticalDetector(mockSettings);
  const f35 = [createFrame(1, { anim: ACTION_STATES.CLIFF_WAIT, x: -71.3 })];
  for (let f = 2; f <= 35; f++) f35.push(createFrame(f, { anim: ACTION_STATES.FALL, x: -68.0 }));
  f35.push(createFrame(36, { anim: ACTION_STATES.LANDING_FALL_SPECIAL, x: -60.0 })); // 35f elapsed
  feedSequence(tact35, f35);
  assert.strictEqual(tact35.getHabitStats(0).ledgedash_count, 1, '35f elapsed must be valid');

  const tact36 = new TacticalDetector(mockSettings);
  const f36 = [createFrame(1, { anim: ACTION_STATES.CLIFF_WAIT, x: -71.3 })];
  for (let f = 2; f <= 36; f++) f36.push(createFrame(f, { anim: ACTION_STATES.FALL, x: -68.0 }));
  f36.push(createFrame(37, { anim: ACTION_STATES.LANDING_FALL_SPECIAL, x: -60.0 })); // 36f elapsed
  feedSequence(tact36, f36);
  assert.strictEqual(tact36.getHabitStats(0).ledgedash_count, 0, '36f elapsed must be rejected');
  console.log('  ✔ 35f vs 36f ledgedash threshold strictly enforced.');
}

// 1.2: Stage bounds 68.40 vs 68.41
{
  const tactIn = new TacticalDetector(mockSettings);
  feedSequence(tactIn, [
    createFrame(1, { anim: ACTION_STATES.CLIFF_WAIT, x: -71.3 }),
    createFrame(5, { anim: ACTION_STATES.LANDING_FALL_SPECIAL, x: -68.40 })
  ]);
  assert.strictEqual(tactIn.getHabitStats(0).ledgedash_count, 1, '|X| = 68.40 must count');

  const tactOut = new TacticalDetector(mockSettings);
  feedSequence(tactOut, [
    createFrame(1, { anim: ACTION_STATES.CLIFF_WAIT, x: -71.3 }),
    createFrame(5, { anim: ACTION_STATES.LANDING_FALL_SPECIAL, x: -68.41 })
  ]);
  assert.strictEqual(tactOut.getHabitStats(0).ledgedash_count, 0, '|X| = 68.41 must NOT count');
  console.log('  ✔ Stage bounds |X| <= 68.40 strictly enforced.');
}

// 1.3: Strict 30-frame punish window: frame 30 vs frame 31
{
  const tact30 = new TacticalDetector(mockSettings);
  const f30 = [];
  for (let f = 1; f <= 10; f++) f30.push(createFrame(f, { anim: ACTION_STATES.TECH_NEUTRAL, x: 0 }));
  for (let f = 11; f <= 40; f++) f30.push(createFrame(f, { anim: ACTION_STATES.WAIT, x: 0 }));
  f30.push(createFrame(41, { anim: ACTION_STATES.DAMAGE_START, percent: 10 })); // 41 - 11 = 30f elapsed
  feedSequence(tact30, f30);
  assert.strictEqual(tact30.getHabitStats(0).tech_neutral_punished, 1, 'Hit at frame 30 post-actionable must be punished');

  const tact31 = new TacticalDetector(mockSettings);
  const f31 = [];
  for (let f = 1; f <= 10; f++) f31.push(createFrame(f, { anim: ACTION_STATES.TECH_NEUTRAL, x: 0 }));
  for (let f = 11; f <= 41; f++) f31.push(createFrame(f, { anim: ACTION_STATES.WAIT, x: 0 }));
  f31.push(createFrame(42, { anim: ACTION_STATES.DAMAGE_START, percent: 10 })); // 42 - 11 = 31f elapsed
  feedSequence(tact31, f31);
  assert.strictEqual(tact31.getHabitStats(0).tech_neutral_punished, 0, 'Hit at frame 31 post-actionable must be safe');
  console.log('  ✔ Strict 30-frame punish window (f30 punished vs f31 safe) strictly enforced.');
}

// 1.4: Scramble distance 18.0 vs 18.01
{
  const tact18 = new TacticalDetector(mockSettings);
  const f18 = [];
  for (let f = 1; f <= 35; f++) f18.push(createFrame(f, { anim: ACTION_STATES.WAIT, x: 0 }, { anim: ACTION_STATES.WAIT, x: 18.0 }));
  f18.push(createFrame(36, { anim: ACTION_STATES.GRAB, x: 0 }, { anim: ACTION_STATES.WAIT, x: 18.0 }));
  feedSequence(tact18, f18);
  assert.strictEqual(tact18.getHabitStats(0).grabs_scramble, 1, 'D = 18.0 must be scramble');

  const tact1801 = new TacticalDetector(mockSettings);
  const f1801 = [];
  for (let f = 1; f <= 35; f++) f1801.push(createFrame(f, { anim: ACTION_STATES.WAIT, x: 0 }, { anim: ACTION_STATES.WAIT, x: 18.01 }));
  f1801.push(createFrame(36, { anim: ACTION_STATES.GRAB, x: 0 }, { anim: ACTION_STATES.WAIT, x: 18.01 }));
  feedSequence(tact1801, f1801);
  assert.strictEqual(tact1801.getHabitStats(0).grabs_neutral, 1, 'D = 18.01 must be neutral setup');
  assert.strictEqual(tact1801.getHabitStats(0).grabs_scramble, 0, 'D = 18.01 must not be scramble');
  console.log('  ✔ Scramble distance threshold D <= 18.0 strictly enforced.');
}

// 1.5: Shield-pressure grab: 15f vs 16f
{
  const tact15 = new TacticalDetector(mockSettings);
  const f15 = [createFrame(1, { anim: 14, x: 0 }, { anim: ACTION_STATES.GUARD, x: 5 })];
  for (let f = 2; f <= 15; f++) f15.push(createFrame(f, { anim: 14, x: 0 }, { anim: 14, x: 5 }));
  f15.push(createFrame(16, { anim: ACTION_STATES.GRAB, x: 0 }, { anim: 14, x: 5 })); // 16 - 1 = 15f
  feedSequence(tact15, f15);
  assert.strictEqual(tact15.getHabitStats(0).grabs_shield_pressure, 1, '15f after shield must be shield-pressure');

  const tact16 = new TacticalDetector(mockSettings);
  const f16 = [createFrame(1, { anim: 14, x: 0 }, { anim: ACTION_STATES.GUARD, x: 5 })];
  for (let f = 2; f <= 16; f++) f16.push(createFrame(f, { anim: 14, x: 0 }, { anim: 14, x: 5 }));
  f16.push(createFrame(17, { anim: ACTION_STATES.GRAB, x: 0 }, { anim: 14, x: 5 })); // 17 - 1 = 16f
  feedSequence(tact16, f16);
  assert.strictEqual(tact16.getHabitStats(0).grabs_shield_pressure, 0, '16f after shield must not be shield-pressure');
  console.log('  ✔ Shield pressure 15f window strictly enforced.');
}

// 1.6: Corner drift bounds (proximity D <= 20, |X| >= xMax - 25, 30f cooldown)
{
  const tact = new TacticalDetector(mockSettings);
  feedSequence(tact, [
    createFrame(1, { anim: 14, x: 44.0 }, { anim: 14, x: 35.0 }), // D = 9 <= 20
    createFrame(2, { anim: 14, x: 48.0 }, { anim: 14, x: 35.0 }), // drift to edge
    // Cooldown check (frame 10 - 2 = 8 < 30) -> ignored
    createFrame(10, { anim: 14, x: 49.0 }, { anim: 14, x: 35.0 }),
    createFrame(11, { anim: 14, x: 53.0 }, { anim: 14, x: 35.0 }),
    // Cooldown elapsed (frame 35 - 2 = 33 >= 30) -> counted
    createFrame(35, { anim: 14, x: 54.0 }, { anim: 14, x: 40.0 }),
    createFrame(36, { anim: 14, x: 58.0 }, { anim: 14, x: 40.0 }),
  ]);
  assert.strictEqual(tact.getHabitStats(0).corner_drift_count, 2, 'Corner drift and cooldown verified');
  console.log('  ✔ Corner drift proximity, edge direction, and 30f cooldown strictly enforced.');
}

// ---------------------------------------------------------------------------
// SECTION 2: Empirical Bug Reproductions (FAILURE MODES DISCOVERED)
// ---------------------------------------------------------------------------
console.log('\n--- Section 2: Empirical Heuristic Bug Reproductions ---');

// BUG 1 REPRODUCTION: Scramble Grab triggered 1 frame out of 30-frame hitstun
console.log('Testing Bug 1: Hitstun history tracking in scramble grab...');
{
  const tact = new TacticalDetector(mockSettings);
  let prev = null;
  function send(fNum, p0, p1) {
    const f = createFrame(fNum, p0, p1);
    tact.processFrame(f, prev);
    prev = f;
  }

  send(1, { anim: 14, percent: 0, x: 0 }, { anim: 14, percent: 0, x: 10 });
  send(2, { anim: ACTION_STATES.DAMAGE_START, percent: 12, x: 0 }, { anim: 14, percent: 0, x: 10 }); // Damage begins
  // Player is in continuous hitstun for 30 frames (frames 2 to 32)
  for (let f = 3; f <= 32; f++) {
    send(f, { anim: ACTION_STATES.DAMAGE_START, percent: 12, x: 0 }, { anim: 14, percent: 0, x: 10 });
  }
  // Frame 33: Player exits hitstun into WAIT
  send(33, { anim: ACTION_STATES.WAIT, percent: 12, x: 0 }, { anim: 14, percent: 0, x: 10 });
  // Frame 34: Player initiates GRAB (distance = 10.0 <= 18.0)
  send(34, { anim: ACTION_STATES.GRAB, percent: 12, x: 0 }, { anim: 14, percent: 0, x: 10 });

  const stats = tact.getHabitStats(0);
  const bugPresent = (stats.grabs_scramble === 1 && stats.grabs_neutral === 0);
  if (bugPresent) {
    console.log('  ❌ BUG 1 CONFIRMED: TacticalDetector classified grab 1 frame out of 30f hitstun as scramble grab!');
    console.log(`     Details: grabs_scramble = ${stats.grabs_scramble}, grabs_neutral = ${stats.grabs_neutral}`);
    console.log('     Cause: st.lastDamageFrame is only updated on playerTookDamage (frame 2), NOT continuously during isDamage(anim).');
  } else {
    console.log('  ✔ Bug 1 not present.');
  }
}

// BUG 2 REPRODUCTION: Over-extension falsely recorded when attack lands a successful hit
console.log('\nTesting Bug 2: Attack hitting opponent falsely classified as over-extension whiff...');
{
  const tact = new TacticalDetector(mockSettings);
  let prev = null;
  function send(fNum, p0, p1) {
    const f = createFrame(fNum, p0, p1);
    tact.processFrame(f, prev);
    prev = f;
  }

  // Conversion starts
  send(1, { anim: 14, percent: 0, x: 0 }, { anim: 14, percent: 0, x: 15 });
  send(2, { anim: 58, percent: 0, x: 0 }, { anim: 75, percent: 15, x: 15 });
  // Conversion terminates after 46 frames
  for (let f = 3; f <= 48; f++) {
    send(f, { anim: 14, percent: 0, x: 0 }, { anim: 14, percent: 15, x: 15 });
  }
  // Transition window active: P0 commits to attack (anim = 44) at frame 50
  send(50, { anim: 44, percent: 0, x: 5 }, { anim: 14, percent: 15, x: 10 });
  // At frame 51, attack CONNECTS! Opponent takes 10% damage (percent: 15 -> 25)
  send(51, { anim: 44, percent: 0, x: 5 }, { anim: 75, percent: 25, x: 10 });
  // Attack animation continues on frame 52
  send(52, { anim: 44, percent: 0, x: 5 }, { anim: 75, percent: 25, x: 10 });
  // Attack finishes into WAIT on frame 53
  send(53, { anim: 14, percent: 0, x: 5 }, { anim: 75, percent: 25, x: 10 });

  const stats = tact.getHabitStats(0);
  const bugPresent = (stats.over_extensions === 1);
  if (bugPresent) {
    console.log('  ❌ BUG 2 CONFIRMED: TacticalDetector classified a successful hit as an over-extension whiff!');
    console.log(`     Details: over_extensions = ${stats.over_extensions}`);
    console.log('     Cause: tw.committedAttack does not record tw.hitLanded = true when oppTookHit occurs on frame 51.');
    console.log('            On frame 53 when animation ends, !oppTookHit is true, so it triggers over_extensions++!');
  } else {
    console.log('  ✔ Bug 2 not present.');
  }
}

// BUG 3 REPRODUCTION: Standard ledge climb followed by wavedash double-counted as ledgedash
console.log('\nTesting Bug 3: Standard ledge climb not invalidating ledgedash candidate...');
{
  const tact = new TacticalDetector(mockSettings);
  let prev = null;
  function send(fNum, p0, p1) {
    const f = createFrame(fNum, p0, p1);
    tact.processFrame(f, prev);
    prev = f;
  }

  // P0 in CLIFF_WAIT at frame 1
  send(1, { anim: ACTION_STATES.CLIFF_WAIT, x: -71.3 }, { anim: 14, x: 20 });
  // P0 performs standard climb (CLIFF_CLIMB_SLOW = 254)
  for (let f = 2; f <= 15; f++) {
    send(f, { anim: ACTION_STATES.CLIFF_CLIMB_SLOW, x: -65.0 }, { anim: 14, x: 20 });
  }
  // Climb completes into WAIT on stage at frame 16
  send(16, { anim: ACTION_STATES.WAIT, x: -60.0 }, { anim: 14, x: 20 });
  // P0 wavedashes on stage at frame 20 (LANDING_FALL_SPECIAL = 41)
  send(20, { anim: ACTION_STATES.LANDING_FALL_SPECIAL, x: -55.0 }, { anim: 14, x: 20 });

  const stats = tact.getHabitStats(0);
  const bugPresent = (stats.climb_count === 1 && stats.ledgedash_count === 1);
  if (bugPresent) {
    console.log('  ❌ BUG 3 CONFIRMED: TacticalDetector counted both standard climb and ledgedash for single ledge interaction!');
    console.log(`     Details: climb_count = ${stats.climb_count}, ledgedash_count = ${stats.ledgedash_count}`);
    console.log('     Cause: st.ledgedashCandidate is not invalidated when isStandardLedgeOption(anim) or non-airborne state occurs.');
  } else {
    console.log('  ✔ Bug 3 not present.');
  }
}

// BUG 4 REPRODUCTION: MechanicsDetector counting ledgedash after cliff re-catch
console.log('\nTesting Bug 4: MechanicsDetector ledgedash tracking with cliff re-catch...');
{
  const mech = new MechanicsDetector(mockSettings);
  let prev = null;
  function send(fNum, anim) {
    const f = createFrame(fNum, { anim });
    mech.processFrame(f, prev);
    prev = f;
  }

  send(1, ACTION_STATES.CLIFF_WAIT);
  send(5, ACTION_STATES.FALL);
  send(10, ACTION_STATES.CLIFF_CATCH); // Re-grab ledge
  send(20, ACTION_STATES.LANDING_FALL_SPECIAL);

  const m0 = mech.fetch().find(p => p.playerIndex === 0);
  const bugPresent = (m0.ledgedashCount === 1);
  if (bugPresent) {
    console.log('  ❌ BUG 4 CONFIRMED: MechanicsDetector counted ledgedash despite intermediate CLIFF_CATCH re-grab!');
    console.log(`     Details: m0.ledgedashCount = ${m0.ledgedashCount}`);
    console.log('     Cause: MechanicsDetector only checks (frame - lastLedgeWaitFrame <= 35) without CLIFF_CATCH reset.');
  } else {
    console.log('  ✔ Bug 4 not present.');
  }
}

console.log('\n=================================================================');
console.log('CHALLENGER 1 STRESS TEST EXECUTION COMPLETE');
console.log('=================================================================');
