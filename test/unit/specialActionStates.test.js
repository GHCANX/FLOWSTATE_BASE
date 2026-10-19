import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHARACTER_SPECIAL_ACTION_STATES,
  getSpecialMoveIdent,
  isCharacterSpecial,
  isRecoverySpecial,
  isProjectileSpecial,
  isReflectorSpecial,
} from '../../src/constants/specialActionStates.js';
import { isShine, isAttack } from '../../src/constants/actionStates.js';

describe('Constants: specialActionStates (Full 26-Character Roster)', () => {
  it('contains mapping for all 26 Melee characters (IDs 0-25)', () => {
    for (let id = 0; id <= 25; id++) {
      const entry = CHARACTER_SPECIAL_ACTION_STATES[id];
      assert.ok(entry, `Character ID ${id} should exist in mapping`);
      assert.strictEqual(entry.characterId, id);
      assert.ok(entry.name, `Character ID ${id} should have a name`);
      assert.ok(entry.slug, `Character ID ${id} should have a slug`);
      assert.ok(entry.states, `Character ID ${id} should have states dictionary`);
      assert.ok(Object.keys(entry.states).length > 0, `Character ID ${id} should have >0 special states`);
    }
  });

  it('correctly resolves Fox and Falco special action states', () => {
    // Fox (ID: 2)
    assert.strictEqual(getSpecialMoveIdent(2, 341), 'BLASTER_GROUND_STARTUP');
    assert.strictEqual(getSpecialMoveIdent(2, 353), 'FIRE_FOX_GROUND_STARTUP');
    assert.strictEqual(getSpecialMoveIdent(2, 360), 'REFLECTOR_GROUND_STARTUP');
    assert.strictEqual(isCharacterSpecial(2, 360), true);

    // Falco (ID: 20)
    assert.strictEqual(getSpecialMoveIdent(20, 341), 'BLASTER_GROUND_STARTUP');
    assert.strictEqual(getSpecialMoveIdent(20, 353), 'FIRE_BIRD_GROUND_STARTUP');
    assert.strictEqual(getSpecialMoveIdent(20, 360), 'REFLECTOR_GROUND_STARTUP');
    assert.strictEqual(isCharacterSpecial(20, 360), true);
  });

  it('correctly resolves Marth and Captain Falcon special action states', () => {
    // Marth (ID: 9)
    assert.strictEqual(getSpecialMoveIdent(9, 367), 'DOLPHIN_SLASH_GROUND');
    assert.strictEqual(getSpecialMoveIdent(9, 349), 'DANCING_BLADE_1_GROUND');
    assert.strictEqual(getSpecialMoveIdent(9, 369), 'COUNTER_GROUND');

    // Captain Falcon (ID: 0)
    assert.strictEqual(getSpecialMoveIdent(0, 347), 'FALCON_PUNCH_GROUND');
    assert.strictEqual(getSpecialMoveIdent(0, 349), 'RAPTOR_BOOST_GROUND');
    assert.strictEqual(getSpecialMoveIdent(0, 353), 'FALCON_DIVE_GROUND');
    assert.strictEqual(getSpecialMoveIdent(0, 357), 'FALCON_KICK_GROUND');
  });

  it('correctly resolves Peach and Sheik unique and special action states', () => {
    // Peach (ID: 12)
    assert.strictEqual(getSpecialMoveIdent(12, 341), 'FLOAT');
    assert.strictEqual(getSpecialMoveIdent(12, 349), 'SIDE_SMASH_GOLF_CLUB');
    assert.strictEqual(getSpecialMoveIdent(12, 352), 'VEGETABLE_GROUND');
    assert.strictEqual(getSpecialMoveIdent(12, 361), 'PARASOL_GROUND_START');

    // Sheik (ID: 19)
    assert.strictEqual(getSpecialMoveIdent(19, 341), 'NEEDLE_STORM_GROUND_START_CHARGE');
    assert.strictEqual(getSpecialMoveIdent(19, 355), 'VANISH_GROUND_STARTUP');
    assert.strictEqual(getSpecialMoveIdent(19, 361), 'TRANSFORM_GROUND');
  });

  it('identifies recovery special moves accurately', () => {
    assert.strictEqual(isRecoverySpecial(2, 353), true);  // Fox Fire Fox
    assert.strictEqual(isRecoverySpecial(20, 353), true); // Falco Fire Bird
    assert.strictEqual(isRecoverySpecial(9, 367), true);  // Marth Dolphin Slash
    assert.strictEqual(isRecoverySpecial(0, 353), true);  // Falcon Falcon Dive
    assert.strictEqual(isRecoverySpecial(19, 355), true); // Sheik Vanish
    assert.strictEqual(isRecoverySpecial(12, 361), true); // Peach Parasol
    assert.strictEqual(isRecoverySpecial(2, 341), false); // Fox Blaster is not recovery
  });

  it('identifies projectile special moves accurately', () => {
    assert.strictEqual(isProjectileSpecial(2, 341), true);  // Fox Blaster
    assert.strictEqual(isProjectileSpecial(20, 341), true); // Falco Blaster
    assert.strictEqual(isProjectileSpecial(19, 341), true); // Sheik Needle
    assert.strictEqual(isProjectileSpecial(12, 352), true); // Peach Turnip
    assert.strictEqual(isProjectileSpecial(9, 367), false); // Marth Dolphin Slash is not projectile
  });

  it('identifies reflector and absorption special moves accurately', () => {
    assert.strictEqual(isReflectorSpecial(2, 360), true);  // Fox Reflector
    assert.strictEqual(isReflectorSpecial(20, 360), true); // Falco Reflector
    assert.strictEqual(isReflectorSpecial(8, 345), true);  // Mario Cape
    assert.strictEqual(isReflectorSpecial(9, 367), false); // Marth Dolphin Slash is not reflector
  });

  it('enforces character-specific shine detection in isShine', () => {
    assert.strictEqual(isShine(360, 2), true);   // Fox Shine -> true
    assert.strictEqual(isShine(360, 20), true);  // Falco Shine -> true
    assert.strictEqual(isShine(360, 9), false);  // Marth state 360 (Dancing Blade 2 Side Air) is not a shine!
    assert.strictEqual(isShine(360, 0), false);  // Falcon state 360 (Falcon Kick Air Landing) is not a shine!
  });

  it('handles out of bounds and non-existent queries safely', () => {
    assert.strictEqual(isCharacterSpecial(2, 14), false); // 14 is WAIT
    assert.strictEqual(getSpecialMoveIdent(2, 9999), null);
    assert.strictEqual(getSpecialMoveIdent(999, 341), null);
    assert.strictEqual(isRecoverySpecial(999, 341), false);
    assert.strictEqual(isProjectileSpecial(999, 341), false);
    assert.strictEqual(isReflectorSpecial(999, 341), false);
  });
});
