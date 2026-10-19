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
   * @param {Object} [options.filters]
   * @param {Function} [options.onProgress]
   */
  async runSingleBatch({
    runName = 'default_run',
    batchSize = 100,
    filters = null,
    onProgress = () => {},
  } = {}) {
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const startTime = Date.now();

    // 1. Lifecycle: QUEUED
    this.repository.createBatchRun({
      batchId,
      runName,
      filterCriteria: filters,
      batchSize,
      lifecycleState: 'queued',
    });

    onProgress({
      type: 'LIFECYCLE',
      stage: 'queued',
      batchId,
      runName,
      message: `Batch ${batchId} queued for execution...`,
    });

    const cp = this.repository.getOrInitCheckpoint(runName);
    const year = cp.current_year;
    const defaultStartDate = cp.current_date;
    const defaultEndDate = `${year + 1}-01-01T00:00:00Z`;
    const page = cp.current_page;

    const startDate = filters?.startDate || defaultStartDate;
    const endDate = filters?.endDate || defaultEndDate;
    const minDurationSeconds = filters?.minDuration ? parseInt(filters.minDuration, 10) : 0;
    const minDurationFrames = minDurationSeconds * 60;

    // 2. Lifecycle: INGESTING
    this.repository.updateBatchRun(batchId, { lifecycleState: 'ingesting' });
    onProgress({
      type: 'LIFECYCLE',
      stage: 'ingesting',
      batchId,
      message: `Searching Lunar Melee (Year ${year}, Page ${page}, Date: ${startDate})...`,
    });

    const searchParams = {
      startDate,
      endDate,
      page,
      limit: batchSize,
      sort: 'startAt:1', // forward chronological walk
    };

    if (filters?.connectCode) searchParams.p1ConnectCode = filters.connectCode;
    if (filters?.opponentCode) searchParams.p2ConnectCode = filters.opponentCode;
    if (filters?.charA != null) searchParams.p1CharacterId = filters.charA;
    if (filters?.charB != null) searchParams.p2CharacterId = filters.charB;
    if (filters?.stageId) searchParams.stageId = filters.stageId;
    if (filters?.source) searchParams.source = filters.source;

    let searchRes;
    try {
      searchRes = await this.lunarClient.searchReplays(searchParams);
    } catch (err) {
      this.repository.updateBatchRun(batchId, {
        lifecycleState: 'failed',
        errorMessage: err.message,
        completedAt: new Date().toISOString(),
      });
      onProgress({
        type: 'LIFECYCLE',
        stage: 'failed',
        batchId,
        error: err.message,
      });
      throw err;
    }

    const replays = searchRes.replays || [];
    this.repository.updateBatchRun(batchId, { discoveredCount: replays.length });

    if (replays.length === 0) {
      // Reached end of this window, advance to next year
      const nextYear = year + 1;
      const nextDate = `${nextYear}-01-01T00:00:00Z`;
      this.repository.updateProgress(cp.id, nextDate, 1, null, 0, 0, 0);
      this.repository.updateBatchRun(batchId, {
        lifecycleState: 'completed',
        completedAt: new Date().toISOString(),
      });
      onProgress({
        type: 'LIFECYCLE',
        stage: 'completed',
        batchId,
        message: 'No replays found in current search window.',
      });
      return {
        batchId,
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
      batchId,
      count: replays.length,
      message: `Found ${replays.length} replays to process. Beginning rate-limited download & ingestion...`,
    });

    const downloadedPaths = [];
    let processedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let batchStorageBytes = 0;
    let lastProcessedReplayId = null;
    let lastReplayDate = startDate;

    for (let i = 0; i < replays.length; i++) {
      const r = replays[i];
      const replayId = r._id;
      const fileHash = r.fileHash;

      if (r.startAt) {
        lastReplayDate = r.startAt;
      }

      // Check min duration (warmup filter) before downloading
      if (minDurationFrames > 0 && r.duration && r.duration < minDurationFrames) {
        skippedCount++;
        onProgress({
          type: 'REPLAY_SKIPPED',
          index: i + 1,
          total: replays.length,
          replayId,
          reason: `Warmup: ${Math.round(r.duration / 60)}s < ${minDurationSeconds}s`,
        });
        continue;
      }

      // Check if already in database (deduplication)
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

        // 3. Lifecycle: PARSING
        this.repository.updateBatchRun(batchId, {
          lifecycleState: 'parsing',
          downloadedCount: downloadedPaths.length,
        });

        onProgress({
          type: 'LIFECYCLE',
          stage: 'parsing',
          batchId,
          index: i + 1,
          total: replays.length,
          replayId,
        });

        // 4. Lifecycle: STORING
        this.repository.updateBatchRun(batchId, {
          lifecycleState: 'storing',
        });

        const processResult = this.frameConsumer.processReplay(tempSlpPath, {
          replayId,
          startAt: r.startAt,
          source: r.source || 'lunar_api',
        });

        if (processResult && processResult.payloadPath && fs.existsSync(processResult.payloadPath)) {
          batchStorageBytes += fs.statSync(processResult.payloadPath).size;
        }

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
      } finally {
        FileCleaner.deleteFile(tempSlpPath);
      }
    }

    // 5. Lifecycle: CACHING & CLEANING (Purge temporary .slp files)
    this.repository.updateBatchRun(batchId, {
      lifecycleState: 'caching',
      storageBytes: batchStorageBytes,
      processedCount,
      skippedCount,
      failedCount,
    });

    onProgress({
      type: 'LIFECYCLE',
      stage: 'caching',
      batchId,
      message: `Batch processing complete. Purging ${downloadedPaths.length} temporary .slp files from ${this.tempDir}...`,
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

    const elapsedMs = Date.now() - startTime;
    const throughputRpm = elapsedMs > 0 ? (processedCount / (elapsedMs / 60000)) : 0;

    // 6. Lifecycle: COMPLETED
    this.repository.updateBatchRun(batchId, {
      lifecycleState: 'completed',
      storageBytes: batchStorageBytes,
      throughputRpm,
      completedAt: new Date().toISOString(),
    });

    onProgress({
      type: 'LIFECYCLE',
      stage: 'completed',
      batchId,
      throughputRpm,
      processed: processedCount,
      skipped: skippedCount,
      failed: failedCount,
      storageBytes: batchStorageBytes,
    });

    return {
      batchId,
      success: true,
      batchSize: replays.length,
      downloaded: downloadedPaths.length,
      processed: processedCount,
      skipped: skippedCount,
      failed: failedCount,
      purgedFiles: purged,
      nextPage: page + 1,
      lastDate: lastReplayDate,
      throughputRpm,
      storageBytes: batchStorageBytes,
    };
  }
}
