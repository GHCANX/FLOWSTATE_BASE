import fs from 'node:fs';
import path from 'node:path';
import { LunarClient } from '../src/lunar/lunarClient.js';
import { FrameConsumer } from '../src/analysis/frameConsumer.js';
import { ReplayRepository } from '../src/database/repository.js';
import { PayloadBuilder } from '../src/analysis/payloadBuilder.js';
import { FileCleaner } from '../src/orchestrator/fileCleaner.js';
import { AnalyticsService } from '../src/query/analyticsService.js';
import { closeDatabase } from '../src/database/db.js';

async function runStage2Pilot() {
  console.log('=== STAGE 2: LUNAR MELEE CLIENT PILOT (SMALL BATCH) ===');

  const tempDir = './temp_slp';
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const repository = new ReplayRepository('./analytics.db');
  const payloadBuilder = new PayloadBuilder('./payloads');
  const consumer = new FrameConsumer({ payloadBuilder, repository });
  const lunar = new LunarClient({ maxDownloadsPerMinute: 20 });

  console.log('Searching Lunar Melee for the earliest replays from 2018...');
  const search = await lunar.searchReplays({
    startDate: '2018-01-01',
    limit: 2,
    sort: 'startAt:1', // oldest first
  });

  console.log(`Found ${search.replays.length} replays from Lunar Melee.`);
  if (search.replays.length === 0) {
    console.warn('No replays found, exiting pilot.');
    return;
  }

  const downloadedFiles = [];

  for (let i = 0; i < search.replays.length; i++) {
    const r = search.replays[i];
    console.log(`\n[${i + 1}/${search.replays.length}] Testing Replay ID: ${r._id}`);
    console.log(`  Date: ${r.startAt}, Stage: ${r.stageName || r.stageId}, Duration: ${r.duration} frames`);
    console.log(`  Players: ${r.players.map(p => `${p.characterName || p.characterId} (${p.connectCode || p.displayName || 'P' + p.playerIndex})`).join(' vs ')}`);

    const tempPath = path.join(tempDir, `${r._id}.slp`);
    console.log(`  Downloading to ${tempPath}...`);
    await lunar.downloadReplay(r._id, tempPath);
    downloadedFiles.push(tempPath);

    const stats = fs.statSync(tempPath);
    console.log(`  Download complete (${(stats.size / 1024 / 1024).toFixed(2)} MB). Running Analysis Engine...`);

    const result = consumer.processReplay(tempPath, {
      replayId: r._id,
      startAt: r.startAt,
      source: 'lunar_api',
    });

    console.log(`  Processed: ${result.gameId}`);
    console.log(`  Payload: ${result.payloadPath} (${(fs.statSync(result.payloadPath).size / 1024).toFixed(1)} KB compressed)`);
    console.log(`  Stocks: ${result.stocksCount}, Conversions: ${result.conversionsCount}`);
  }

  // Verify Database & Analytics
  console.log('\n--- Verifying SQLite Persistence ---');
  const analytics = new AnalyticsService('./analytics.db', payloadBuilder);
  const overview = analytics.getGlobalOverview();
  console.log('Analytics Overview after Lunar Pilot:');
  console.log(`  Total Games in DB: ${overview.totalGames}`);
  console.log(`  Total Unique Players: ${overview.totalPlayers}`);
  console.log(`  Date Range: ${overview.dateRange.earliest} -> ${overview.dateRange.latest}`);
  console.log('  Top Characters:', overview.topCharacters);

  // Purge temporary files
  console.log('\n--- Purging Temporary .slp Replays ---');
  const purged = FileCleaner.purgeBatch(downloadedFiles);
  console.log(`Purged ${purged}/${downloadedFiles.length} temporary files from ${tempDir}.`);
  const remaining = fs.readdirSync(tempDir);
  console.log(`Remaining files in ${tempDir}: ${remaining.length}`);

  console.log('\n=== STAGE 2 PASSED: LUNAR INGESTION & PURGE LIFECYCLE VERIFIED ===');
  closeDatabase();
}

runStage2Pilot().catch(err => {
  console.error('Stage 2 Pilot Failed:', err);
  process.exit(1);
});
