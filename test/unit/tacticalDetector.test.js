import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TacticalDetector } from '../../src/analysis/tacticalDetector.js';
import { ACTION_STATES } from '../../src/constants/actionStates.js';

describe('TacticalDetector', () => {
  const dummySettings = {
    stageId: 31, // Battlefield
    players: [
      { playerIndex: 0, port: 1, startStocks: 4 },
      { playerIndex: 1, port: 2, startStocks: 4 },
    ],
  };

  function createFrame(frameNum, p0Overrides = {}, p1Overrides = {}) {
    return {
      frame: frameNum,
      players: {
        0: {
          pre: { facingDirection: 1, joystickX: 0, joystickY: 0, trigger: 0, buttons: 0 },
          post: {
            characterId: 2,
            actionStateId: p0Overrides.anim ?? ACTION_STATES.WAIT,
            positionX: p0Overrides.x ?? 0.0,
            positionY: p0Overrides.y ?? 0.0,
            percent: p0Overrides.percent ?? 0,
            stocksRemaining: p0Overrides.stocksRemaining ?? 4,
            hitlagRemaining: p0Overrides.hitlagRemaining ?? 0,
            lastAttackLanded: p0Overrides.lastAttackLanded ?? 0,
            lastHitBy: p0Overrides.lastHitBy ?? null,
            ...p0Overrides,
          },
        },
        1: {
          pre: { facingDirection: -1, joystickX: 0, joystickY: 0, trigger: 0, buttons: 0 },
          post: {
            characterId: 20,
            actionStateId: p1Overrides.anim ?? ACTION_STATES.WAIT,
            positionX: p1Overrides.x ?? 10.0,
            positionY: p1Overrides.y ?? 0.0,
            percent: p1Overrides.percent ?? 0,
            stocksRemaining: p1Overrides.stocksRemaining ?? 4,
            hitlagRemaining: p1Overrides.hitlagRemaining ?? 0,
            lastAttackLanded: p1Overrides.lastAttackLanded ?? 0,
            lastHitBy: p1Overrides.lastHitBy ?? null,
            ...p1Overrides,
          },
        },
      },
    };
  }

  it('initializes stock tracking and tracks stock loss', () => {
    const detector = new TacticalDetector(dummySettings);

    // Frame 1: P0 has 4 stocks
    const f1 = createFrame(1, { stocksRemaining: 4 }, { stocksRemaining: 4 });
    detector.processFrame(f1, null);

    // Frame 100: P0 drops to 3 stocks
    const f2 = createFrame(100, { stocksRemaining: 3, percent: 85 }, { stocksRemaining: 4 });
    detector.processFrame(f2, f1);

    const metrics = detector.fetch();
    assert.strictEqual(metrics.stocks.length, 1);
    assert.strictEqual(metrics.stocks[0].playerIndex, 0);
    assert.strictEqual(metrics.stocks[0].endFrame, 100);
  });

  it('tracks conversions when an attack connects', () => {
    const detector = new TacticalDetector(dummySettings);

    // Frame 0: Baseline (both at 0%)
    const f0 = createFrame(0, { percent: 0 }, { percent: 0 });
    detector.processFrame(f0, null);

    // Frame 1: P0 lands hit on P1 (percent 0 -> 14, damageTaken = 14)
    const f1 = createFrame(1, { lastAttackLanded: 1 }, { anim: ACTION_STATES.DAMAGE_START, percent: 14, lastHitBy: 0 });
    detector.processFrame(f1, f0);

    // Frames 2 to 50: P1 recovers and resetTimer exceeds 45 frames
    let prev = f1;
    for (let f = 2; f <= 50; f++) {
      const cur = createFrame(f, {}, { anim: ACTION_STATES.WAIT, percent: 14 });
      detector.processFrame(cur, prev);
      prev = cur;
    }

    const metrics = detector.fetch();
    assert.ok(metrics.conversions.length >= 1);
    assert.strictEqual(metrics.conversions[0].attackerIndex, 0);
    assert.strictEqual(metrics.conversions[0].victimIndex, 1);
    assert.strictEqual(metrics.conversions[0].damageDealt, 14);
  });

  it('records ledge climb and 30-frame punish tracking', () => {
    const detector = new TacticalDetector(dummySettings);

    // P0 catches cliff
    const f1 = createFrame(1, { anim: ACTION_STATES.CLIFF_CATCH });
    detector.processFrame(f1, null);

    // P0 executes slow ledge climb
    const f2 = createFrame(10, { anim: ACTION_STATES.CLIFF_CLIMB_SLOW });
    detector.processFrame(f2, f1);

    // P0 takes hitstun at frame 25 (within 30 frames of ledge option)
    const f3 = createFrame(25, { anim: ACTION_STATES.DAMAGE_START, percent: 10, lastHitBy: 1 });
    detector.processFrame(f3, f2);

    const stats = detector.getHabitStats(0);
    assert.strictEqual(stats.climb_count, 1);
    assert.strictEqual(stats.climb_punished, 1);
  });

  it('enforces 35-frame ledgedash heuristic', () => {
    const detector = new TacticalDetector(dummySettings);

    // P0 on ledge at frame 10
    const f1 = createFrame(10, { anim: ACTION_STATES.CLIFF_WAIT, x: -70.0, y: -10.0 });
    detector.processFrame(f1, null);

    // Drops from cliff (FALL) at frame 15
    const f2 = createFrame(15, { anim: ACTION_STATES.FALL, x: -70.0, y: -10.0, isAirborne: true });
    detector.processFrame(f2, f1);

    // Air dodge toward stage at frame 20
    const f3 = createFrame(20, { anim: ACTION_STATES.AIR_DODGE, x: -68.0, y: -5.0, isAirborne: true });
    detector.processFrame(f3, f2);

    // Lands on stage within Battlefield boundaries (|X| <= 68.4) at frame 40 (elapsed 30f <= 35f)
    const f4 = createFrame(40, { anim: ACTION_STATES.LANDING_FALL_SPECIAL, x: -65.0, y: 0.0, isAirborne: false });
    detector.processFrame(f4, f3);

    const stats = detector.getHabitStats(0);
    assert.strictEqual(stats.ledgedash_count, 1);
  });

  it('distinguishes scramble grab from neutral grab based on distance threshold 18.0', () => {
    const detector = new TacticalDetector(dummySettings);

    // Setup: advance 35 clean frames so history has no recent hitstun
    for (let f = 1; f <= 35; f++) {
      detector.processFrame(createFrame(f, { x: 0 }, { x: 15.0 }), null);
    }

    // P0 grabs P1 at distance 15.0 (<= 18.0) -> Scramble grab
    const f36 = createFrame(36, { anim: ACTION_STATES.GRAB, x: 0 }, { x: 15.0 });
    detector.processFrame(f36, null);

    const stats0 = detector.getHabitStats(0);
    assert.strictEqual(stats0.grabs_scramble, 1);
    assert.strictEqual(stats0.grabs_neutral, 0);

    // Setup another grab at distance 25.0 (> 18.0)
    for (let f = 37; f <= 75; f++) {
      detector.processFrame(createFrame(f, { anim: ACTION_STATES.WAIT, x: 0 }, { x: 25.0 }), null);
    }

    const f76 = createFrame(76, { anim: ACTION_STATES.GRAB, x: 0 }, { x: 25.0 });
    detector.processFrame(f76, null);

    const statsAfter = detector.getHabitStats(0);
    assert.strictEqual(statsAfter.grabs_neutral, 1);
  });

  it('returns comprehensive habit payload', () => {
    const detector = new TacticalDetector(dummySettings);
    const payload = detector.getHabitPayload();
    assert.ok(payload);
    assert.ok(Array.isArray(payload.getupEvents));
    assert.ok(Array.isArray(payload.grabTriggers));
    assert.ok(Array.isArray(payload.transitionDecisions));
    assert.ok(Array.isArray(payload.escapeSequences));
  });
});
