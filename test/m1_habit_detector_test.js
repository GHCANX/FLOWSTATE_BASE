import assert from 'node:assert';
import { TacticalDetector } from '../src/analysis/tacticalDetector.js';
import { MechanicsDetector } from '../src/analysis/mechanicsDetector.js';
import { 
  ACTION_STATES, 
  isAttack, 
  isWakeup, 
  isDownWait, 
  isStandardLedgeOption, 
  isCliffOption 
} from '../src/constants/actionStates.js';

console.log('=== VERIFYING MILESTONE 1: HABIT DETECTION ENGINE ===');

// 1. Action State Constants & Predicates Verification
console.log('1. Verifying Action State Constants & Predicates...');
assert.strictEqual(ACTION_STATES.DOWN_WAIT_U, 0xB8);
assert.strictEqual(ACTION_STATES.DOWN_WAIT_D, 0xC0);
assert.strictEqual(ACTION_STATES.DOWN_STAND_U, 0xB9);
assert.strictEqual(ACTION_STATES.DOWN_STAND_D, 0xC1);
assert.strictEqual(ACTION_STATES.DOWN_FORWARD_U, 0xBA);
assert.strictEqual(ACTION_STATES.DOWN_FORWARD_D, 0xC2);
assert.strictEqual(ACTION_STATES.DOWN_BACK_U, 0xBB);
assert.strictEqual(ACTION_STATES.DOWN_BACK_D, 0xC3);
assert.strictEqual(ACTION_STATES.DOWN_ATTACK_U, 0xBC);
assert.strictEqual(ACTION_STATES.DOWN_ATTACK_D, 0xC4);

assert.strictEqual(isDownWait(0xB8), true);
assert.strictEqual(isDownWait(0xC0), true);
assert.strictEqual(isDownWait(0x0E), false);

assert.strictEqual(isWakeup(0xB9), true);
assert.strictEqual(isWakeup(0xBC), true);
assert.strictEqual(isWakeup(0xC1), true);
assert.strictEqual(isWakeup(0xC4), true);
assert.strictEqual(isWakeup(0xB8), false);
assert.strictEqual(isWakeup(0xC0), false);

assert.strictEqual(isAttack(44), true); // 0x2C
assert.strictEqual(isAttack(69), true); // 0x45
assert.strictEqual(isAttack(341), true);
assert.strictEqual(isAttack(360), true);
assert.strictEqual(isAttack(14), false); // WAIT

assert.strictEqual(isStandardLedgeOption(0xFE), true);
assert.strictEqual(isStandardLedgeOption(0x105), true);
assert.strictEqual(isStandardLedgeOption(0xFD), false); // CLIFF_WAIT
assert.strictEqual(isCliffOption(0xFE), true);
console.log('✔ Action state constants and predicates verified.');

// 2. Synthetic Test Harness for TacticalDetector
console.log('2. Verifying TacticalDetector Habit Detection & Interface Contracts...');

const mockSettings = {
  stageId: 31, // Battlefield (xMax = 68.4)
  players: [
    { playerIndex: 0, port: 1, characterId: 2, startStocks: 4 },
    { playerIndex: 1, port: 2, characterId: 20, startStocks: 4 },
  ],
};

function createFrame(frameNum, p0State, p1State) {
  return {
    frame: frameNum,
    players: {
      0: {
        post: {
          actionStateId: p0State.anim,
          positionX: p0State.x ?? 0,
          positionY: p0State.y ?? 0,
          percent: p0State.percent ?? 0,
          stocksRemaining: p0State.stocks ?? 4,
          hitlagRemaining: p0State.hitlag ?? 0,
          lastAttackLanded: p0State.attackLanded ?? 0,
        },
      },
      1: {
        post: {
          actionStateId: p1State.anim,
          positionX: p1State.x ?? 50,
          positionY: p1State.y ?? 0,
          percent: p1State.percent ?? 0,
          stocksRemaining: p1State.stocks ?? 4,
          hitlagRemaining: p1State.hitlag ?? 0,
          lastAttackLanded: p1State.attackLanded ?? 0,
        },
      },
    },
  };
}

const tact = new TacticalDetector(mockSettings);

