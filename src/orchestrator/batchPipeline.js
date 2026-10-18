import path from 'node:path';
import fs from 'node:fs';
import { FileCleaner } from './fileCleaner.js';

export class BatchPipeline {
  /**
   * @param {Object} options
   * @param {import('../lunar/lunarClient.js').LunarClient} options.lunarClient
   * @param {import('../analysis/frameConsumer.js').FrameConsumer} options.frameConsumer
   * @param {import('../database/repository.js').ReplayRepository} options.repository
   * @param {string} [options.tempDir]
   */
  constructor({
    lunarClient,
    frameConsumer,
    repository,
    tempDir = './temp_slp',
  }) {
    this.lunarClient = lunarClient;
    this.frameConsumer = frameConsumer;
    this.repository = repository;
    this.tempDir = tempDir;

    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Run a single batch of N replays
   * @param {Object} [options]
   * @param {string} [options.runName]
   * @param {number} [options.batchSize]
   * @param {Function} [options.onProgress]
   */
  async runSingleBatch({
    runName = 'default_run',
    batchSize = 100,
    onProgress = () => {},
  } = {}) {
    const cp = this.repository.getOrInitCheckpoint(runName);
    const year = cp.current_year;
    const startDate = cp.current_date;
    const endDate = `${year + 1}-01-01T00:00:00Z`;
    const page = cp.current_page;

    onProgress({
      type: 'SEARCHING',
      message: `Searching Lunar Melee for batch (Year ${year}, Page ${page}, Date: ${startDate})...`,
    });

    const searchRes = await this.lunarClient.searchReplays({
      startDate,
      endDate,
      page,
      limit: batchSize,
      sort: 'startAt:1', // forward chronological walk
    });

    const replays = searchRes.replays || [];
    if (replays.length === 0) {
      // Reached end of this year, advance to next year
      const nextYear = year + 1;
      const nextDate = `${nextYear}-01-01T00:00:00Z`;
      this.repository.updateProgress(cp.id, nextDate, 1, null, 0, 0, 0);
      return {
        completed: true,
        advancedYear: true,
        newYear: nextYear,
        processed: 0,
        skipped: 0,
        failed: 0,
      };
    }

    onProgress({
      type: 'BATCH_FOUND',
      count: replays.length,
      message: `Found ${replays.length} replays to process. Beginning rate-limited download & ingestion...`,
    });

    const downloadedPaths = [];
    let processedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let lastProcessedReplayId = null;
    let lastReplayDate = startDate;

    for (let i = 0; i < replays.length; i++) {
      const r = replays[i];
      const replayId = r._id;
      const fileHash = r.fileHash;

      if (r.startAt) {
        lastReplayDate = r.startAt;
      }

      // Check if already in database
      if (this.repository.isProcessed(replayId, fileHash)) {
        skippedCount++;
        onProgress({
          type: 'REPLAY_SKIPPED',
          index: i + 1,
          total: replays.length,
          replayId,
          reason: 'Already processed',
        });
        continue;
      }

      const tempSlpPath = path.join(this.tempDir, `${replayId}.slp`);

      try {
        // Download single replay
        onProgress({
          type: 'DOWNLOADING',
          index: i + 1,
          total: replays.length,
          replayId,
        });

        await this.lunarClient.downloadReplay(replayId, tempSlpPath);
        downloadedPaths.push(tempSlpPath);

        // Process replay
        onProgress({
          type: 'ANALYZING',
          index: i + 1,
          total: replays.length,
          replayId,
        });

        this.frameConsumer.processReplay(tempSlpPath, {
          replayId,
          startAt: r.startAt,
          source: 'lunar_api',
        });

        processedCount++;
        lastProcessedReplayId = replayId;

        onProgress({
          type: 'COMMITTED',
          index: i + 1,
          total: replays.length,
          replayId,
        });
      } catch (err) {
        failedCount++;
        console.error(`[BatchPipeline] Error processing replay ${replayId}: ${err.message}`);
        this.repository.recordStatus(replayId, fileHash || replayId, 'lunar_api', 'FAILED_CORRUPT', err.message);

        onProgress({
          type: 'REPLAY_FAILED',
          index: i + 1,
          total: replays.length,
          replayId,
          error: err.message,
        });
      }
    }

    // Purge temporary .slp files
    onProgress({
      type: 'CLEANING',
      message: `Batch complete. Purging ${downloadedPaths.length} temporary .slp files from ${this.tempDir}...`,
    });

    const purged = FileCleaner.purgeBatch(downloadedPaths);

    // Advance checkpoint
    this.repository.updateProgress(
      cp.id,
      lastReplayDate,
      page + 1,
      lastProcessedReplayId,
      downloadedPaths.length,
      processedCount,
      failedCount
    );

    return {
      success: true,
      batchSize: replays.length,
      downloaded: downloadedPaths.length,
      processed: processedCount,
      skipped: skippedCount,
      failed: failedCount,
      purgedFiles: purged,
      nextPage: page + 1,
      lastDate: lastReplayDate,
    };
  }
}
