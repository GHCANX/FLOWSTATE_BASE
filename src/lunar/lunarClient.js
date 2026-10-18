import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { RateLimiter } from './rateLimiter.js';

export class LunarClient {
  /**
   * @param {Object} [options]
   * @param {string} [options.baseUrl]
   * @param {string} [options.clientId]
   * @param {string} [options.userAgent]
   * @param {number} [options.maxDownloadsPerMinute]
   */
  constructor({
    baseUrl = 'https://api.lunarmelee.com',
    clientId = null,
    userAgent = 'flowstate-analyzer/1.0 (+https://github.com/flowstate)',
    maxDownloadsPerMinute = 25,
  } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.clientId = clientId || crypto.randomUUID();
    this.userAgent = userAgent;
    this.rateLimiter = new RateLimiter(maxDownloadsPerMinute);
  }

  /**
   * Fetch with rate limit acquisition and automatic 429/503 exponential backoff
   * @private
   */
  async _request(url, options = {}, retries = 4) {
    await this.rateLimiter.acquire();

    const headers = {
      'User-Agent': this.userAgent,
      'X-Client-Id': this.clientId,
      ...(options.headers || {})
    };

    try {
      const res = await fetch(url, { ...options, headers });

      if (res.status === 429 || res.status === 503) {
        if (retries > 0) {
          const retryAfter = parseInt(res.headers.get('retry-after') || '15', 10);
          const backoff = Math.max(retryAfter, 10) * 1000;
          console.warn(`[LunarClient] Status ${res.status}. Backing off for ${backoff / 1000}s...`);
          await new Promise(r => setTimeout(r, backoff));
          return this._request(url, options, retries - 1);
        }
      }

      return res;
    } catch (err) {
      if (retries > 0) {
        console.warn(`[LunarClient] Network error: ${err.message}. Retrying in 5s...`);
        await new Promise(r => setTimeout(r, 5000));
        return this._request(url, options, retries - 1);
      }
      throw err;
    }
  }

  /**
   * Search replays in Lunar database with filters and forward pagination.
   * @param {Object} params
   * @param {string} [params.startDate] YYYY-MM-DD or ISO timestamp
   * @param {string} [params.endDate] YYYY-MM-DD or ISO timestamp
   * @param {string} [params.sort] Default: 'startAt:1' (oldest first for stable walk)
   * @param {number} [params.page] Page number (from 1)
   * @param {number} [params.limit] Max 1000 per page
   * @param {string} [params.source] 'tournament', 'netplay', 'ranked'
   * @param {boolean} [params.includeCpu] Default false
   * @returns {Promise<{ replays: Array, pagination: Object }>}
   */
  async searchReplays(params = {}) {
    const q = new URLSearchParams();
    if (params.startDate) q.append('startDate', params.startDate);
    if (params.endDate) q.append('endDate', params.endDate);
    q.append('sort', params.sort || 'startAt:1');
    q.append('page', String(params.page || 1));
    q.append('limit', String(params.limit || 100));
    if (params.source) q.append('source', params.source);
    if (params.includeCpu) q.append('includeCpu', 'true');
    if (params.stageId) q.append('stageId', String(params.stageId));

    const url = `${this.baseUrl}/api/replays?${q.toString()}`;
    const res = await this._request(url);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Search failed (${res.status}): ${body}`);
    }

    return await res.json();
  }

  /**
   * Fetch extracted stats for a single replay from Lunar Melee
   * @param {string} replayId 
   */
  async getReplayStats(replayId) {
    const url = `${this.baseUrl}/api/replays/${replayId}/stats`;
    const res = await this._request(url);
    if (!res.ok) {
      throw new Error(`Failed to get stats for ${replayId}: ${res.statusText}`);
    }
    return await res.json();
  }

  /**
   * Download a single .slp file to disk. Automatically follows redirects.
   * @param {string} replayId 24-char hex replay ID
   * @param {string} destinationFilePath Path to save the downloaded .slp
   * @returns {Promise<string>} Path of downloaded file
   */
  async downloadReplay(replayId, destinationFilePath) {
    const dir = path.dirname(destinationFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const url = `${this.baseUrl}/api/replays/${replayId}/download`;
    const res = await this._request(url);
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Download failed for ${replayId} (${res.status}): ${errText}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(destinationFilePath, buffer);
    return destinationFilePath;
  }
}