// Test 2a: Standard Ledge Climb + Punished within 30f recovery window
console.log('2a. Testing Ledge Climb and Punish tracking...');
let f = 100;
let prev = createFrame(f++, { anim: ACTION_STATES.CLIFF_WAIT, x: -70, y: -10 }, { anim: ACTION_STATES.WAIT, x: -50, y: 0 });
tact.processFrame(prev, null);

// P0 inputs CLIFF_CLIMB_SLOW
let curr = createFrame(f++, { anim: ACTION_STATES.CLIFF_CLIMB_SLOW, x: -65, y: 0 }, { anim: ACTION_STATES.WAIT, x: -50, y: 0 });
tact.processFrame(curr, prev);
prev = curr;

// P0 remains in climb for 10 frames
for (let i = 0; i < 10; i++) {
  curr = createFrame(f++, { anim: ACTION_STATES.CLIFF_CLIMB_SLOW, x: -65, y: 0 }, { anim: ACTION_STATES.WAIT, x: -50, y: 0 });
  tact.processFrame(curr, prev);
  prev = curr;
}

// P0 exits climb into WAIT (frame 112)
curr = createFrame(f++, { anim: ACTION_STATES.WAIT, x: -60, y: 0 }, { anim: ACTION_STATES.WAIT, x: -50, y: 0 });
tact.processFrame(curr, prev);
prev = curr;

// 15 frames later, P1 attacks P0, dealing damage
for (let i = 0; i < 15; i++) {
  curr = createFrame(f++, { anim: ACTION_STATES.WAIT, x: -60, y: 0 }, { anim: ACTION_STATES.WAIT, x: -50, y: 0 });
  tact.processFrame(curr, prev);
  prev = curr;
}
curr = createFrame(f++, { anim: ACTION_STATES.DAMAGE_START, x: -60, y: 0, percent: 12 }, { anim: ACTION_STATES.ATTACK_USMASH, x: -55, y: 0, attackLanded: 10 });
tact.processFrame(curr, prev);
prev = curr;

let statsP0 = tact.getHabitStats(0);
assert.strictEqual(statsP0.climb_count, 1, 'climb_count should be 1');
assert.strictEqual(statsP0.climb_punished, 1, 'climb_punished should be 1');
console.log('✔ Ledge climb and 30f punish tracking verified.');

// Test 2b: 35f Ledgedash Heuristic to stage surface (|X| <= 68.4)
console.log('2b. Testing 35f Ledgedash Heuristic...');
// P0 in CLIFF_WAIT
curr = createFrame(f++, { anim: ACTION_STATES.CLIFF_WAIT, x: 70, y: -10 }, { anim: ACTION_STATES.WAIT, x: 0, y: 0 });
tact.processFrame(curr, prev);
prev = curr;

// P0 drops with FALL (0x1D)
curr = createFrame(f++, { anim: ACTION_STATES.FALL, x: 68, y: -12 }, { anim: ACTION_STATES.WAIT, x: 0, y: 0 });
tact.processFrame(curr, prev);
prev = curr;

// P0 air dodges (0xEC)
curr = createFrame(f++, { anim: ACTION_STATES.AIR_DODGE, x: 65, y: 1 }, { anim: ACTION_STATES.WAIT, x: 0, y: 0 });
tact.processFrame(curr, prev);
prev = curr;

// P0 lands in LANDING_FALL_SPECIAL (0x29) on stage (|X| = 62 <= 68.4) within 4 frames
curr = createFrame(f++, { anim: ACTION_STATES.LANDING_FALL_SPECIAL, x: 62, y: 0 }, { anim: ACTION_STATES.WAIT, x: 0, y: 0 });
tact.processFrame(curr, prev);
prev = curr;

statsP0 = tact.getHabitStats(0);
assert.strictEqual(statsP0.ledgedash_count, 1, 'ledgedash_count should be 1');
console.log('✔ 35f Ledgedash Heuristic verified.');

// Test 2c: Ground Tech & Missed-Tech Wakeup
console.log('2c. Testing Tech and Wakeup options...');
// P0 tech neutral
curr = createFrame(f++, { anim: ACTION_STATES.TECH_NEUTRAL, x: 0, y: 0, percent: 12 }, { anim: ACTION_STATES.WAIT, x: 30, y: 0 });
tact.processFrame(curr, prev);
prev = curr;

