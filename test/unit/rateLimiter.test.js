import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter } from '../../src/lunar/rateLimiter.js';

describe('RateLimiter', () => {
  it('instantiates with default and custom limits', () => {
    const defaultLimiter = new RateLimiter();
    assert.strictEqual(defaultLimiter.maxRequestsPerMinute, 25);
    assert.deepStrictEqual(defaultLimiter.timestamps, []);

    const customLimiter = new RateLimiter(10);
    assert.strictEqual(customLimiter.maxRequestsPerMinute, 10);
  });

  it('acquires slot immediately when under limit', async () => {
    const limiter = new RateLimiter(5);
    const start = Date.now();
    await limiter.acquire();
    await limiter.acquire();
    const elapsed = Date.now() - start;

    assert.strictEqual(limiter.timestamps.length, 2);
    assert.ok(elapsed < 50, `Acquisition took unexpectedly long: ${elapsed}ms`);
  });

  it('prunes timestamps older than 60 seconds', async () => {
    const limiter = new RateLimiter(5);
    const now = Date.now();
    // Simulate timestamps from 2 minutes ago
    limiter.timestamps = [
      now - 120000,
      now - 90000,
      now - 30000, // 30s ago (within window)
    ];

    await limiter.acquire();
    // Two should have been pruned, one retained + one new
    assert.strictEqual(limiter.timestamps.length, 2);
  });

  it('delays acquisition when capacity is exhausted', async () => {
    const limiter = new RateLimiter(2);
    const now = Date.now();
    // Oldest is 59950ms ago (will expire in 50ms + 100ms jitter)
    limiter.timestamps = [
      now - 59950,
      now - 59950,
    ];

    const start = Date.now();
    await limiter.acquire();
    const elapsed = Date.now() - start;

    // Should have waited for the oldest slot to free up (around 150ms)
    assert.ok(elapsed >= 90, `Expected rate limiter to delay, but elapsed was ${elapsed}ms`);
    assert.ok(elapsed < 1000, `Delayed longer than expected: ${elapsed}ms`);
    assert.strictEqual(limiter.timestamps.length, 3);
  });
});
