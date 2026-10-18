/**
 * Sliding-window rate limiter ensuring compliance with Lunar Melee API thresholds.
 */
export class RateLimiter {
  /**
   * @param {number} maxRequestsPerMinute Default: 25 requests/minute (safety buffer under 30/min limit)
   */
  constructor(maxRequestsPerMinute = 25) {
    this.maxRequestsPerMinute = maxRequestsPerMinute;
    this.timestamps = [];
  }

  /**
   * Wait if needed until a request slot is available.
   */
  async acquire() {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Prune timestamps older than 1 minute
    this.timestamps = this.timestamps.filter(t => t > oneMinuteAgo);

    if (this.timestamps.length >= this.maxRequestsPerMinute) {
      // Oldest request in window
      const oldest = this.timestamps[0];
      const waitTime = oldest + 60000 - now + 100; // plus 100ms jitter buffer
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    this.timestamps.push(Date.now());
  }
}