// P0 missed tech
curr = createFrame(f++, { anim: ACTION_STATES.TECH_MISS_UP, x: 0, y: 0, percent: 12 }, { anim: ACTION_STATES.WAIT, x: 30, y: 0 });
tact.processFrame(curr, prev);
prev = curr;

// P0 down wait
curr = createFrame(f++, { anim: ACTION_STATES.DOWN_WAIT_U, x: 0, y: 0, percent: 12 }, { anim: ACTION_STATES.WAIT, x: 30, y: 0 });
tact.processFrame(curr, prev);
prev = curr;

// P0 wakeup forward roll
curr = createFrame(f++, { anim: ACTION_STATES.DOWN_FORWARD_U, x: 10, y: 0, percent: 12 }, { anim: ACTION_STATES.WAIT, x: 30, y: 0 });
tact.processFrame(curr, prev);
prev = curr;

statsP0 = tact.getHabitStats(0);
assert.strictEqual(statsP0.tech_neutral_count, 1, 'tech_neutral_count should be 1');
assert.strictEqual(statsP0.tech_miss_count, 1, 'tech_miss_count should be 1');
assert.strictEqual(statsP0.wakeup_forward_count, 1, 'wakeup_forward_count should be 1');
console.log('✔ Ground tech and missed-tech wakeup verified.');

// Test 2d: Grab Initiation Context (Shield-Pressure, Scramble, Neutral)
console.log('2d. Testing Grab Initiation Contexts...');
// Set P1 in shield
for (let i = 0; i < 35; i++) {
  curr = createFrame(f++, { anim: ACTION_STATES.WAIT, x: 0, y: 0, percent: 12 }, { anim: ACTION_STATES.GUARD, x: 10, y: 0 });
  tact.processFrame(curr, prev);
  prev = curr;
}
// P1 exits shield to WAIT
curr = createFrame(f++, { anim: ACTION_STATES.WAIT, x: 0, y: 0, percent: 12 }, { anim: ACTION_STATES.WAIT, x: 10, y: 0 });
tact.processFrame(curr, prev);
prev = curr;

// Within 5 frames, P0 initiates GRAB (0xD4) -> Shield Pressure Grab
curr = createFrame(f++, { anim: ACTION_STATES.GRAB, x: 0, y: 0, percent: 12 }, { anim: ACTION_STATES.WAIT, x: 10, y: 0 });
tact.processFrame(curr, prev);
prev = curr;

statsP0 = tact.getHabitStats(0);
assert.strictEqual(statsP0.grabs_shield_pressure, 1, 'grabs_shield_pressure should be 1');

// Advance 35 frames so both have no shield/hitstun in 30f
for (let i = 0; i < 35; i++) {
  curr = createFrame(f++, { anim: ACTION_STATES.WAIT, x: 0, y: 0, percent: 12 }, { anim: ACTION_STATES.WAIT, x: 14, y: 0 });
  tact.processFrame(curr, prev);
  prev = curr;
}
// D = 14 <= 18.0, neither in shield/hitstun for 35 frames -> Scramble Grab!
curr = createFrame(f++, { anim: ACTION_STATES.GRAB, x: 0, y: 0, percent: 12 }, { anim: ACTION_STATES.WAIT, x: 14, y: 0 });
tact.processFrame(curr, prev);
prev = curr;

statsP0 = tact.getHabitStats(0);
assert.strictEqual(statsP0.grabs_scramble, 1, 'grabs_scramble should be 1');

// Move to D = 30 > 18.0 -> Neutral Setup Grab
curr = createFrame(f++, { anim: ACTION_STATES.WAIT, x: 0, y: 0, percent: 12 }, { anim: ACTION_STATES.WAIT, x: 30, y: 0 });
tact.processFrame(curr, prev);
prev = curr;
curr = createFrame(f++, { anim: ACTION_STATES.DASH_GRAB, x: 0, y: 0, percent: 12 }, { anim: ACTION_STATES.WAIT, x: 30, y: 0 });
tact.processFrame(curr, prev);
prev = curr;

