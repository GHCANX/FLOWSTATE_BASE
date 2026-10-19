import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from '../../src/server/server.js';
import { BroadcastService } from '../../src/broadcast/broadcastService.js';

describe('Server & API End-to-End (E2E)', () => {
  let server;
  let baseUrl;
  let broadcast;

  before(async () => {
    broadcast = new BroadcastService();
    server = createServer({ broadcastService: broadcast });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (broadcast) {
      await broadcast.stopSession();
    }
    await new Promise((resolve) => server.close(resolve));
  });

  function request(pathUrl, options = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(pathUrl, baseUrl);
      const req = http.request(
        url,
        {
          method: options.method || 'GET',
          headers: options.headers || {},
        },
        (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const rawBody = Buffer.concat(chunks);
            const body = rawBody.toString('utf8');
            let json = null;
            try {
              json = JSON.parse(body);
            } catch (_) {}
            resolve({
              status: res.statusCode,
              headers: res.headers,
              rawBody,
              body,
              json,
            });
          });
        }
      );
      req.on('error', reject);
      if (options.body) {
        req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
      }
      req.end();
    });
  }

  it('serves static HTML index with 1080p viewport root and tabs', async () => {
    const res = await request('/');
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers['content-type'].includes('text/html'));
    assert.ok(res.body.includes('Flowstate // Melee Replay Analysis Console'));
    assert.ok(res.body.includes('data-tab="spectate"'));
    assert.ok(res.body.includes('live-match-panel'));
  });

  it('serves styles.css and app.js correctly', async () => {
    const cssRes = await request('/styles.css');
    assert.strictEqual(cssRes.status, 200);
    assert.ok(cssRes.headers['content-type'].includes('text/css'));
    assert.ok(cssRes.body.includes('100vh'));

    const jsRes = await request('/app.js');
    assert.strictEqual(jsRes.status, 200);
    assert.ok(jsRes.headers['content-type'].includes('application/javascript'));
  });

  it('serves stage artwork and character portrait assets', async () => {
    const stageRes = await request('/assets/stages/battlefield.jpg');
    assert.strictEqual(stageRes.status, 200);
    assert.strictEqual(stageRes.headers['content-type'], 'image/jpeg');
    assert.ok(stageRes.rawBody.length > 1000);

    const charRes = await request('/assets/character-icons/fox/Default.png');
    assert.strictEqual(charRes.status, 200);
    assert.strictEqual(charRes.headers['content-type'], 'image/png');
    assert.ok(charRes.rawBody.length > 1000);
  });

  it('handles GET /api/characters', async () => {
    const res = await request('/api/characters');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.length, 26);
    assert.ok(res.json.some((c) => c.name === 'Fox' && c.id === 2));
  });

  it('handles GET /api/status', async () => {
    const res = await request('/api/status');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.isRunning, false);
  });

  it('handles GET /api/pipeline/status (with scope isolation)', async () => {
    const res = await request('/api/pipeline/status');
    assert.strictEqual(res.status, 200);
    assert.ok('totalGames' in res.json);
    assert.ok('tempSlpCount' in res.json);
    assert.strictEqual(res.json.tempSlpCount, 0);

    // Verify Scope Isolation: zero player mechanics / habit stats leaked in pipeline telemetry
    const bodyStr = JSON.stringify(res.json);
    assert.strictEqual(bodyStr.includes('lCancelRate'), false);
    assert.strictEqual(bodyStr.includes('climb_punished'), false);
  });

  it('handles GET /api/analytics/mechanics', async () => {
    const res = await request('/api/analytics/mechanics');
    assert.strictEqual(res.status, 200);
    assert.ok('mechanics' in res.json);
    assert.ok('overall' in res.json);
    assert.ok(Array.isArray(res.json.topCharacters));
  });

  it('handles GET /api/audit/errors', async () => {
    const res = await request('/api/audit/errors');
    assert.strictEqual(res.status, 200);
    assert.ok(res.json.statusCounts);
  });

  it('handles GET /api/batches', async () => {
    const res = await request('/api/batches');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.json));
  });

  it('handles GET /api/storage/footprint', async () => {
    const res = await request('/api/storage/footprint');
    assert.strictEqual(res.status, 200);
    assert.ok('payloadStorage' in res.json);
    assert.strictEqual(res.json.tempSlpZero, true);
  });

  it('handles POST /api/abort on idle gracefully', async () => {
    const res = await request('/api/abort', { method: 'POST' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.aborted, false);
  });
});
