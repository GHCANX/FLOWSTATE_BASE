import fs from 'node:fs';
import { BatchPipeline } from './orchestrator/batchPipeline.js';
import { LunarClient } from './lunar/lunarClient.js';
import { FrameConsumer } from './analysis/frameConsumer.js';
import { ReplayRepository } from './database/repository.js';
import { PayloadBuilder } from './analysis/payloadBuilder.js';
import { AnalyticsService } from './query/analyticsService.js';
import { closeDatabase } from './database/db.js';
import { getCharacterName, resolveCharacterId } from './constants/characters.js';
import { getStageName } from './constants/stageGeometry.js';

const args = process.argv.slice(2);
const command = args[0] || 'help';

const dbPath = './analytics.db';
const repository = new ReplayRepository(dbPath);
const payloadBuilder = new PayloadBuilder('./payloads');
const consumer = new FrameConsumer({ payloadBuilder, repository });
const lunar = new LunarClient({ maxDownloadsPerMinute: 24 });
const analytics = new AnalyticsService(dbPath, payloadBuilder);

let isAborting = false;
process.on('SIGINT', () => {
  if (isAborting) {
    console.log('\nForce terminating immediately.');
    process.exit(1);
  }
  console.log('\nInterrupt signal received. Gracefully finishing current operation and exiting...');
  isAborting = true;
});