statsP0 = tact.getHabitStats(0);
assert.strictEqual(statsP0.grabs_neutral, 1, 'grabs_neutral should be 1');
console.log('✔ Grab initiation contexts verified.');

// Test 2e: Out of Shield Options & Corner Drift
console.log('2e. Testing OOS Options and Corner Drift...');
// P0 shields
curr = createFrame(f++, { anim: ACTION_STATES.GUARD, x: -20, y: 0, percent: 12 }, { anim: ACTION_STATES.WAIT, x: 10, y: 0 });
tact.processFrame(curr, prev);
prev = curr;

// P0 rolls out of shield
curr = createFrame(f++, { anim: ACTION_STATES.ROLL_F, x: -10, y: 0, percent: 12 }, { anim: ACTION_STATES.WAIT, x: 10, y: 0 });
tact.processFrame(curr, prev);
prev = curr;

statsP0 = tact.getHabitStats(0);
assert.strictEqual(statsP0.oos_roll_count, 1, 'oos_roll_count should be 1');

// Corner drift: P0 drifts toward ledge under D <= 20 proximity pressure
// Battlefield xMax = 68.4. Corner zone >= 43.4.
curr = createFrame(f++, { anim: ACTION_STATES.WAIT, x: 44, y: 0, percent: 12 }, { anim: ACTION_STATES.WAIT, x: 35, y: 0 });
tact.processFrame(curr, prev);
prev = curr;
curr = createFrame(f++, { anim: ACTION_STATES.WAIT, x: 48, y: 0, percent: 12 }, { anim: ACTION_STATES.WAIT, x: 38, y: 0 });
tact.processFrame(curr, prev);
prev = curr;

statsP0 = tact.getHabitStats(0);
assert.strictEqual(statsP0.corner_drift_count, 1, 'corner_drift_count should be 1');
console.log('✔ OOS options and corner drift verified.');

// Test 2g: Neutral Reset vs Over-Extension Boundary (45f window)
console.log('2g. Testing Neutral Reset vs Over-Extension Boundary...');
const prevResets = statsP0.neutral_resets;
const prevOverExt = statsP0.over_extensions;

// Trigger pressure on shield ending without opening
for (let i = 0; i < 25; i++) {
  curr = createFrame(f++, { anim: ACTION_STATES.WAIT, x: 0, y: 0, percent: 12 }, { anim: ACTION_STATES.GUARD, x: 10, y: 0 });
  tact.processFrame(curr, prev);
  prev = curr;
}
// P1 exits shield, pressure ends after 31 frames without opening -> advantage neutralized for P0
for (let i = 0; i < 32; i++) {
  curr = createFrame(f++, { anim: ACTION_STATES.WAIT, x: 0, y: 0, percent: 12 }, { anim: ACTION_STATES.WAIT, x: 10, y: 0 });
  tact.processFrame(curr, prev);
  prev = curr;
}
// P0 retreats away from P1 (x = 0 -> -20, increasing distance to 30) for 46 frames
for (let i = 0; i < 46; i++) {
  curr = createFrame(f++, { anim: ACTION_STATES.WAIT, x: -20, y: 0, percent: 12 }, { anim: ACTION_STATES.WAIT, x: 10, y: 0 });
  tact.processFrame(curr, prev);
  prev = curr;
}
statsP0 = tact.getHabitStats(0);
assert.strictEqual(statsP0.neutral_resets - prevResets, 1, 'neutral_resets should increment by 1');

// Now trigger over-extension: advantage neutralized, P0 commits to attack and takes counter-hit
for (let i = 0; i < 25; i++) {
  curr = createFrame(f++, { anim: ACTION_STATES.WAIT, x: 0, y: 0, percent: 12 }, { anim: ACTION_STATES.GUARD, x: 10, y: 0 });
  tact.processFrame(curr, prev);
  prev = curr;
}
for (let i = 0; i < 32; i++) {
  curr = createFrame(f++, { anim: ACTION_STATES.WAIT, x: 0, y: 0, percent: 12 }, { anim: ACTION_STATES.WAIT, x: 10, y: 0 });
  tact.processFrame(curr, prev);
  prev = curr;
}
// P0 commits to attack (e.g. jab 44)
curr = createFrame(f++, { anim: 44, x: 5, y: 0, percent: 12 }, { anim: ACTION_STATES.WAIT, x: 10, y: 0 });
tact.processFrame(curr, prev);
prev = curr;
// P0 gets counter-hit by P1
curr = createFrame(f++, { anim: ACTION_STATES.DAMAGE_START, x: 5, y: 0, percent: 25 }, { anim: ACTION_STATES.ATTACK_USMASH, x: 10, y: 0 });
tact.processFrame(curr, prev);
prev = curr;

