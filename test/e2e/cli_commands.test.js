import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';

const CLI_PATH = path.resolve('src/cli.js');

function runCli(args = []) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['--no-warnings', CLI_PATH, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`Timed out running CLI command: ${args.join(' ')}`));
    }, 10000);

    proc.stdout.on('data', (d) => (stdout += d));
    proc.stderr.on('data', (d) => (stderr += d));

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe('CLI Commands End-to-End (E2E)', () => {
  it('displays help text with available subcommands', async () => {
    const res = await runCli(['help']);
    assert.strictEqual(res.code, 0);
    assert.ok(res.stdout.includes('FlowState Melee Analysis Engine CLI'));
    assert.ok(res.stdout.includes('Commands:'));
    assert.ok(res.stdout.includes('serve'));
    assert.ok(res.stdout.includes('batch'));
    assert.ok(res.stdout.includes('overview'));
    assert.ok(res.stdout.includes('matchup'));
  });

  it('runs overview command and displays dataset aggregate stats', async () => {
    const res = await runCli(['overview']);
    assert.strictEqual(res.code, 0);
    assert.ok(res.stdout.includes('GLOBAL MELEE DATASET OVERVIEW'));
    assert.ok(res.stdout.includes('Total Games Ingested:'));
    assert.ok(res.stdout.includes('Top Characters by Play Frequency:'));
  });

  it('runs status command and displays checkpoint details', async () => {
    const res = await runCli(['status']);
    assert.strictEqual(res.code, 0);
    assert.ok(res.stdout.includes('INGESTION CHECKPOINT STATUS:'));
    assert.ok(res.stdout.includes('Active Year:'));
    assert.ok(res.stdout.includes('Cursor Date:'));
  });

  it('runs matchup command for two characters', async () => {
    const res = await runCli(['matchup', 'fox', 'marth']);
    assert.strictEqual(res.code, 0);
    assert.ok(res.stdout.includes('HEAD-TO-HEAD MATCHUP: Fox vs Marth'));
  });

  it('runs export command with JSON and CSV format flags', async () => {
    const jsonRes = await runCli(['export', '--format=json']);
    assert.strictEqual(jsonRes.code, 0);
    assert.doesNotThrow(() => JSON.parse(jsonRes.stdout));

    const csvRes = await runCli(['export', '--format=csv']);
    assert.strictEqual(csvRes.code, 0);
    assert.ok(csvRes.stdout.includes('game_id,start_at'));
  });

  it('handles player scouting command', async () => {
    const res = await runCli(['player', 'NONEXISTENT#000']);
    assert.strictEqual(res.code, 0);
    assert.ok(res.stdout.includes('SCOUTING REPORT FOR NONEXISTENT#000'));
    assert.ok(res.stdout.includes('No games found for player NONEXISTENT#000.'));
  });
});