async function main() {
  switch (command) {
    case 'batch': {
      const batchSize = parseInt(args.find(a => a.startsWith('--size='))?.split('=')[1] || '100', 10);
      const isContinuous = args.includes('--continuous');
      const maxBatches = isContinuous 
        ? 999999 
        : parseInt(args.find(a => a.startsWith('--batches='))?.split('=')[1] || '1', 10);
      const runName = args.find(a => a.startsWith('--run='))?.split('=')[1] || 'lunar_2018_onwards';

      console.log(`\nStarting Sliding-Window Ingestion (Batch size: ${batchSize}, Batches: ${isContinuous ? 'Continuous' : maxBatches}, Run: ${runName})`);

      const pipeline = new BatchPipeline({
        lunarClient: lunar,
        frameConsumer: consumer,
        repository,
        tempDir: './temp_slp',
      });

      let b = 1;
      while (b <= maxBatches && !isAborting) {
        console.log(`\n================ BATCH ${b}${isContinuous ? '' : `/${maxBatches}`} ================`);
        const result = await pipeline.runSingleBatch({
          runName,
          batchSize,
          onProgress: (p) => {
            if (p.type === 'DOWNLOADING') {
              process.stdout.write(`\r[Batch ${b}] Downloading [${p.index}/${p.total}] ${p.replayId}... `);
            } else if (p.type === 'COMMITTED') {
              process.stdout.write(`Processed & Committed to DB.\n`);
            } else if (p.type === 'REPLAY_SKIPPED') {
              console.log(`[Batch ${b}] Skipped (${p.index}/${p.total}): ${p.replayId} (${p.reason})`);
            } else if (p.message) {
              console.log(`[Batch ${b}] ${p.message}`);
            }
          },
        });

        console.log('\nBatch Summary:', JSON.stringify(result, null, 2));

        if (result.completed && !result.advancedYear) {
          console.log('\nReached the end of available replays.');
          break;
        }

        b++;
      }
      break;
    }

    case 'matchup': {
      const inputA = args[1];
      const inputB = args[2];
      if (!inputA || !inputB) {
        console.error('Usage: node src/cli.js matchup <character1> <character2>');
        console.error('Example: node src/cli.js matchup fox marth');
        process.exit(1);
      }

      const charA = resolveCharacterId(inputA);
      const charB = resolveCharacterId(inputB);

      if (charA === null || charB === null) {
        console.error(`Invalid character: '${inputA}' -> ${charA}, '${inputB}' -> ${charB}`);
        process.exit(1);
      }

      const nameA = getCharacterName(charA);
      const nameB = getCharacterName(charB);

      console.log(`\n--- HEAD-TO-HEAD MATCHUP: ${nameA} vs ${nameB} ---`);
      const analysis = analytics.getMatchupAnalysis(charA, charB);

      if (!analysis) {
        console.log(`No games recorded between ${nameA} and ${nameB}.`);
      } else {
        console.log(`Total Games Ingested: ${analysis.totalGames}`);
        console.log(`${nameA} Wins: ${analysis.charAWins} (${analysis.charAWinRate.toFixed(1)}%) | ${nameB} Wins: ${analysis.charBWins} (${(100 - analysis.charAWinRate).toFixed(1)}%)`);

        if (analysis.stageBreakdown.length > 0) {
          console.log('\nStage Winrate Breakdown:');
          for (const s of analysis.stageBreakdown) {
            const stageName = getStageName(s.stageId);
            console.log(`  ${stageName.padEnd(20)}: ${s.totalGames} games | ${nameA} ${s.charAWinRate.toFixed(1)}% - ${nameB} ${(100 - s.charAWinRate).toFixed(1)}%`);
          }
        }

        console.log('\nHead-to-Head Mechanical Execution:');
        console.log(`  L-Cancel Success:        ${nameA} ${(analysis.averages.charA.avg_l_cancel_rate || 0).toFixed(1)}% vs ${nameB} ${(analysis.averages.charB.avg_l_cancel_rate || 0).toFixed(1)}%`);
        console.log(`  Average IPM:             ${nameA} ${analysis.averages.charA.avg_ipm.toFixed(1)} vs ${nameB} ${analysis.averages.charB.avg_ipm.toFixed(1)}`);
        console.log(`  Wavedashes / Game:       ${nameA} ${analysis.averages.charA.avg_wavedashes.toFixed(1)} vs ${nameB} ${analysis.averages.charB.avg_wavedashes.toFixed(1)}`);
        console.log(`  Dash Dance Turns / Game: ${nameA} ${analysis.averages.charA.avg_dash_turns.toFixed(1)} vs ${nameB} ${analysis.averages.charB.avg_dash_turns.toFixed(1)}`);
        console.log(`  Shield Drops / Game:     ${nameA} ${analysis.averages.charA.avg_shield_drops.toFixed(1)} vs ${nameB} ${analysis.averages.charB.avg_shield_drops.toFixed(1)}`);
        console.log(`  Openings Per Kill:       ${nameA} ${(analysis.averages.charA.avg_openings_per_kill || 0).toFixed(1)} vs ${nameB} ${(analysis.averages.charB.avg_openings_per_kill || 0).toFixed(1)}`);
      }
      break;
    }

    case 'game': {
      const gameId = args[1];
      if (!gameId) {
        console.error('Usage: node src/cli.js game <GAME_ID>');
        process.exit(1);
      }

      console.log(`\n--- DEEP REPLAY INSPECTION FOR GAME: ${gameId} ---`);
      const details = analytics.getFullGameDetails(gameId);

      if (!details) {
        console.error(`Replay ${gameId} not found in database.`);
        process.exit(1);
      }

      const g = details.game;
      console.log(`Stage:           ${getStageName(g.stage_id)}`);
      console.log(`Start At:        ${g.start_at}`);
      console.log(`Duration:        ${g.duration_seconds.toFixed(1)}s (${g.duration_frames} frames)`);
      console.log(`Winner Port:     Port ${g.winner_port || 'Unknown'}`);
      console.log(`Payload File:    ${g.payload_path}`);

      console.log('\nPlayers:');
      for (const p of details.players) {
        const charName = getCharacterName(p.character_id);
        const winStr = p.is_winner ? ' [WINNER]' : '';
        console.log(`  Port ${p.port}: ${charName} (${p.connect_code || 'No Code'})${winStr} - End Stocks: ${p.end_stocks}`);
      }

      if (details.deepPayload) {
        const dp = details.deepPayload;
        console.log(`\nPayload Analytics:`);
        console.log(`  Recorded Stocks:       ${dp.stocks?.length || 0}`);
        console.log(`  Recorded Conversions:  ${dp.conversions?.length || 0}`);
        console.log(`  Edgeguard Sequences:   ${dp.edgeguards?.length || 0}`);
        console.log(`  Shield Pressures:      ${dp.pressureEvents?.length || 0}`);
        console.log(`  Micro Events:          GALINT=${dp.microEvents?.galint?.length || 0}, V-Cancels=${dp.microEvents?.vCancels?.length || 0}, SDI=${dp.microEvents?.sdi?.length || 0}`);
        
        if (dp.conversions && dp.conversions.length > 0) {
          console.log('\nSample Conversions:');
          for (const c of dp.conversions.slice(0, 3)) {
            console.log(`  [Frames ${c.startFrame}-${c.endFrame}] P${c.attackerIndex + 1} -> P${c.victimIndex + 1}: ${c.moves?.length || 0} hits, ${c.damageDealt?.toFixed(1) || 0}% dmg, Kill: ${c.didKill}`);
          }
        }
      }
      break;
    }

    case 'export': {
      const format = args.find(a => a.startsWith('--format='))?.split('=')[1] || 'json';
      const outPath = args.find(a => a.startsWith('--out='))?.split('=')[1];
      const data = analytics.exportDataset(format);

      if (outPath) {
        fs.writeFileSync(outPath, data, 'utf-8');
        console.log(`Exported dataset (${format.toUpperCase()}) to ${outPath}`);
      } else {
        process.stdout.write(data);
      }
      break;
    }

    case 'overview': {
      console.log('\n--- GLOBAL MELEE DATASET OVERVIEW ---');
      const overview = analytics.getGlobalOverview();
      console.log(`Total Games Ingested:    ${overview.totalGames}`);
      console.log(`Total Unique Players:    ${overview.totalPlayers}`);
      console.log(`Replay Date Range:       ${overview.dateRange?.earliest || 'N/A'} -> ${overview.dateRange?.latest || 'N/A'}`);
      console.log('\nTop Characters by Play Frequency:');
      for (const c of overview.topCharacters) {
        console.log(`  ${getCharacterName(c.character_id).padEnd(18)}: ${c.games_played} games`);
      }
      console.log('\nDataset Mechanical Execution Averages:');
      console.log(`  Average L-Cancel Rate: ${(overview.averageMechanics?.avg_l_cancel_rate || 0).toFixed(1)}%`);
      console.log(`  Average Wavedashes / Game: ${(overview.averageMechanics?.avg_wavedashes || 0).toFixed(1)}`);
      console.log(`  Average Dash Turns / Game: ${(overview.averageMechanics?.avg_dash_turns || 0).toFixed(1)}`);
      console.log(`  Average Shield Drops / Game: ${(overview.averageMechanics?.avg_shield_drops || 0).toFixed(1)}`);
      break;
    }

    case 'player': {
      const code = args[1];
      if (!code) {
        console.error('Usage: node src/cli.js player <CONNECT_CODE>');
        process.exit(1);
      }
      console.log(`\n--- SCOUTING REPORT FOR ${code} ---`);
      const report = analytics.getPlayerScoutingReport(code);
      if (!report) {
        console.log(`No games found for player ${code}.`);
      } else {
        console.log(`Games Recorded: ${report.totalGames}`);
        console.log(`Win Rate: ${report.record.winRate.toFixed(1)}% (${report.record.wins}W - ${report.record.losses}L)`);
        console.log(`Average IPM: ${(report.overall?.avg_ipm || 0).toFixed(1)}`);
        console.log(`L-Cancel Success Rate: ${(report.mechanics?.avg_l_cancel_rate || 0).toFixed(1)}%`);
        console.log(`Total Wavedashes: ${report.mechanics?.total_wavedashes || 0}`);
        console.log(`Total Ledgedashes: ${report.mechanics?.total_ledgedashes || 0} (Avg GALINT: ${(report.mechanics?.avg_galint || 0).toFixed(1)}f)`);
        console.log(`Tech Options: Neutral=${report.mechanics?.tech_neutral || 0}, In=${report.mechanics?.tech_in || 0}, Away=${report.mechanics?.tech_away || 0}, Missed=${report.mechanics?.tech_miss || 0}`);
      }
      break;
    }

    case 'status': {
      const runName = args[1] || 'lunar_2018_onwards';
      const cp = repository.getOrInitCheckpoint(runName);
      console.log(`\n--- INGESTION CHECKPOINT STATUS: ${runName} ---`);
      console.log(`Active Year:             ${cp.current_year}`);
      console.log(`Cursor Date:             ${cp.current_date}`);
      console.log(`Next Page:               ${cp.current_page}`);
      console.log(`Total Downloaded:        ${cp.total_downloaded}`);
      console.log(`Total Processed to DB:   ${cp.total_processed}`);
      console.log(`Total Corrupt / Failed:  ${cp.total_failed}`);
      console.log(`Last Processed Replay:   ${cp.last_processed_replay_id || 'None'}`);
      break;
    }

    case 'help':
    default: {
      console.log(`
FlowState Melee Analysis Engine CLI

Commands:
  node src/cli.js batch [--size=100] [--batches=1] [--continuous] [--run=runName]
      Runs the rate-limited sliding-window batch ingestion pipeline from Lunar Melee.
      Downloads replays, parses them, writes to SQLite + gzip JSON, and purges raw .slp files.

  node src/cli.js status [runName]
      Displays the active checkpoint cursor and ingestion counters.

  node src/cli.js overview
      Displays dataset-wide aggregate statistics, top characters, and mechanics averages.

  node src/cli.js matchup <character1> <character2>
      Analyzes head-to-head matchup statistics, stage win rates, and mechanic differentials.
      Example: node src/cli.js matchup fox marth

  node src/cli.js game <gameId>
      Inspects a single replay in depth, including stocks, combos, conversions, and edgeguards.

  node src/cli.js player <CONNECT_CODE>
      Displays a deep tactical scouting report for a specific Slippi player.

  node src/cli.js export [--format=json|csv] [--out=path]
      Exports the high-level match dataset for external visualization.
`);
      break;
    }
  }

  closeDatabase();
}

main().catch(err => {
  console.error('CLI Error:', err);
  closeDatabase();
  process.exit(1);
});