statsP0 = tact.getHabitStats(0);
assert.strictEqual(statsP0.over_extensions - prevOverExt, 1, 'over_extensions should increment by 1');
console.log('✔ Neutral reset and over-extension verified.');

// Test 2f: Interface Contracts Verification
console.log('2f. Testing Interface Contracts (40 columns & habit payload)...');
const all40Columns = [
  'climb_count', 'climb_punished', 'attack_count', 'attack_punished',
  'roll_count', 'roll_punished', 'jump_count', 'jump_punished',
  'ledgedash_count', 'ledgedash_punished', 'tech_neutral_count',
  'tech_neutral_punished', 'tech_forward_count', 'tech_forward_punished',
  'tech_back_count', 'tech_back_punished', 'tech_miss_count',
  'tech_miss_punished', 'wakeup_stand_count', 'wakeup_stand_punished',
  'wakeup_forward_count', 'wakeup_forward_punished', 'wakeup_back_count',
  'wakeup_back_punished', 'wakeup_attack_count', 'wakeup_attack_punished',
  'grabs_shield_pressure', 'grabs_scramble', 'grabs_neutral',
  'neutral_resets', 'over_extensions', 'oos_roll_count',
  'oos_roll_punished', 'oos_spotdodge_count', 'oos_spotdodge_punished',
  'oos_grab_count', 'oos_grab_punished', 'oos_aerial_count',
  'oos_aerial_punished', 'corner_drift_count'
];

assert.strictEqual(all40Columns.length, 40);
for (const col of all40Columns) {
  assert.ok(statsP0[col] !== undefined, `Missing column ${col} in getHabitStats`);
  assert.strictEqual(typeof statsP0[col], 'number', `${col} must be a number`);
}

const payload = tact.getHabitPayload();
assert.ok(Array.isArray(payload.getupEvents), 'payload.getupEvents must be array');
assert.ok(Array.isArray(payload.grabTriggers), 'payload.grabTriggers must be array');
assert.ok(Array.isArray(payload.transitionDecisions), 'payload.transitionDecisions must be array');
assert.ok(Array.isArray(payload.escapeSequences), 'payload.escapeSequences must be array');
assert.ok(payload.getupEvents.length > 0, 'getupEvents should contain recorded events');
assert.ok(payload.grabTriggers.length > 0, 'grabTriggers should contain recorded events');
assert.ok(payload.escapeSequences.length > 0, 'escapeSequences should contain recorded events');

console.log('✔ All 40 habit columns and granular habit payload verified.');

// 3. MechanicsDetector OOS Aerial Alignment
console.log('3. Verifying MechanicsDetector OOS Aerial Alignment...');
const mech = new MechanicsDetector(mockSettings);
// P0 shields
let mPrev = createFrame(10, { anim: ACTION_STATES.GUARD }, { anim: ACTION_STATES.WAIT });
mech.processFrame(mPrev, null);

// P0 exits shield with aerial (e.g. Nair 0x41)
let mCurr = createFrame(11, { anim: 0x41 }, { anim: ACTION_STATES.WAIT });
mech.processFrame(mCurr, mPrev);
mPrev = mCurr;

let mechResults = mech.fetch();
let p0Mech = mechResults.find(p => p.playerIndex === 0);
assert.strictEqual(p0Mech.oosAerials, 1, 'MechanicsDetector should detect OOS aerial state 0x41');
console.log('✔ MechanicsDetector OOS aerial alignment verified.');

console.log('=== ALL MILESTONE 1 CHECKS PASSED SUCCESSFULLY ===');
