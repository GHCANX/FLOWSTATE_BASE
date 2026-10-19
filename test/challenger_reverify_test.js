/**
 * CHALLENGER RE-VERIFICATION TEST SUITE
 *
 * Authored by: challenger_reverify_1 (Empirical Challenger)
 * Purpose: Independent, adversarial empirical stress test re-verifying the resolution
 *          of the 4 heuristic defects identified by Challenger 1 in:
 *          - src/analysis/tacticalDetector.js
 *          - src/analysis/mechanicsDetector.js
 */

import assert from 'node:assert';
import { TacticalDetector } from '../src/analysis/tacticalDetector.js';
import { MechanicsDetector } from '../src/analysis/mechanicsDetector.js';
import { ACTION_STATES } from '../src/constants/actionStates.js';

console.log('=================================================================');
console.log('CHALLENGER RE-VERIFY: EMPIRICAL ADVERSARIAL VERIFICATION SUITE');
console.log('=================================================================\n');

function createFrame(frameNum, p0Overrides = {}, p1Overrides = {}) {
  return {
    frame: frameNum,
    players: {
      0: {
        pre: { facingDirection: 1, joystickX: 0, joystickY: 0, trigger: 0, buttons: 0 },
        post: {
          characterId: 2, // Fox
          actionStateId: p0Overrides.anim ?? p0Overrides.actionStateId ?? ACTION_STATES.WAIT,
          positionX: p0Overrides.x ?? p0Overrides.positionX ?? 0.0,
          positionY: p0Overrides.y ?? p0Overrides.positionY ?? 0.0,
          percent: p0Overrides.percent ?? 0,
          stocksRemaining: 4,
          hitlagRemaining: 0,
          lastAttackLanded: 0,
          lastHitBy: null,
          isAirborne: p0Overrides.isAirborne ?? false,
          ...p0Overrides,
        }
      },
      1: {
        pre: { facingDirection: -1, joystickX: 0, joystickY: 0, trigger: 0, buttons: 0 },
        post: {
          characterId: 20, // Falco
          actionStateId: p1Overrides.anim ?? p1Overrides.actionStateId ?? ACTION_STATES.WAIT,
          positionX: p1Overrides.x ?? p1Overrides.positionX ?? 10.0,
          positionY: p1Overrides.y ?? p1Overrides.positionY ?? 0.0,
          percent: p1Overrides.percent ?? 0,
          stocksRemaining: 4,
          hitlagRemaining: 0,
          lastAttackLanded: 0,
          lastHitBy: null,
          isAirborne: p1Overrides.isAirborne ?? false,
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

let passedChecks = 0;
let totalChecks = 0;

function check(name, fn) {
  totalChecks++;
  try {
    fn();
    console.log(`  ✔ [PASS] ${name}`);
    passedChecks++;
  } catch (err) {
    console.error(`  ✖ [FAIL] ${name}: ${err.message}`);
    throw err;
  }
}

// ===========================================================================
// SECTION 1: Continuous Hitstun Tracking & Scramble Grab Resolution
// ===========================================================================
console.log('--- Section 1: Continuous Hitstun Tracking (lastDamageFrame) & Grab Context ---');

// 1.1: Multi-frame hitstun (35 frames): Grab at frame 1 post-hitstun MUST be neutral setup
check('1.1: Grab 1 frame out of 35f hitstun must be neutral grab (not scramble)', () => {
  const tact = new TacticalDetector(mockSettings);
  const frames = [createFrame(1, { anim: ACTION_STATES.WAIT, x: 0 }, { anim: ACTION_STATES.WAIT, x: 10 })];
  // P0 in hitstun from frame 2 to frame 36 (35 frames)
  for (let f = 2; f <= 36; f++) {
    frames.push(createFrame(f, { anim: ACTION_STATES.DAMAGE_START, percent: 15, x: 0 }, { anim: ACTION_STATES.WAIT, x: 10 }));
  }
  // Frame 37: P0 enters WAIT
  frames.push(createFrame(37, { anim: ACTION_STATES.WAIT, percent: 15, x: 0 }, { anim: ACTION_STATES.WAIT, x: 10 }));
  // Frame 38: P0 grabs (dist = 10.0 <= 18.0). Elapsed since hitstun = 38 - 36 = 2 <= 30.
  frames.push(createFrame(38, { anim: ACTION_STATES.GRAB, percent: 15, x: 0 }, { anim: ACTION_STATES.WAIT, x: 10 }));
  feedSequence(tact, frames);

  const stats = tact.getHabitStats(0);
  assert.strictEqual(stats.grabs_scramble, 0, 'Must NOT be scramble grab');
  assert.strictEqual(stats.grabs_neutral, 1, 'Must be neutral setup grab');
});

// 1.2: Boundary check: Grab at exactly 30 frames post-hitstun vs 31 frames post-hitstun
check('1.2: Grab at f30 post-hitstun is neutral; grab at f31 post-hitstun is scramble', () => {
  // 30 frames post-hitstun (fNum - lastDamageFrame = 30 -> NOT > 30)
  const tact30 = new TacticalDetector(mockSettings);
  const frames30 = [createFrame(1, { anim: ACTION_STATES.WAIT, x: 0 }, { anim: ACTION_STATES.WAIT, x: 10 })];
  for (let f = 2; f <= 10; f++) {
    frames30.push(createFrame(f, { anim: ACTION_STATES.DAMAGE_START, percent: 10, x: 0 }, { anim: ACTION_STATES.WAIT, x: 10 }));
  }
  // P0 exits hitstun at frame 11 into WAIT
  for (let f = 11; f <= 39; f++) {
    frames30.push(createFrame(f, { anim: ACTION_STATES.WAIT, percent: 10, x: 0 }, { anim: ACTION_STATES.WAIT, x: 10 }));
  }
  // Frame 40: Grab (40 - 10 = 30 frames elapsed)
  frames30.push(createFrame(40, { anim: ACTION_STATES.GRAB, percent: 10, x: 0 }, { anim: ACTION_STATES.WAIT, x: 10 }));
  feedSequence(tact30, frames30);
  assert.strictEqual(tact30.getHabitStats(0).grabs_scramble, 0, 'Frame 30 must not be scramble');
  assert.strictEqual(tact30.getHabitStats(0).grabs_neutral, 1, 'Frame 30 must be neutral setup');

  // 31 frames post-hitstun (fNum - lastDamageFrame = 31 -> > 30)
  const tact31 = new TacticalDetector(mockSettings);
  const frames31 = [createFrame(1, { anim: ACTION_STATES.WAIT, x: 0 }, { anim: ACTION_STATES.WAIT, x: 10 })];
  for (let f = 2; f <= 10; f++) {
    frames31.push(createFrame(f, { anim: ACTION_STATES.DAMAGE_START, percent: 10, x: 0 }, { anim: ACTION_STATES.WAIT, x: 10 }));
  }
  for (let f = 11; f <= 40; f++) {
    frames31.push(createFrame(f, { anim: ACTION_STATES.WAIT, percent: 10, x: 0 }, { anim: ACTION_STATES.WAIT, x: 10 }));
  }
  // Frame 41: Grab (41 - 10 = 31 frames elapsed)
  frames31.push(createFrame(41, { anim: ACTION_STATES.GRAB, percent: 10, x: 0 }, { anim: ACTION_STATES.WAIT, x: 10 }));
  feedSequence(tact31, frames31);
  assert.strictEqual(tact31.getHabitStats(0).grabs_scramble, 1, 'Frame 31 must be scramble');
  assert.strictEqual(tact31.getHabitStats(0).grabs_neutral, 0, 'Frame 31 must not be neutral setup');
});

// 1.3: Opponent hitstun tracking prevents scramble grab
check('1.3: Opponent in hitstun within 30 frames prevents scramble grab', () => {
  const tact = new TacticalDetector(mockSettings);
  const frames = [createFrame(1, { anim: ACTION_STATES.WAIT, x: 0 }, { anim: ACTION_STATES.WAIT, x: 10 })];
  // Opponent in hitstun from frame 2 to frame 20
  for (let f = 2; f <= 20; f++) {
    frames.push(createFrame(f, { anim: ACTION_STATES.WAIT, percent: 0, x: 0 }, { anim: ACTION_STATES.DAMAGE_START, percent: 20, x: 10 }));
  }
  // Opponent actionable at frame 21
  for (let f = 21; f <= 35; f++) {
    frames.push(createFrame(f, { anim: ACTION_STATES.WAIT, percent: 0, x: 0 }, { anim: ACTION_STATES.WAIT, percent: 20, x: 10 }));
  }
  // Frame 36: P0 grabs (36 - 20 = 16 <= 30 frames since opp was in hitstun)
  frames.push(createFrame(36, { anim: ACTION_STATES.GRAB, percent: 0, x: 0 }, { anim: ACTION_STATES.WAIT, percent: 20, x: 10 }));
  feedSequence(tact, frames);

  const stats = tact.getHabitStats(0);
  assert.strictEqual(stats.grabs_scramble, 0, 'Must not be scramble grab when opp recently in hitstun');
  assert.strictEqual(stats.grabs_neutral, 1, 'Must be neutral setup grab');
});

// 1.4: Tumble state (DAMAGE_FALL = 0x26) continuous tracking
check('1.4: DAMAGE_FALL tumble state continuously updates lastDamageFrame', () => {
  const tact = new TacticalDetector(mockSettings);
  const frames = [createFrame(1, { anim: ACTION_STATES.WAIT, x: 0 }, { anim: ACTION_STATES.WAIT, x: 10 })];
  // P0 in tumble from frame 2 to frame 25
  for (let f = 2; f <= 25; f++) {
    frames.push(createFrame(f, { anim: ACTION_STATES.DAMAGE_FALL, percent: 25, x: 0 }, { anim: ACTION_STATES.WAIT, x: 10 }));
  }
  // P0 lands and enters WAIT at frame 26
  frames.push(createFrame(26, { anim: ACTION_STATES.WAIT, percent: 25, x: 0 }, { anim: ACTION_STATES.WAIT, x: 10 }));
  // P0 grabs at frame 30 (30 - 25 = 5 <= 30)
  frames.push(createFrame(30, { anim: ACTION_STATES.GRAB, percent: 25, x: 0 }, { anim: ACTION_STATES.WAIT, x: 10 }));
  feedSequence(tact, frames);

  const stats = tact.getHabitStats(0);
  assert.strictEqual(stats.grabs_scramble, 0, 'Grab out of DAMAGE_FALL must not be scramble');
  assert.strictEqual(stats.grabs_neutral, 1, 'Grab out of DAMAGE_FALL must be neutral setup');
});

// ===========================================================================
// SECTION 2: Over-Extension Hit Tracking (tw.hitLanded)
// ===========================================================================
console.log('\n--- Section 2: Over-Extension Attack Hit Tracking (tw.hitLanded) ---');

// 2.1: Attack hits early in animation, finishes into WAIT -> NOT an over-extension
check('2.1: Attack landing hit on opponent does not increment over_extensions', () => {
  const tact = new TacticalDetector(mockSettings);
  const frames = [];
  // P0 conversion starts at f1, ends after 45f advantage neutralization
  frames.push(createFrame(1, { anim: ACTION_STATES.WAIT, percent: 0, x: 0 }, { anim: ACTION_STATES.WAIT, percent: 0, x: 15 }));
  frames.push(createFrame(2, { anim: 58, percent: 0, x: 0 }, { anim: 75, percent: 15, x: 15 }));
  for (let f = 3; f <= 48; f++) {
    frames.push(createFrame(f, { anim: ACTION_STATES.WAIT, percent: 0, x: 0 }, { anim: ACTION_STATES.WAIT, percent: 15, x: 15 }));
  }
  // Transition window active: P0 commits to forward tilt (anim = 44) at f50
  frames.push(createFrame(50, { anim: 44, percent: 0, x: 5 }, { anim: ACTION_STATES.WAIT, percent: 15, x: 10 }));
  // Hit connects at f52 (Opp percent increases from 15 to 25)
  frames.push(createFrame(51, { anim: 44, percent: 0, x: 5 }, { anim: ACTION_STATES.WAIT, percent: 15, x: 10 }));
  frames.push(createFrame(52, { anim: 44, percent: 0, x: 5 }, { anim: 75, percent: 25, x: 10 }));
  // Attack animation completes at f56 into WAIT
  frames.push(createFrame(53, { anim: 44, percent: 0, x: 5 }, { anim: 75, percent: 25, x: 10 }));
  frames.push(createFrame(54, { anim: 44, percent: 0, x: 5 }, { anim: 75, percent: 25, x: 10 }));
  frames.push(createFrame(55, { anim: 44, percent: 0, x: 5 }, { anim: 75, percent: 25, x: 10 }));
  frames.push(createFrame(56, { anim: ACTION_STATES.WAIT, percent: 0, x: 5 }, { anim: 75, percent: 25, x: 10 }));
  feedSequence(tact, frames);

  const stats = tact.getHabitStats(0);
  assert.strictEqual(stats.over_extensions, 0, 'Successful attack must not increment over_extensions');
});

// 2.2: Attack completely whiffs -> MUST increment over_extensions (counterHit = false)
check('2.2: Attack whiffing completely increments over_extensions (counterHit = false)', () => {
  const tact = new TacticalDetector(mockSettings);
  const frames = [];
  frames.push(createFrame(1, { anim: ACTION_STATES.WAIT, percent: 0, x: 0 }, { anim: ACTION_STATES.WAIT, percent: 0, x: 15 }));
  frames.push(createFrame(2, { anim: 58, percent: 0, x: 0 }, { anim: 75, percent: 15, x: 15 }));
  for (let f = 3; f <= 48; f++) {
    frames.push(createFrame(f, { anim: ACTION_STATES.WAIT, percent: 0, x: 0 }, { anim: ACTION_STATES.WAIT, percent: 15, x: 15 }));
  }
  // P0 commits to forward tilt (anim = 44) at f50
  frames.push(createFrame(50, { anim: 44, percent: 0, x: 5 }, { anim: ACTION_STATES.WAIT, percent: 15, x: 25 }));
  frames.push(createFrame(51, { anim: 44, percent: 0, x: 5 }, { anim: ACTION_STATES.WAIT, percent: 15, x: 25 }));
  // Attack finishes into WAIT at f54 without hitting opponent
  frames.push(createFrame(52, { anim: 44, percent: 0, x: 5 }, { anim: ACTION_STATES.WAIT, percent: 15, x: 25 }));
  frames.push(createFrame(53, { anim: 44, percent: 0, x: 5 }, { anim: ACTION_STATES.WAIT, percent: 15, x: 25 }));
  frames.push(createFrame(54, { anim: ACTION_STATES.WAIT, percent: 0, x: 5 }, { anim: ACTION_STATES.WAIT, percent: 15, x: 25 }));
  feedSequence(tact, frames);

  const stats = tact.getHabitStats(0);
  assert.strictEqual(stats.over_extensions, 1, 'Whiffed attack must increment over_extensions');
  const payload = tact.getHabitPayload();
  const decision = payload.transitionDecisions.find(d => d.playerIndex === 0 && d.type === 'over_extension');
  assert.ok(decision, 'Transition decision must be recorded');
  assert.strictEqual(decision.counterHit, false, 'Whiff must have counterHit = false');
});

// 2.3: Attack hits opponent BUT player takes counter-hit damage -> MUST increment over_extensions (counterHit = true)
check('2.3: Attack taking counter-hit damage increments over_extensions (counterHit = true)', () => {
  const tact = new TacticalDetector(mockSettings);
  const frames = [];
  frames.push(createFrame(1, { anim: ACTION_STATES.WAIT, percent: 0, x: 0 }, { anim: ACTION_STATES.WAIT, percent: 0, x: 15 }));
  frames.push(createFrame(2, { anim: 58, percent: 0, x: 0 }, { anim: 75, percent: 15, x: 15 }));
  for (let f = 3; f <= 48; f++) {
    frames.push(createFrame(f, { anim: ACTION_STATES.WAIT, percent: 0, x: 0 }, { anim: ACTION_STATES.WAIT, percent: 15, x: 15 }));
  }
  // P0 commits to attack at f50
  frames.push(createFrame(50, { anim: 44, percent: 0, x: 5 }, { anim: ACTION_STATES.WAIT, percent: 15, x: 10 }));
  // Opponent counter-hits P0 at f52 (P0 takes 12% damage)
  frames.push(createFrame(51, { anim: 44, percent: 0, x: 5 }, { anim: ACTION_STATES.WAIT, percent: 15, x: 10 }));
  frames.push(createFrame(52, { anim: ACTION_STATES.DAMAGE_START, percent: 12, x: 5 }, { anim: 44, percent: 15, x: 10 }));
  feedSequence(tact, frames);

  const stats = tact.getHabitStats(0);
  assert.strictEqual(stats.over_extensions, 1, 'Counter-hit must increment over_extensions');
  const payload = tact.getHabitPayload();
  const decision = payload.transitionDecisions.find(d => d.playerIndex === 0 && d.type === 'over_extension');
  assert.ok(decision, 'Transition decision must be recorded');
  assert.strictEqual(decision.counterHit, true, 'Counter-hit must have counterHit = true');
});

// ===========================================================================
// SECTION 3: Ledgedash Invalidation on Standard Ledge Options & Intermediate States
// ===========================================================================
console.log('\n--- Section 3: Ledgedash Invalidation in TacticalDetector ---');

// 3.1: Standard ledge climb (CLIFF_CLIMB_SLOW & CLIFF_CLIMB_QUICK)
check('3.1: CLIFF_CLIMB_SLOW and CLIFF_CLIMB_QUICK invalidate ledgedash candidate', () => {
  // Test slow climb
  const tactSlow = new TacticalDetector(mockSettings);
  feedSequence(tactSlow, [
    createFrame(1, { anim: ACTION_STATES.CLIFF_WAIT, x: -71.3 }),
    createFrame(5, { anim: ACTION_STATES.CLIFF_CLIMB_SLOW, x: -65.0 }),
    createFrame(15, { anim: ACTION_STATES.WAIT, x: -60.0 }),
    createFrame(20, { anim: ACTION_STATES.LANDING_FALL_SPECIAL, x: -55.0 }),
  ]);
  assert.strictEqual(tactSlow.getHabitStats(0).climb_count, 1, 'Climb count must be 1');
  assert.strictEqual(tactSlow.getHabitStats(0).ledgedash_count, 0, 'Ledgedash count must be 0 after slow climb');

  // Test quick climb
  const tactQuick = new TacticalDetector(mockSettings);
  feedSequence(tactQuick, [
    createFrame(1, { anim: ACTION_STATES.CLIFF_WAIT, x: -71.3 }),
    createFrame(5, { anim: ACTION_STATES.CLIFF_CLIMB_QUICK, x: -65.0 }),
    createFrame(15, { anim: ACTION_STATES.WAIT, x: -60.0 }),
    createFrame(20, { anim: ACTION_STATES.LANDING_FALL_SPECIAL, x: -55.0 }),
  ]);
  assert.strictEqual(tactQuick.getHabitStats(0).climb_count, 1, 'Climb count must be 1');
  assert.strictEqual(tactQuick.getHabitStats(0).ledgedash_count, 0, 'Ledgedash count must be 0 after quick climb');
});

// 3.2: Standard ledge roll (CLIFF_ESCAPE_SLOW & CLIFF_ESCAPE_QUICK)
check('3.2: Ledge roll invalidates ledgedash candidate', () => {
  const tact = new TacticalDetector(mockSettings);
  feedSequence(tact, [
    createFrame(1, { anim: ACTION_STATES.CLIFF_WAIT, x: -71.3 }),
    createFrame(5, { anim: ACTION_STATES.CLIFF_ESCAPE_SLOW, x: -65.0 }),
    createFrame(15, { anim: ACTION_STATES.WAIT, x: -50.0 }),
    createFrame(20, { anim: ACTION_STATES.LANDING_FALL_SPECIAL, x: -45.0 }),
  ]);
  assert.strictEqual(tact.getHabitStats(0).roll_count, 1, 'Roll count must be 1');
  assert.strictEqual(tact.getHabitStats(0).ledgedash_count, 0, 'Ledgedash count must be 0 after roll');
});

// 3.3: Standard ledge attack (CLIFF_ATTACK_SLOW & CLIFF_ATTACK_QUICK)
check('3.3: Ledge attack invalidates ledgedash candidate', () => {
  const tact = new TacticalDetector(mockSettings);
  feedSequence(tact, [
    createFrame(1, { anim: ACTION_STATES.CLIFF_WAIT, x: -71.3 }),
    createFrame(5, { anim: ACTION_STATES.CLIFF_ATTACK_SLOW, x: -65.0 }),
    createFrame(15, { anim: ACTION_STATES.WAIT, x: -55.0 }),
    createFrame(20, { anim: ACTION_STATES.LANDING_FALL_SPECIAL, x: -50.0 }),
  ]);
  assert.strictEqual(tact.getHabitStats(0).attack_count, 1, 'Attack count must be 1');
  assert.strictEqual(tact.getHabitStats(0).ledgedash_count, 0, 'Ledgedash count must be 0 after attack');
});

// 3.4: Standard ledge jump (CLIFF_JUMP_SLOW & CLIFF_JUMP_QUICK)
check('3.4: Ledge jump invalidates ledgedash candidate', () => {
  const tact = new TacticalDetector(mockSettings);
  feedSequence(tact, [
    createFrame(1, { anim: ACTION_STATES.CLIFF_WAIT, x: -71.3 }),
    createFrame(5, { anim: ACTION_STATES.CLIFF_JUMP_SLOW, x: -65.0 }),
    createFrame(15, { anim: ACTION_STATES.FALL, x: -60.0, isAirborne: true }),
    createFrame(20, { anim: ACTION_STATES.LANDING_FALL_SPECIAL, x: -55.0 }),
  ]);
  assert.strictEqual(tact.getHabitStats(0).jump_count, 1, 'Jump count must be 1');
  assert.strictEqual(tact.getHabitStats(0).ledgedash_count, 0, 'Ledgedash count must be 0 after ledge jump');
});

// 3.5: Grounded state (isAirborne === false) touches stage before LANDING_FALL_SPECIAL
check('3.5: Touching ground (isAirborne === false) before landing invalidates candidate', () => {
  const tact = new TacticalDetector(mockSettings);
  feedSequence(tact, [
    createFrame(1, { anim: ACTION_STATES.CLIFF_WAIT, x: -71.3 }),
    createFrame(5, { anim: ACTION_STATES.FALL, x: -68.0, isAirborne: true }),
    // Touches ground in WAIT (isAirborne: false)
    createFrame(10, { anim: ACTION_STATES.WAIT, x: -65.0, isAirborne: false }),
    createFrame(15, { anim: ACTION_STATES.LANDING_FALL_SPECIAL, x: -60.0 }),
  ]);
  assert.strictEqual(tact.getHabitStats(0).ledgedash_count, 0, 'Touching ground must invalidate ledgedash candidate');
});

// 3.6: Non-permitted airborne state (e.g., aerial attack 0x41) invalidates candidate
check('3.6: Non-permitted airborne state (aerial attack) invalidates candidate', () => {
  const tact = new TacticalDetector(mockSettings);
  feedSequence(tact, [
    createFrame(1, { anim: ACTION_STATES.CLIFF_WAIT, x: -71.3 }),
    createFrame(5, { anim: ACTION_STATES.FALL, x: -68.0, isAirborne: true }),
    // Aerial attack from ledge
    createFrame(10, { anim: 0x41, x: -65.0, isAirborne: true }), // ATTACK_AIR_N
    createFrame(15, { anim: ACTION_STATES.AIR_DODGE, x: -63.0, isAirborne: true }),
    createFrame(20, { anim: ACTION_STATES.LANDING_FALL_SPECIAL, x: -60.0 }),
  ]);
  assert.strictEqual(tact.getHabitStats(0).ledgedash_count, 0, 'Aerial attack must invalidate ledgedash candidate');
});

// 3.7: Clean permitted ledgedash (CLIFF_WAIT -> FALL -> JUMP_F -> AIR_DODGE -> LANDING_FALL_SPECIAL <= 35f)
check('3.7: Clean legal ledgedash sequence correctly recorded', () => {
  const tact = new TacticalDetector(mockSettings);
  feedSequence(tact, [
    createFrame(1, { anim: ACTION_STATES.CLIFF_WAIT, x: -71.3 }),
    createFrame(5, { anim: ACTION_STATES.FALL, x: -68.0, isAirborne: true }),
    createFrame(10, { anim: ACTION_STATES.JUMP_F, x: -67.0, isAirborne: true }),
    createFrame(15, { anim: ACTION_STATES.AIR_DODGE, x: -65.0, isAirborne: true }),
    createFrame(20, { anim: ACTION_STATES.LANDING_FALL_SPECIAL, x: -60.0 }),
  ]);
  assert.strictEqual(tact.getHabitStats(0).ledgedash_count, 1, 'Clean ledgedash must be counted');
});

// 3.8: Spacie shine ledgedash (CLIFF_WAIT -> FALL -> SHINE -> AIR_DODGE -> LANDING_FALL_SPECIAL <= 35f)
check('3.8: Spacie shine ledgedash sequence correctly recorded', () => {
  const tact = new TacticalDetector(mockSettings);
  feedSequence(tact, [
    createFrame(1, { anim: ACTION_STATES.CLIFF_WAIT, x: -71.3 }),
    createFrame(5, { anim: ACTION_STATES.FALL, x: -68.0, isAirborne: true }),
    createFrame(10, { anim: ACTION_STATES.SHINE_START, x: -68.0, isAirborne: true }),
    createFrame(12, { anim: ACTION_STATES.AIR_DODGE, x: -65.0, isAirborne: true }),
    createFrame(18, { anim: ACTION_STATES.LANDING_FALL_SPECIAL, x: -60.0 }),
  ]);
  assert.strictEqual(tact.getHabitStats(0).ledgedash_count, 1, 'Spacie shine ledgedash must be counted');
});

// ===========================================================================
// SECTION 4: MechanicsDetector Ledgedash Reset on CLIFF_CATCH or isDamage
// ===========================================================================
console.log('\n--- Section 4: MechanicsDetector Ledgedash Reset ---');

// 4.1: CLIFF_CATCH ledge re-grab resets MechanicsDetector timing
check('4.1: MechanicsDetector resets ledgedash timing on CLIFF_CATCH', () => {
  const mech = new MechanicsDetector(mockSettings);
  feedSequence(mech, [
    createFrame(1, { anim: ACTION_STATES.CLIFF_WAIT }),
    createFrame(5, { anim: ACTION_STATES.FALL }),
    createFrame(10, { anim: ACTION_STATES.CLIFF_CATCH }), // Re-grab ledge
    createFrame(20, { anim: ACTION_STATES.LANDING_FALL_SPECIAL }), // 20 - 1 = 19 <= 35 from original, but invalid!
  ]);
  const m0 = mech.fetch().find(p => p.playerIndex === 0);
  assert.strictEqual(m0.ledgedashCount, 0, 'CLIFF_CATCH must reset ledgedash tracking in MechanicsDetector');
});

// 4.2: isDamage resets MechanicsDetector timing
check('4.2: MechanicsDetector resets ledgedash timing on isDamage', () => {
  const mech = new MechanicsDetector(mockSettings);
  feedSequence(mech, [
    createFrame(1, { anim: ACTION_STATES.CLIFF_WAIT }),
    createFrame(5, { anim: ACTION_STATES.FALL }),
    createFrame(10, { anim: ACTION_STATES.DAMAGE_START, percent: 10 }), // Hit offstage
    createFrame(20, { anim: ACTION_STATES.LANDING_FALL_SPECIAL }),
  ]);
  const m0 = mech.fetch().find(p => p.playerIndex === 0);
  assert.strictEqual(m0.ledgedashCount, 0, 'isDamage must reset ledgedash tracking in MechanicsDetector');
});

// 4.3: Valid subsequent ledgedash after an interrupted attempt
check('4.3: MechanicsDetector correctly counts subsequent valid ledgedash after re-grab', () => {
  const mech = new MechanicsDetector(mockSettings);
  feedSequence(mech, [
    createFrame(1, { anim: ACTION_STATES.CLIFF_WAIT }),
    createFrame(5, { anim: ACTION_STATES.FALL }),
    createFrame(10, { anim: ACTION_STATES.CLIFF_CATCH }), // Interrupted
    // Player hangs again and gets a new CLIFF_WAIT
    createFrame(15, { anim: ACTION_STATES.CLIFF_WAIT }),
    createFrame(20, { anim: ACTION_STATES.FALL }),
    createFrame(25, { anim: ACTION_STATES.AIR_DODGE }),
    createFrame(30, { anim: ACTION_STATES.LANDING_FALL_SPECIAL }), // 30 - 15 = 15 <= 35
  ]);
  const m0 = mech.fetch().find(p => p.playerIndex === 0);
  assert.strictEqual(m0.ledgedashCount, 1, 'Subsequent clean ledgedash must be counted');
});

// 4.4: MechanicsDetector and TacticalDetector parity on identical sequence
check('4.4: Parity between MechanicsDetector and TacticalDetector on complex sequence', () => {
  const tact = new TacticalDetector(mockSettings);
  const mech = new MechanicsDetector(mockSettings);
  const sequence = [
    // 1. Interrupted attempt with CLIFF_CATCH
    createFrame(1, { anim: ACTION_STATES.CLIFF_WAIT, x: -71.3 }),
    createFrame(5, { anim: ACTION_STATES.FALL, x: -71.3, isAirborne: true }),
    createFrame(10, { anim: ACTION_STATES.CLIFF_CATCH, x: -71.3 }),
    createFrame(12, { anim: ACTION_STATES.LANDING_FALL_SPECIAL, x: -60.0 }), // should not count
    // 2. Interrupted attempt with DAMAGE
    createFrame(20, { anim: ACTION_STATES.CLIFF_WAIT, x: -71.3 }),
    createFrame(25, { anim: ACTION_STATES.FALL, x: -71.3, isAirborne: true }),
    createFrame(28, { anim: ACTION_STATES.DAMAGE_START, percent: 10, x: -71.3 }),
    createFrame(35, { anim: ACTION_STATES.LANDING_FALL_SPECIAL, x: -60.0 }), // should not count
    // 3. Valid clean ledgedash
    createFrame(50, { anim: ACTION_STATES.CLIFF_WAIT, x: -71.3 }),
    createFrame(55, { anim: ACTION_STATES.FALL, x: -71.3, isAirborne: true }),
    createFrame(60, { anim: ACTION_STATES.AIR_DODGE, x: -65.0, isAirborne: true }),
    createFrame(65, { anim: ACTION_STATES.LANDING_FALL_SPECIAL, x: -60.0 }), // should count (65 - 50 = 15 <= 35)
  ];

  feedSequence(tact, sequence);
  feedSequence(mech, sequence);

  const tactStats = tact.getHabitStats(0);
  const m0 = mech.fetch().find(p => p.playerIndex === 0);

  assert.strictEqual(tactStats.ledgedash_count, 1, 'TacticalDetector ledgedash_count must be exactly 1');
  assert.strictEqual(m0.ledgedashCount, 1, 'MechanicsDetector ledgedashCount must be exactly 1');
});

console.log('\n=================================================================');
console.log(`RE-VERIFICATION SUMMARY: ${passedChecks}/${totalChecks} Checks Passed`);
console.log('=================================================================');
