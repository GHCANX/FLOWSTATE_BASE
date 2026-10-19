import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_STATES,
  isDamage,
  isShield,
  isAerialLanding,
  isLedge,
  isStandardLedgeOption,
  isCliffOption,
  isTech,
  isDownWait,
  isWakeup,
  isAttack,
  isShine
} from '../../src/constants/actionStates.js';
import {
  CHARACTER_NAMES,
  getCharacterName,
  resolveCharacterId
} from '../../src/constants/characters.js';
import {
  STAGE_GEOMETRY,
  getStageGeometry,
  getStageName
} from '../../src/constants/stageGeometry.js';
import {
  RECOVERY_RANGES,
  DEFAULT_RECOVERY_RANGE,
  getRecoveryRange
} from '../../src/constants/recoveryData.js';

describe('Constants: actionStates', () => {
  it('identifies damage and tumble states correctly', () => {
    assert.strictEqual(isDamage(ACTION_STATES.DAMAGE_START), true);
    assert.strictEqual(isDamage(ACTION_STATES.DAMAGE_END), true);
    assert.strictEqual(isDamage(ACTION_STATES.DAMAGE_FALL), true);
    assert.strictEqual(isDamage(ACTION_STATES.WAIT), false);
    assert.strictEqual(isDamage(null), false);
    assert.strictEqual(isDamage(undefined), false);
  });

  it('identifies shield states correctly', () => {
    assert.strictEqual(isShield(ACTION_STATES.GUARD_ON), true);
    assert.strictEqual(isShield(ACTION_STATES.GUARD), true);
    assert.strictEqual(isShield(ACTION_STATES.GUARD_OFF), true);
    assert.strictEqual(isShield(ACTION_STATES.GUARD_REFLECT), true);
    assert.strictEqual(isShield(ACTION_STATES.WAIT), false);
  });

  it('identifies aerial landing lag states', () => {
    assert.strictEqual(isAerialLanding(ACTION_STATES.AERIAL_LANDING_START), true);
    assert.strictEqual(isAerialLanding(ACTION_STATES.AERIAL_LANDING_END), true);
    assert.strictEqual(isAerialLanding(ACTION_STATES.LANDING_FALL_SPECIAL), false);
  });

  it('identifies ledge states and standard options', () => {
    assert.strictEqual(isLedge(ACTION_STATES.CLIFF_CATCH), true);
    assert.strictEqual(isLedge(ACTION_STATES.CLIFF_WAIT), true);
    assert.strictEqual(isLedge(ACTION_STATES.CLIFF_CLIMB_SLOW), true);
    assert.strictEqual(isLedge(ACTION_STATES.CLIFF_JUMP_QUICK), true);
    assert.strictEqual(isLedge(ACTION_STATES.WAIT), false);

    assert.strictEqual(isStandardLedgeOption(ACTION_STATES.CLIFF_WAIT), false);
    assert.strictEqual(isStandardLedgeOption(ACTION_STATES.CLIFF_CLIMB_SLOW), true);
    assert.strictEqual(isStandardLedgeOption(ACTION_STATES.CLIFF_ESCAPE_QUICK), true);
    assert.strictEqual(isStandardLedgeOption(ACTION_STATES.CLIFF_ATTACK_SLOW), true);
    assert.strictEqual(isStandardLedgeOption(ACTION_STATES.CLIFF_JUMP_QUICK), true);
    assert.strictEqual(isCliffOption(ACTION_STATES.CLIFF_CLIMB_QUICK), true);
  });

  it('identifies tech states', () => {
    assert.strictEqual(isTech(ACTION_STATES.TECH_NEUTRAL), true);
    assert.strictEqual(isTech(ACTION_STATES.TECH_F), true);
    assert.strictEqual(isTech(ACTION_STATES.TECH_B), true);
    assert.strictEqual(isTech(ACTION_STATES.WALL_TECH), true);
    assert.strictEqual(isTech(ACTION_STATES.WALL_TECH_JUMP), true);
    assert.strictEqual(isTech(ACTION_STATES.TECH_MISS_UP), false);
  });

  it('identifies down wait and wakeup states', () => {
    assert.strictEqual(isDownWait(ACTION_STATES.DOWN_WAIT_U), true);
    assert.strictEqual(isDownWait(ACTION_STATES.DOWN_WAIT_D), true);
    assert.strictEqual(isDownWait(ACTION_STATES.WAIT), false);

    assert.strictEqual(isWakeup(ACTION_STATES.DOWN_STAND_U), true);
    assert.strictEqual(isWakeup(ACTION_STATES.DOWN_FORWARD_U), true);
    assert.strictEqual(isWakeup(ACTION_STATES.DOWN_BACK_U), true);
    assert.strictEqual(isWakeup(ACTION_STATES.DOWN_ATTACK_U), true);
    assert.strictEqual(isWakeup(ACTION_STATES.DOWN_STAND_D), true);
    assert.strictEqual(isWakeup(ACTION_STATES.DOWN_ATTACK_D), true);
    assert.strictEqual(isWakeup(ACTION_STATES.DOWN_WAIT_U), false);
  });

  it('identifies attacks and spacie shines', () => {
    assert.strictEqual(isAttack(0x2C), true); // AttackStart
    assert.strictEqual(isAttack(0x45), true); // AttackEnd
    assert.strictEqual(isAttack(341), true);  // Special moves
    assert.strictEqual(isAttack(ACTION_STATES.WAIT), false);

    assert.strictEqual(isShine(ACTION_STATES.SHINE_START), true);
    assert.strictEqual(isShine(ACTION_STATES.SHINE_END), true);
    assert.strictEqual(isShine(359), false);
    assert.strictEqual(isShine(369), false);
  });
});

