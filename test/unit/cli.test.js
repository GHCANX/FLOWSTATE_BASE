import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveStageId } from '../../src/cli.js';

describe('CLI utility: resolveStageId', () => {
  it('returns null for falsy inputs', () => {
    assert.strictEqual(resolveStageId(null), null);
    assert.strictEqual(resolveStageId(undefined), null);
    assert.strictEqual(resolveStageId(''), null);
  });

  it('resolves the "legal" preset to standard competitive stages', () => {
    assert.strictEqual(resolveStageId('legal'), '31,32,28,8,2,3');
  });

  it('resolves standard stages by name and abbreviation', () => {
    assert.strictEqual(resolveStageId('battlefield'), '31');
    assert.strictEqual(resolveStageId('bf'), '31');

    assert.strictEqual(resolveStageId('finaldestination'), '32');
    assert.strictEqual(resolveStageId('fd'), '32');

    assert.strictEqual(resolveStageId('dreamland'), '28');
    assert.strictEqual(resolveStageId('dl'), '28');

    assert.strictEqual(resolveStageId('yoshisstory'), '8');
    assert.strictEqual(resolveStageId('ys'), '8');

    assert.strictEqual(resolveStageId('fountainofdreams'), '2');
    assert.strictEqual(resolveStageId('fod'), '2');

    assert.strictEqual(resolveStageId('pokemonstadium'), '3');
    assert.strictEqual(resolveStageId('ps'), '3');
  });

  it('handles case-insensitivity and surrounding whitespace', () => {
    assert.strictEqual(resolveStageId('  BATTLEFIELD  '), '31');
    assert.strictEqual(resolveStageId('bF'), '31');
    assert.strictEqual(resolveStageId('  LeGaL '), '31,32,28,8,2,3');
  });

  it('returns the original string if it is not a known preset or stage', () => {
    assert.strictEqual(resolveStageId('mutescity'), 'mutescity');
    assert.strictEqual(resolveStageId('15'), '15');
  });
});
