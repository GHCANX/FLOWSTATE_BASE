import path from 'node:path';
import fs from 'node:fs';
import { FrameConsumer } from '../src/analysis/frameConsumer.js';
import { ReplayRepository } from '../src/database/repository.js';
import { PayloadBuilder } from '../src/analysis/payloadBuilder.js';
import { AnalyticsService } from '../src/query/analyticsService.js';
import { closeDatabase } from '../src/database/db.js';

async function runStage1Test() {
  console.log('=== STAGE 1: LOCAL ENGINE & STORAGE VERIFICATION ===');

  const testDbPath = './test_analytics.db';
  const testPayloadDir = './test_payloads';

  // Clean up any prior test artifacts
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  if (fs.existsSync(testPayloadDir)) fs.rmSync(testPayloadDir, { recursive: true, force: true });

  const repository = new ReplayRepository(testDbPath);
  const payloadBuilder = new PayloadBuilder(testPayloadDir);
  const consumer = new FrameConsumer({ payloadBuilder, repository });

  const testReplays = [
    { file: 'external/slippi-js-master/slp/lCancel.slp', label: 'L-Cancel Test' },
    { file: 'external/slippi-js-master/slp/wavedash-1.slp', label: 'Wavedash Test' },
    { file: 'external/slippi-js-master/slp/waveland-1.slp', label: 'Waveland Test' },
    { file: 'external/slippi-js-master/slp/unranked_game1.slp', label: 'Full Unranked Game Test' },
  ];

  for (const test of testReplays) {
    console.log(`\nTesting ${test.label} (${test.file})...`);
    if (!fs.existsSync(test.file)) {
      console.warn(`File not found: ${test.file}, skipping.`);
      continue;
    }

    const result = consumer.processReplay(test.file, { source: 'local_test' });
    console.log('Result:', JSON.stringify(result, null, 2));

    // Verify payload exists on disk and can be decompressed
    const decompressed = payloadBuilder.loadPayload(result.payloadPath);
    console.log(`Verified .json.gz payload: Game ${decompressed.gameId}, Stage ${decompressed.stageId}, Stocks: ${decompressed.stocks.length}`);
  }

  // Verify Analytics Queries
  console.log('\n--- Verifying SQLite Analytics Service ---');
  const analytics = new AnalyticsService(testDbPath, payloadBuilder);
  const overview = analytics.getGlobalOverview();
  console.log('Global Overview:', JSON.stringify(overview, null, 2));

  console.log('\n=== STAGE 1 PASSED: ENGINE & DUAL-STORE VERIFIED ===');
  closeDatabase();

  // Clean up test files
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  if (fs.existsSync(testPayloadDir)) fs.rmSync(testPayloadDir, { recursive: true, force: true });
}

runStage1Test().catch(err => {
  console.error('Stage 1 Test Failed:', err);
  process.exit(1);
});