describe('Constants: characters', () => {
  it('resolves character names correctly', () => {
    assert.strictEqual(getCharacterName(2), 'Fox');
    assert.strictEqual(getCharacterName(20), 'Falco');
    assert.strictEqual(getCharacterName(9), 'Marth');
    assert.strictEqual(getCharacterName(999), 'Unknown (999)');
  });

  it('resolves character ID from various inputs', () => {
    // Numeric input
    assert.strictEqual(resolveCharacterId(2), 2);
    assert.strictEqual(resolveCharacterId('2'), 2);

    // Exact names
    assert.strictEqual(resolveCharacterId('fox'), 2);
    assert.strictEqual(resolveCharacterId('Fox'), 2);
    assert.strictEqual(resolveCharacterId('Captain Falcon'), 0);

    // Aliases
    assert.strictEqual(resolveCharacterId('cf'), 0);
    assert.strictEqual(resolveCharacterId('falcon'), 0);
    assert.strictEqual(resolveCharacterId('gw'), 3);
    assert.strictEqual(resolveCharacterId('gnw'), 3);
    assert.strictEqual(resolveCharacterId('pika'), 13);
    assert.strictEqual(resolveCharacterId('puff'), 15);
    assert.strictEqual(resolveCharacterId('jiggs'), 15);
    assert.strictEqual(resolveCharacterId('doc'), 22);
    assert.strictEqual(resolveCharacterId('drmario'), 22);

    // Unknown inputs
    assert.strictEqual(resolveCharacterId('unknown_character'), null);
    assert.strictEqual(resolveCharacterId(''), null);
  });
});

describe('Constants: stageGeometry', () => {
  it('provides geometry for standard tournament stages', () => {
    const bf = getStageGeometry(31);
    assert.ok(bf);
    assert.strictEqual(bf.name, 'Battlefield');
    assert.strictEqual(bf.ground.xMin, -68.4);
    assert.strictEqual(bf.ground.xMax, 68.4);
    assert.ok(bf.blastzone);

    const fd = getStageGeometry(32);
    assert.strictEqual(fd.name, 'Final Destination');

    const stadium = getStageGeometry(3);
    assert.strictEqual(stadium.name, 'Pokémon Stadium');

    const yoshis = getStageGeometry(8);
    assert.strictEqual(yoshis.name, "Yoshi's Story");

    const dreamland = getStageGeometry(28);
    assert.strictEqual(dreamland.name, 'Dream Land N64');

    const fountain = getStageGeometry(2);
    assert.strictEqual(fountain.name, 'Fountain of Dreams');
  });

  it('handles unknown stages gracefully', () => {
    assert.strictEqual(getStageGeometry(999), null);
    assert.strictEqual(getStageName(31), 'Battlefield');
    assert.strictEqual(getStageName(999), 'Stage 999');
  });
});

describe('Constants: recoveryData', () => {
  it('returns recovery range for characters and defaults', () => {
    assert.strictEqual(getRecoveryRange(2), 95);  // Fox
    assert.strictEqual(getRecoveryRange(20), 95); // Falco
    assert.strictEqual(getRecoveryRange(11), 110); // Ness
    assert.strictEqual(getRecoveryRange(14), 75);  // Ice Climbers
    assert.strictEqual(getRecoveryRange(999), DEFAULT_RECOVERY_RANGE);
    assert.strictEqual(DEFAULT_RECOVERY_RANGE, 95);
  });
});
