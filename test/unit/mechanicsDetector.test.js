import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MechanicsDetector } from '../../src/analysis/mechanicsDetector.js';
import { ACTION_STATES } from '../../src/constants/actionStates.js';

describe('MechanicsDetector', () => {
  const dummySettings = {
    players: [
      { playerIndex: 0, port: 1 },
      { playerIndex: 1, port: 2 },
    ],
  };

  function createFrame(frameNum, p0Overrides = {}, p1Overrides = {}) {
    return {
      frame: frameNum,
      players: {
        0: {
          pre: { physicalButtons: 0, physicalLTrigger: 0, physicalRTrigger: 0 },
          post: {
            actionStateId: p0Overrides.anim ?? ACTION_STATES.WAIT,
            positionX: p0Overrides.x ?? 0.0,
            positionY: p0Overrides.y ?? 0.0,
            hitlagRemaining: p0Overrides.hitlagRemaining ?? 0,
            lCancelStatus: p0Overrides.lCancelStatus ?? 0,
            isAirborne: p0Overrides.isAirborne ?? false,
            ...p0Overrides,
          },
        },
        1: {
          pre: { physicalButtons: 0, physicalLTrigger: 0, physicalRTrigger: 0 },
          post: {
            actionStateId: p1Overrides.anim ?? ACTION_STATES.WAIT,
            positionX: p1Overrides.x ?? 10.0,
            positionY: p1Overrides.y ?? 0.0,
            hitlagRemaining: p1Overrides.hitlagRemaining ?? 0,
            lCancelStatus: p1Overrides.lCancelStatus ?? 0,
            isAirborne: p1Overrides.isAirborne ?? false,
            ...p1Overrides,
          },
        },
      },
    };
  }

  it('initializes default metrics for all players', () => {
    const detector = new MechanicsDetector(dummySettings);
    const metrics = detector.fetch();
    assert.strictEqual(metrics.length, 2);
    assert.strictEqual(metrics[0].playerIndex, 0);
    assert.strictEqual(metrics[1].playerIndex, 1);
    assert.strictEqual(metrics[0].lCancelRate, 0);
    assert.strictEqual(metrics[0].wavedashCount, 0);
  });

  it('detects L-cancel success and fail, calculating accurate rate', () => {
    const detector = new MechanicsDetector(dummySettings);

    // Frame 1: L-cancel success for P0
    const f1 = createFrame(1, { anim: ACTION_STATES.AERIAL_LANDING_START, lCancelStatus: 1 });
    detector.processFrame(f1, null);

    // Frame 2: L-cancel fail for P0
    const f2 = createFrame(2, { anim: ACTION_STATES.AERIAL_LANDING_START + 1, lCancelStatus: 2 });
    detector.processFrame(f2, f1);

    // Frame 3: Another L-cancel success for P0
    const f3 = createFrame(3, { anim: ACTION_STATES.AERIAL_LANDING_START, lCancelStatus: 1 });
    detector.processFrame(f3, f2);

    const metrics = detector.fetch();
    assert.strictEqual(metrics[0].lCancelSuccess, 2);
    assert.strictEqual(metrics[0].lCancelFail, 1);
    // 2 / 3 * 100 = 66.666...%
    assert.ok(Math.abs(metrics[0].lCancelRate - 66.67) < 0.1);
  });

  it('detects wavedash from jumpsquat into airdodge into landing fall special', () => {
    const detector = new MechanicsDetector(dummySettings);

    const f1 = createFrame(1, { anim: ACTION_STATES.KNEE_BEND });
    detector.processFrame(f1, null);

    const f2 = createFrame(2, { anim: ACTION_STATES.AIR_DODGE });
    detector.processFrame(f2, f1);

    const f3 = createFrame(3, { anim: ACTION_STATES.LANDING_FALL_SPECIAL });
    detector.processFrame(f3, f2);

    const metrics = detector.fetch();
    assert.strictEqual(metrics[0].wavedashCount, 1);
    assert.strictEqual(metrics[0].wavelandCount, 0);
  });

  it('detects dash dance turns and strings', () => {
    const detector = new MechanicsDetector(dummySettings);

    // Sequence: DASH -> TURN -> DASH (Turn 1) -> TURN -> DASH (Turn 2)
    const f1 = createFrame(1, { anim: ACTION_STATES.DASH });
    detector.processFrame(f1, null);

    const f2 = createFrame(2, { anim: ACTION_STATES.TURN });
    detector.processFrame(f2, f1);

    const f3 = createFrame(3, { anim: ACTION_STATES.DASH });
    detector.processFrame(f3, f2);

    const f4 = createFrame(4, { anim: ACTION_STATES.TURN });
    detector.processFrame(f4, f3);

    const f5 = createFrame(5, { anim: ACTION_STATES.DASH });
    detector.processFrame(f5, f4);

    const metrics = detector.fetch();
    assert.strictEqual(metrics[0].dashDanceTurns, 2);
  });

  it('detects out-of-shield choices', () => {
    const detector = new MechanicsDetector(dummySettings);

    // In shield
    const f1 = createFrame(1, { anim: ACTION_STATES.GUARD });
    detector.processFrame(f1, null);

    // OOS Roll
    const f2 = createFrame(2, { anim: ACTION_STATES.ROLL_F });
    detector.processFrame(f2, f1);

    const metrics = detector.fetch();
    assert.strictEqual(metrics[0].oosRolls, 1);
  });

  it('detects spacie multishining within 12 frames', () => {
    const detector = new MechanicsDetector(dummySettings);

    // First shine
    const f1 = createFrame(1, { anim: ACTION_STATES.SHINE_START });
    detector.processFrame(f1, null);

    // Jump / airborne
    const f2 = createFrame(4, { anim: ACTION_STATES.KNEE_BEND });
    detector.processFrame(f2, f1);

    // Second shine at frame 7 (within 12 frames of frame 1)
    const f3 = createFrame(7, { anim: ACTION_STATES.SHINE_START });
    detector.processFrame(f3, f2);

    const metrics = detector.fetch();
    assert.strictEqual(metrics[0].multishines, 1);
  });

  it('detects JC grab and boost grab transitions', () => {
    const detector = new MechanicsDetector(dummySettings);

    // JC Grab: KNEE_BEND -> GRAB
    const f1 = createFrame(1, { anim: ACTION_STATES.KNEE_BEND });
    detector.processFrame(f1, null);
    const f2 = createFrame(2, { anim: ACTION_STATES.GRAB });
    detector.processFrame(f2, f1);

    // Boost Grab: ATTACK_DASH -> DASH_GRAB
    const f3 = createFrame(3, { anim: ACTION_STATES.ATTACK_DASH });
    detector.processFrame(f3, f2);
    const f4 = createFrame(4, { anim: ACTION_STATES.DASH_GRAB });
    detector.processFrame(f4, f3);

    const metrics = detector.fetch();
    assert.strictEqual(metrics[0].jcGrabs, 1);
    assert.strictEqual(metrics[0].boostGrabs, 1);
  });

  it('detects Smash DI (SDI) position shifts during hitlag', () => {
    const detector = new MechanicsDetector(dummySettings);

    // Frame in hitlag at (0, 0)
    const f1 = createFrame(1, { hitlagRemaining: 5, x: 0, y: 0 });
    detector.processFrame(f1, null);

    // Frame in hitlag shifted to (1.0, 0) -> distance 1.0 > 0.7
    const f2 = createFrame(2, { hitlagRemaining: 4, x: 1.0, y: 0 });
    detector.processFrame(f2, f1);

    const metrics = detector.fetch();
    assert.strictEqual(metrics[0].sdiInputs, 1);
  });
});
