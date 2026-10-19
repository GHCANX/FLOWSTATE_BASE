import http from 'node:http';
import assert from 'node:assert';
import { createServer } from '../src/server/server.js';
import { closeDatabase } from '../src/database/db.js';

async function fetchHttp(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function runServerTests() {
  console.log('=== TESTING BROWSER FRONTEND SERVER & API ===');

  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Test server running on ${baseUrl}`);

  try {
    // 1. Test Static HTML
    console.log('1. Testing GET / (HTML)...');
    const htmlRes = await fetchHttp(`${baseUrl}/`);
    assert.strictEqual(htmlRes.status, 200);
    assert(htmlRes.body.includes('FLOWSTATE'), 'HTML contains FLOWSTATE');
    assert(htmlRes.headers['content-type'].includes('text/html'), 'Content-Type is text/html');
    console.log('  ✔ Static HTML served correctly.');

    // 2. Test Static CSS
    console.log('2. Testing GET /styles.css...');
    const cssRes = await fetchHttp(`${baseUrl}/styles.css`);
    assert.strictEqual(cssRes.status, 200);
    assert(cssRes.headers['content-type'].includes('text/css'), 'Content-Type is text/css');
    console.log('  ✔ Stylesheet served correctly.');

    // 3. Test Static JS
    console.log('3. Testing GET /app.js...');
    const jsRes = await fetchHttp(`${baseUrl}/app.js`);
    assert.strictEqual(jsRes.status, 200);
    assert(jsRes.headers['content-type'].includes('application/javascript'), 'Content-Type is javascript');
    console.log('  ✔ Clientside JS served correctly.');

    // 4. Test API Characters
    console.log('4. Testing GET /api/characters...');
    const charsRes = await fetchHttp(`${baseUrl}/api/characters`);
    assert.strictEqual(charsRes.status, 200);
    const chars = JSON.parse(charsRes.body);
    assert.strictEqual(chars.length, 26, 'Should return 26 Melee characters');
    assert(chars.some(c => c.name === 'Fox'), 'Should contain Fox');
    console.log(`  ✔ Characters API returned ${chars.length} characters.`);

    // 5. Test API Recent Games
    console.log('5. Testing GET /api/recent-games...');
    const gamesRes = await fetchHttp(`${baseUrl}/api/recent-games`);
    assert.strictEqual(gamesRes.status, 200);
    const games = JSON.parse(gamesRes.body);
    assert(Array.isArray(games), 'Should return an array of games');
    console.log(`  ✔ Recent Games API returned ${games.length} games.`);

    // 6. Test API Status
    console.log('6. Testing GET /api/status...');
    const statusRes = await fetchHttp(`${baseUrl}/api/status`);
    assert.strictEqual(statusRes.status, 200);
    const statusData = JSON.parse(statusRes.body);
    assert.strictEqual(statusData.isRunning, false, 'Process should not be running');
    console.log('  ✔ Status API returned idle state.');

    // 7. Test API Execute (SSE Stream) for 'overview'
    console.log('7. Testing POST /api/execute (SSE stream for overview)...');
    const events = await new Promise((resolve, reject) => {
      const received = [];
      const req = http.request(`${baseUrl}/api/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, res => {
        assert.strictEqual(res.statusCode, 200);
        assert(res.headers['content-type'].includes('text/event-stream'));

        let buffer = '';
        res.on('data', chunk => {
          buffer += chunk.toString('utf8');
          const lines = buffer.split('\n\n');
          buffer = lines.pop();

          for (const block of lines) {
            if (!block.trim()) continue;
            const line = block.replace(/^data:\s*/, '');
            try {
              const parsed = JSON.parse(line);
              received.push(parsed);
            } catch (_) {}
          }
        });

        res.on('end', () => resolve(received));
      });

      req.on('error', reject);
      req.write(JSON.stringify({ args: ['overview'] }));
      req.end();
    });

    assert(events.some(e => e.type === 'start'), 'Should have start event');
    assert(events.some(e => e.type === 'stdout' && e.text.includes('GLOBAL MELEE DATASET OVERVIEW')), 'Should have stdout event with overview');
    const exitEvent = events.find(e => e.type === 'exit');
    assert(exitEvent, 'Should have exit event');
    assert.strictEqual(exitEvent.code, 0, 'Exit code should be 0');
    console.log('  ✔ SSE execution stream received start, stdout, and exit events successfully.');

    // 8. Test API Abort
    console.log('8. Testing POST /api/abort on idle...');
    const abortRes = await fetchHttp(`${baseUrl}/api/abort`, { method: 'POST' });
    const abortData = JSON.parse(abortRes.body);
    assert.strictEqual(abortData.aborted, false, 'Should report not aborted when idle');
    console.log('  ✔ Abort API correctly handled idle state.');

    // 9. Test API Pipeline Status
    console.log('9. Testing GET /api/pipeline/status...');
    const pipelineRes = await fetchHttp(`${baseUrl}/api/pipeline/status`);
    assert.strictEqual(pipelineRes.status, 200);
    const pipelineData = JSON.parse(pipelineRes.body);
    assert('totalGames' in pipelineData, 'Pipeline data contains totalGames');
    assert('tempSlpCount' in pipelineData, 'Pipeline data contains tempSlpCount');
    console.log(`  ✔ Pipeline Status API returned totalGames=${pipelineData.totalGames}, tempSlpCount=${pipelineData.tempSlpCount}.`);

    // 10. Test API Mechanics Telemetry
    console.log('10. Testing GET /api/analytics/mechanics...');
    const mechRes = await fetchHttp(`${baseUrl}/api/analytics/mechanics`);
    assert.strictEqual(mechRes.status, 200);
    const mechData = JSON.parse(mechRes.body);
    assert('mechanics' in mechData, 'Mechanics data contains mechanics');
    assert('overall' in mechData, 'Mechanics data contains overall');
    assert(Array.isArray(mechData.topCharacters), 'Mechanics data contains topCharacters array');
    console.log(`  ✔ Mechanics API returned top characters count=${mechData.topCharacters.length}.`);

    // 11. Test API Audit Errors
    console.log('11. Testing GET /api/audit/errors...');
    const auditRes = await fetchHttp(`${baseUrl}/api/audit/errors`);
    assert.strictEqual(auditRes.status, 200);
    const auditData = JSON.parse(auditRes.body);
    assert('statusCounts' in auditData, 'Audit data contains statusCounts');
    assert(Array.isArray(auditData.recentFailures), 'Audit data contains recentFailures array');
    console.log(`  ✔ Audit Errors API returned statusCounts=${JSON.stringify(auditData.statusCounts)}.`);

    // 12. Test API Batch Runs
    console.log('12. Testing GET /api/batches...');
    const batchesRes = await fetchHttp(`${baseUrl}/api/batches`);
    assert.strictEqual(batchesRes.status, 200);
    const batchesData = JSON.parse(batchesRes.body);
    assert(Array.isArray(batchesData), 'Batches data must be an array');
    console.log(`  ✔ Batches API returned ${batchesData.length} recorded batch runs.`);

    // 13. Test API Storage Footprint
    console.log('13. Testing GET /api/storage/footprint...');
    const footprintRes = await fetchHttp(`${baseUrl}/api/storage/footprint`);
    assert.strictEqual(footprintRes.status, 200);
    const footprintData = JSON.parse(footprintRes.body);
    assert('tempSlpCount' in footprintData, 'Storage footprint contains tempSlpCount');
    assert('tempSlpZero' in footprintData, 'Storage footprint contains tempSlpZero');
    assert('payloadStorage' in footprintData, 'Storage footprint contains payloadStorage');
    assert.strictEqual(footprintData.tempSlpZero, true, 'Zero accumulation rule: tempSlpZero must be true');
    console.log(`  ✔ Storage Footprint API returned payloadFiles=${footprintData.payloadStorage.fileCount}, tempSlpZero=${footprintData.tempSlpZero}.`);

    console.log('\n=== ALL BROWSER FRONTEND TESTS PASSED ===');
  } finally {
    server.close();
    closeDatabase();
  }
}

runServerTests().catch(err => {
  console.error('Server Test Failed:', err);
  process.exit(1);
});
