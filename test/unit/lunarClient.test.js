import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LunarClient } from '../../src/lunar/lunarClient.js';

const TEST_DIR = path.resolve('./test_lunar_unit');

describe('LunarClient', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('constructs correct search URL and headers', async () => {
    let capturedUrl = null;
    let capturedHeaders = null;

    globalThis.fetch = async (url, options) => {
      capturedUrl = url;
      capturedHeaders = options.headers;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          replays: [{ _id: 'replay1', startAt: '2022-01-01' }],
          pagination: { page: 1, total: 1 },
        }),
      };
    };

    const client = new LunarClient({
      baseUrl: 'https://mock.lunarmelee.com',
      clientId: 'test-client-123',
      userAgent: 'test-agent/1.0',
      maxDownloadsPerMinute: 1000,
    });

    const res = await client.searchReplays({
      startDate: '2022-01-01',
      endDate: '2022-02-01',
      sort: 'startAt:1',
      page: 2,
      limit: 50,
      source: 'ranked',
      includeCpu: true,
      stageId: 31,
      p1ConnectCode: 'MANG#0',
      p2ConnectCode: 'ZAIN#0',
      p1CharacterId: 2,
      p2CharacterId: 9,
    });

    assert.ok(capturedUrl.includes('https://mock.lunarmelee.com/api/replays'));
    assert.ok(capturedUrl.includes('startDate=2022-01-01'));
    assert.ok(capturedUrl.includes('endDate=2022-02-01'));
    assert.ok(capturedUrl.includes('page=2'));
    assert.ok(capturedUrl.includes('limit=50'));
    assert.ok(capturedUrl.includes('source=ranked'));
    assert.ok(capturedUrl.includes('includeCpu=true'));
    assert.ok(capturedUrl.includes('stageId=31'));
    assert.ok(capturedUrl.includes('p1ConnectCode=MANG%230'));
    assert.ok(capturedUrl.includes('p2ConnectCode=ZAIN%230'));
    assert.ok(capturedUrl.includes('p1CharacterId=2'));
    assert.ok(capturedUrl.includes('p2CharacterId=9'));

    assert.strictEqual(capturedHeaders['X-Client-Id'], 'test-client-123');
    assert.strictEqual(capturedHeaders['User-Agent'], 'test-agent/1.0');

    assert.strictEqual(res.replays.length, 1);
  });

  it('handles search failure with error message', async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 400,
      text: async () => 'Invalid date filter',
    });

    const client = new LunarClient({ maxDownloadsPerMinute: 1000 });
    await assert.rejects(
      () => client.searchReplays({ startDate: 'bad' }),
      /Search failed \(400\): Invalid date filter/
    );
  });

  it('fetches replay stats', async () => {
    globalThis.fetch = async (url) => {
      assert.ok(url.endsWith('/api/replays/abc12345/stats'));
      return {
        ok: true,
        status: 200,
        json: async () => ({ stats: { lastFrame: 5000 } }),
      };
    };

    const client = new LunarClient({ maxDownloadsPerMinute: 1000 });
    const stats = await client.getReplayStats('abc12345');
    assert.strictEqual(stats.stats.lastFrame, 5000);
  });

  it('downloads replay bytes and writes to disk', async () => {
    const rawString = 'UBJSON_SLP_HEADER_MOCK';
    const textBytes = new TextEncoder().encode(rawString);
    globalThis.fetch = async (url) => {
      assert.ok(url.endsWith('/api/replays/rep_001/download'));
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => textBytes.buffer.slice(textBytes.byteOffset, textBytes.byteOffset + textBytes.byteLength),
      };
    };

    const client = new LunarClient({ maxDownloadsPerMinute: 1000 });
    const dest = path.join(TEST_DIR, 'rep_001.slp');
    const returnedPath = await client.downloadReplay('rep_001', dest);

    assert.strictEqual(returnedPath, dest);
    assert.ok(fs.existsSync(dest));
    const content = fs.readFileSync(dest, 'utf8');
    assert.strictEqual(content, rawString);
  });

  it('handles download error when HTTP status is not ok', async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 404,
      text: async () => 'Replay not found',
    });

    const client = new LunarClient({ maxDownloadsPerMinute: 1000 });
    const dest = path.join(TEST_DIR, 'rep_404.slp');
    await assert.rejects(
      () => client.downloadReplay('rep_404', dest),
      /Download failed for rep_404 \(404\): Replay not found/
    );
  });
});
