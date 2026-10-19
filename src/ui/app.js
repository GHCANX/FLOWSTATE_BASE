// Flowstate Browser Frontend Clientside App
let currentTab = 'matchup';
let isRunning = false;
let executionStartTime = null;
let timerInterval = null;
let activeAbortController = null;

// Multi-Batch & Dashboard Selection State
let selectedBatchId = null; // null = Live Auto-Follow (latest); string = sticky historical batch
let allBatches = [];

// Tray State
let trayState = 'default'; // 'min', 'default', 'max'
let batchPollInterval = null;

// DOM Elements - Shell & Controls
const tabs = document.querySelectorAll('.tab-btn');
const forms = document.querySelectorAll('.command-form');
const commandPreviewEl = document.getElementById('command-preview-text');
const btnExecute = document.getElementById('btn-execute');
const btnAbort = document.getElementById('btn-abort');
const btnCopyCommand = document.getElementById('btn-copy-command');
const btnCopyOutput = document.getElementById('btn-copy-output');
const btnClearTerm = document.getElementById('btn-clear-term');
const terminalTray = document.getElementById('terminal-tray');
const terminalOutput = document.getElementById('terminal-output');
const terminalViewport = document.getElementById('terminal-viewport');
const executionBadge = document.getElementById('execution-badge');
const badgeText = document.getElementById('badge-text');
const executionTimer = document.getElementById('execution-timer');
const toastEl = document.getElementById('toast');

// Console Tray Controls
const btnTrayMin = document.getElementById('btn-tray-min');
const btnTrayDefault = document.getElementById('btn-tray-default');
const btnTrayMax = document.getElementById('btn-tray-max');

// Dashboard Header & States
const dashboardEmpty = document.getElementById('dashboard-empty');
const dashboardLoading = document.getElementById('dashboard-loading');
const dashboardContent = document.getElementById('dashboard-content');
const btnRefreshDashboard = document.getElementById('btn-refresh-dashboard');
const lastSyncedTime = document.getElementById('last-synced-time');
const btnEmptyStartSync = document.getElementById('btn-empty-start-sync');
const liveSyncText = document.getElementById('live-sync-text');

// Dashboard Context Banner
const dashboardContextBanner = document.getElementById('dashboard-context-banner');
const contextBannerText = document.getElementById('context-banner-text');
const btnJumpLatest = document.getElementById('btn-jump-latest');

// Operational KPI Elements (Strictly Operational Pipeline - NO movement mechanics)
const kpiBatchLifecycleVal = document.getElementById('kpi-batch-lifecycle-val');
const kpiBatchLifecycleSub = document.getElementById('kpi-batch-lifecycle-sub');
const kpiThroughputVal = document.getElementById('kpi-throughput-val');
const kpiThroughputSub = document.getElementById('kpi-throughput-sub');
const kpiStorageVal = document.getElementById('kpi-storage-val');
const kpiStorageSub = document.getElementById('kpi-storage-sub');
const kpiDedupVal = document.getElementById('kpi-dedup-val');
const kpiDedupSub = document.getElementById('kpi-dedup-sub');
const kpiIntegrityVal = document.getElementById('kpi-integrity-val');
const kpiIntegritySub = document.getElementById('kpi-integrity-sub');

// Funnel Elements
const stageLunarMetric = document.getElementById('stage-lunar-metric');
const stageLunarBadge = document.getElementById('stage-lunar-badge');
const stageBufferMetric = document.getElementById('stage-buffer-metric');
const stageBufferBadge = document.getElementById('stage-buffer-badge');
const stageParserMetric = document.getElementById('stage-parser-metric');
const stageParserBadge = document.getElementById('stage-parser-badge');
const stageSqliteMetric = document.getElementById('stage-sqlite-metric');
const stageSqliteBadge = document.getElementById('stage-sqlite-badge');
const stagePayloadMetric = document.getElementById('stage-payload-metric');
const stagePayloadBadge = document.getElementById('stage-payload-badge');
const funnelStatusBadge = document.getElementById('funnel-status-badge');

// Audit & Execution Telemetry Elements
const auditStatusPill = document.getElementById('audit-status-pill');
const auditRunName = document.getElementById('audit-run-name');
const auditDownloaded = document.getElementById('audit-downloaded');
const auditProcessed = document.getElementById('audit-processed');
const auditSkipped = document.getElementById('audit-skipped');
const auditLogBox = document.getElementById('audit-log-box');

// Storage, Cache & Ingestion Telemetry Elements
const telemetryBatchPill = document.getElementById('telemetry-batch-pill');
const telemetryPayloadCount = document.getElementById('telemetry-payload-count');
const telemetryPayloadSize = document.getElementById('telemetry-payload-size');
const telemetryBufferStatus = document.getElementById('telemetry-buffer-status');
const meterCommittedVal = document.getElementById('meter-committed-val');
const meterCommittedFill = document.getElementById('meter-committed-fill');
const meterSkippedVal = document.getElementById('meter-skipped-val');
const meterSkippedFill = document.getElementById('meter-skipped-fill');
const meterFailedVal = document.getElementById('meter-failed-val');
const meterFailedFill = document.getElementById('meter-failed-fill');
const meterRateVal = document.getElementById('meter-rate-val');
const meterRateFill = document.getElementById('meter-rate-fill');

// Batch Ingestion Filter Controls
const btnToggleFilters = document.getElementById('btn-toggle-filters');
const filterPanel = document.getElementById('filter-panel');
const filterBadge = document.getElementById('filter-badge');
const filterChevron = document.getElementById('filter-chevron');
const filterStartDate = document.getElementById('batch-filter-start-date');
const filterEndDate = document.getElementById('batch-filter-end-date');
const dateErrorMsg = document.getElementById('date-error-msg');
const datePills = document.querySelectorAll('.date-pill');
const filterP1Code = document.getElementById('batch-filter-p1-code');
const filterP2Code = document.getElementById('batch-filter-p2-code');
const codeErrorMsg = document.getElementById('code-error-msg');
const filterSource = document.getElementById('batch-filter-source');
const filterCharA = document.getElementById('batch-filter-char-a');
const filterCharB = document.getElementById('batch-filter-char-b');
const filterStage = document.getElementById('batch-filter-stage');
const filterMinDuration = document.getElementById('batch-filter-min-duration');
const btnResetFilters = document.getElementById('btn-reset-filters');

// Jobs / History Elements
const historyList = document.getElementById('history-list');
const historyTotalCount = document.getElementById('history-total-count');
const btnRefreshHistory = document.getElementById('btn-refresh-history');

// Form-specific controls
const selectCharA = document.getElementById('matchup-charA');
const selectCharB = document.getElementById('matchup-charB');
const btnSwapChars = document.getElementById('btn-swap-chars');
const sliderBatchSize = document.getElementById('batch-size');
const labelBatchSize = document.getElementById('batch-size-val');
const inputBatchCount = document.getElementById('batch-count');
const inputBatchRun = document.getElementById('batch-run');
const checkBatchContinuous = document.getElementById('batch-continuous');
const inputPlayerCode = document.getElementById('player-code');
const selectRecentGames = document.getElementById('game-recent-select');
const inputGameId = document.getElementById('game-id');
const inputStatusRun = document.getElementById('status-run');
const inputExportOut = document.getElementById('export-out');
const inputCustomArgs = document.getElementById('custom-args');

/**
 * Show a toast notification
 * @param {string} message
 */
function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.remove('hidden');
  setTimeout(() => {
    toastEl.classList.add('hidden');
  }, 2500);
}

/**
 * Escape HTML special characters
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Convert ANSI escape codes to colored HTML spans
 * @param {string} text
 * @returns {string}
 */
function ansiToHtml(text) {
  let html = escapeHtml(text);

  // Common ANSI color sequences
  const ansiMap = [
    { regex: /\x1b\[0m/g, replacement: '</span>' },
    { regex: /\x1b\[1m/g, replacement: '<span class="t-bold">' },
    { regex: /\x1b\[2m/g, replacement: '<span class="t-dim">' },
    { regex: /\x1b\[31m/g, replacement: '<span class="t-red">' },
    { regex: /\x1b\[32m/g, replacement: '<span class="t-green">' },
    { regex: /\x1b\[33m/g, replacement: '<span class="t-yellow">' },
    { regex: /\x1b\[34m/g, replacement: '<span class="t-blue">' },
    { regex: /\x1b\[35m/g, replacement: '<span class="t-magenta">' },
    { regex: /\x1b\[36m/g, replacement: '<span class="t-cyan">' },
    { regex: /\x1b\[90m/g, replacement: '<span class="t-dim">' },
    // Strip other unhandled ANSI escape sequences
    { regex: /\x1b\[[0-9;]*[a-zA-Z]/g, replacement: '' },
  ];

  for (const { regex, replacement } of ansiMap) {
    html = html.replace(regex, replacement);
  }

  return html;
}

/**
 * Append text to the terminal viewport
 * @param {string} rawText
 */
function appendTerminalText(rawText) {
  terminalOutput.innerHTML += ansiToHtml(rawText);
  terminalViewport.scrollTop = terminalViewport.scrollHeight;
}

/**
 * Toggle the Granular Replay Filters accordion
 */
function toggleFilterAccordion() {
  const isHidden = filterPanel.classList.contains('hidden');
  if (isHidden) {
    filterPanel.classList.remove('hidden');
    btnToggleFilters.setAttribute('aria-expanded', 'true');
  } else {
    filterPanel.classList.add('hidden');
    btnToggleFilters.setAttribute('aria-expanded', 'false');
  }
}

/**
 * Apply quick date preset to inputs
 * @param {'today' | 'last7' | 'mtd' | 'all'} preset
 */
function setDatePreset(preset) {
  datePills.forEach(p => p.classList.toggle('active', p.dataset.preset === preset));
  const now = new Date();
  const formatYmd = d => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  if (preset === 'today') {
    const todayStr = formatYmd(now);
    filterStartDate.value = todayStr;
    filterEndDate.value = todayStr;
  } else if (preset === 'last7') {
    const past = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    filterStartDate.value = formatYmd(past);
    filterEndDate.value = formatYmd(now);
  } else if (preset === 'mtd') {
    const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1);
    filterStartDate.value = formatYmd(mtdStart);
    filterEndDate.value = formatYmd(now);
  } else if (preset === 'all') {
    filterStartDate.value = '';
    filterEndDate.value = '';
  }

  validateFilters();
  updateCommandPreview();
}

/**
 * Reset all granular replay filters to default state
 */
function resetFilters() {
  setDatePreset('all');
  if (filterP1Code) filterP1Code.value = '';
  if (filterP2Code) filterP2Code.value = '';
  if (filterSource) filterSource.value = '';
  if (filterCharA) filterCharA.value = '';
  if (filterCharB) filterCharB.value = '';
  if (filterStage) filterStage.value = '';
  if (filterMinDuration) filterMinDuration.value = '0';
  validateFilters();
  updateCommandPreview();
  showToast('Replay filters cleared.');
}

/**
 * Update the filter count badge on the accordion toggle button
 */
function updateFilterBadge() {
  let count = 0;
  if (filterStartDate?.value || filterEndDate?.value) count++;
  if (filterP1Code?.value?.trim()) count++;
  if (filterP2Code?.value?.trim()) count++;
  if (filterSource?.value) count++;
  if (filterCharA?.value) count++;
  if (filterCharB?.value) count++;
  if (filterStage?.value) count++;
  if (parseInt(filterMinDuration?.value || '0', 10) > 0) count++;

  if (filterBadge) {
    if (count > 0) {
      filterBadge.textContent = `${count} active`;
      filterBadge.classList.remove('hidden');
    } else {
      filterBadge.classList.add('hidden');
    }
  }
}

/**
 * Validate filter inputs client-side
 * @returns {boolean}
 */
function validateFilters() {
  let isValid = true;

  // Date ordering check
  if (filterStartDate?.value && filterEndDate?.value) {
    if (filterStartDate.value > filterEndDate.value) {
      if (dateErrorMsg) {
        dateErrorMsg.textContent = 'Start date cannot be after end date.';
        dateErrorMsg.classList.remove('hidden');
      }
      isValid = false;
    } else if (dateErrorMsg) {
      dateErrorMsg.classList.add('hidden');
    }
  } else if (dateErrorMsg) {
    dateErrorMsg.classList.add('hidden');
  }

  // Connect code format check (TAG#123)
  const codeRegex = /^[A-Z0-9]{1,8}#[0-9]{1,4}$/i;
  const p1Val = filterP1Code?.value?.trim();
  const p2Val = filterP2Code?.value?.trim();
  let codeError = null;

  if (p1Val && !codeRegex.test(p1Val)) {
    codeError = 'Connect Code (P1) should follow format TAG#123';
  } else if (p2Val && !codeRegex.test(p2Val)) {
    codeError = 'Opponent Code (P2) should follow format TAG#123';
  }

  if (codeErrorMsg) {
    if (codeError) {
      codeErrorMsg.textContent = codeError;
      codeErrorMsg.classList.remove('hidden');
    } else {
      codeErrorMsg.classList.add('hidden');
    }
  }

  updateFilterBadge();

  if (currentTab === 'batch') {
    btnExecute.disabled = !isValid || isRunning;
  }

  return isValid;
}

/**
 * Update the live command string preview based on active form controls
 */
function updateCommandPreview() {
  const args = getActiveCommandArgs();
  commandPreviewEl.textContent = `node src/cli.js ${args.join(' ')}`;
}

/**
 * Build the CLI argument list for the currently active tab
 * @returns {string[]}
 */
function getActiveCommandArgs() {
  switch (currentTab) {
    case 'matchup': {
      const charA = selectCharA.value || 'fox';
      const charB = selectCharB.value || 'marth';
      return ['matchup', charA, charB];
    }

    case 'batch': {
      const args = ['batch'];
      const size = sliderBatchSize.value;
      if (size) args.push(`--size=${size}`);
      const batches = inputBatchCount.value;
      if (batches && !checkBatchContinuous.checked) args.push(`--batches=${batches}`);
      if (checkBatchContinuous.checked) args.push('--continuous');
      const run = inputBatchRun.value?.trim();
      if (run) args.push(`--run=${run}`);

      // Granular replay filters
      if (filterStartDate?.value) args.push(`--start-date=${filterStartDate.value}`);
      if (filterEndDate?.value) args.push(`--end-date=${filterEndDate.value}`);
      if (filterP1Code?.value?.trim()) args.push(`--connect-code=${filterP1Code.value.trim().toUpperCase()}`);
      if (filterP2Code?.value?.trim()) args.push(`--opponent-code=${filterP2Code.value.trim().toUpperCase()}`);
      if (filterSource?.value) args.push(`--source=${filterSource.value}`);
      if (filterCharA?.value) args.push(`--char-a=${filterCharA.value}`);
      if (filterCharB?.value) args.push(`--char-b=${filterCharB.value}`);
      if (filterStage?.value) args.push(`--stage=${filterStage.value}`);
      const minDur = parseInt(filterMinDuration?.value || '0', 10);
      if (minDur > 0) args.push(`--min-duration=${minDur}`);

      return args;
    }

    case 'history': {
      return ['status'];
    }

    case 'player': {
      const code = inputPlayerCode.value?.trim() || 'MANG#0';
      return ['player', code];
    }

    case 'game': {
      const gameId = inputGameId.value?.trim() || (selectRecentGames.value ? selectRecentGames.value : '69bea9e55febbbc18f6a6f66');
      return ['game', gameId];
    }

    case 'overview': {
      return ['overview'];
    }

    case 'status': {
      const run = inputStatusRun.value?.trim();
      return run ? ['status', run] : ['status'];
    }

    case 'export': {
      const format = document.querySelector('input[name="format"]:checked')?.value || 'json';
      const args = ['export', `--format=${format}`];
      const out = inputExportOut.value?.trim();
      if (out) args.push(`--out=${out}`);
      return args;
    }

    case 'custom': {
      const raw = inputCustomArgs.value?.trim();
      return raw ? raw.split(/\s+/) : ['help'];
    }

    default:
      return ['help'];
  }
}

/**
 * Switch the active tab and display corresponding form
 * @param {string} tabKey
 */
function switchTab(tabKey) {
  currentTab = tabKey;
  tabs.forEach(t => {
    const isActive = t.dataset.tab === tabKey;
    t.classList.toggle('active', isActive);
    t.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  forms.forEach(f => {
    f.classList.toggle('active', f.dataset.command === tabKey);
  });

  if (tabKey === 'history') {
    fetchBatchHistory();
  }

  updateCommandPreview();
}

/**
 * Start the execution timer display
 */
function startTimer() {
  executionStartTime = performance.now();
  timerInterval = setInterval(() => {
    const elapsed = performance.now() - executionStartTime;
    const totalSeconds = Math.floor(elapsed / 1000);
    const mins = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const secs = (totalSeconds % 60).toString().padStart(2, '0');
    const tenths = Math.floor((elapsed % 1000) / 100);
    executionTimer.textContent = `${mins}:${secs}.${tenths}`;
  }, 100);
}

/**
 * Stop the execution timer display
 */
function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

/**
 * Set the execution state
 * @param {'idle' | 'running' | 'completed' | 'error'} state
 * @param {string} [label]
 */
function setExecutionState(state, label) {
  executionBadge.className = `badge-status ${state}`;
  badgeText.textContent = label || state.toUpperCase();

  if (state === 'running') {
    isRunning = true;
    btnExecute.disabled = true;
    btnAbort.disabled = false;
    startTimer();
  } else {
    isRunning = false;
    btnExecute.disabled = !validateFilters();
    btnAbort.disabled = true;
    stopTimer();
  }
}

/**
 * Set console tray height state
 * @param {'min' | 'default' | 'max'} state
 */
function setTrayState(state) {
  trayState = state;
  terminalTray.classList.remove('tray-minimized', 'tray-default', 'tray-maximized');
  btnTrayMin.classList.remove('active');
  btnTrayDefault.classList.remove('active');
  btnTrayMax.classList.remove('active');

  if (state === 'min') {
    terminalTray.classList.add('tray-minimized');
    btnTrayMin.classList.add('active');
  } else if (state === 'max') {
    terminalTray.classList.add('tray-maximized');
    btnTrayMax.classList.add('active');
  } else {
    terminalTray.classList.add('tray-default');
    btnTrayDefault.classList.add('active');
  }
}

/**
 * Fetch list of recorded batches and update history sidebar
 */
async function fetchBatchHistory() {
  try {
    const res = await fetch('/api/batches?limit=50');
    if (!res.ok) return;
    allBatches = await res.json();
    renderBatchHistory(allBatches);
  } catch (err) {
    console.warn('Failed to load batch history:', err);
  }
}

/**
 * Render batch list into the history container
 * @param {Array} batches
 */
function renderBatchHistory(batches) {
  if (historyTotalCount) {
    historyTotalCount.textContent = `${batches.length} Run${batches.length === 1 ? '' : 's'} Recorded`;
  }

  if (!historyList) return;

  if (batches.length === 0) {
    historyList.innerHTML = '<div class="history-empty">No batch execution records found. Start an ingestion batch to generate history.</div>';
    return;
  }

  const activeId = selectedBatchId || (batches[0] ? batches[0].batch_id : null);

  historyList.innerHTML = batches.map(b => {
    const isSel = b.batch_id === activeId;
    const shortId = b.batch_id ? b.batch_id.slice(0, 8) : 'batch';
    const state = b.lifecycle_state || 'completed';
    const filterDesc = b.filter_criteria ? escapeHtml(b.filter_criteria) : 'Standard Batch Window';
    const mb = b.storage_bytes ? (b.storage_bytes / (1024 * 1024)).toFixed(2) + ' MB' : '0 MB';

    return `
      <div class="batch-card ${isSel ? 'selected' : ''}" data-batch-id="${escapeHtml(b.batch_id)}" role="button" tabindex="0">
        <div class="batch-card-header">
          <span class="batch-card-title">${escapeHtml(b.run_name || shortId)} <span class="t-dim">(${shortId})</span></span>
          <span class="batch-status-badge badge-${state.toLowerCase()}">${escapeHtml(state)}</span>
        </div>
        <div class="batch-card-filters" title="${filterDesc}">${filterDesc}</div>
        <div class="batch-card-metrics">
          <div class="batch-card-stat">
            <span>Discovered</span>
            <span class="batch-card-stat-val">${(b.discovered_count ?? '--')}</span>
          </div>
          <div class="batch-card-stat">
            <span>Processed</span>
            <span class="batch-card-stat-val text-green">${(b.processed_count ?? '--')}</span>
          </div>
          <div class="batch-card-stat">
            <span>Disk Impact</span>
            <span class="batch-card-stat-val text-yellow">${mb}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Attach card click handlers
  historyList.querySelectorAll('.batch-card').forEach(card => {
    card.addEventListener('click', () => {
      selectHistoricalBatch(card.dataset.batchId);
    });
  });
}

/**
 * Lock dashboard focus to a specific historical batch
 * @param {string} batchId
 */
function selectHistoricalBatch(batchId) {
  selectedBatchId = batchId;
  const b = allBatches.find(x => x.batch_id === batchId);
  const shortId = batchId ? batchId.slice(0, 8) : 'unknown';
  const runName = b ? b.run_name : shortId;

  // Update Context Banner
  if (dashboardContextBanner) {
    dashboardContextBanner.className = 'context-banner historical-mode';
  }
  if (contextBannerText) {
    contextBannerText.textContent = `Viewing: Historical Batch ${shortId} (${runName})`;
  }
  if (btnJumpLatest) {
    btnJumpLatest.classList.remove('hidden');
  }
  if (liveSyncText) {
    liveSyncText.textContent = 'PAUSED (HISTORICAL)';
  }

  // Highlight selected card
  if (historyList) {
    historyList.querySelectorAll('.batch-card').forEach(card => {
      card.classList.toggle('selected', card.dataset.batchId === batchId);
    });
  }

  fetchDashboardTelemetry(true);
}

/**
 * Return dashboard focus to live auto-follow mode
 */
function jumpToLatestBatch() {
  selectedBatchId = null;

  // Restore Context Banner
  if (dashboardContextBanner) {
    dashboardContextBanner.className = 'context-banner live-mode';
  }
  if (contextBannerText) {
    contextBannerText.textContent = 'Viewing: Latest Batch (Live Auto-Follow)';
  }
  if (btnJumpLatest) {
    btnJumpLatest.classList.add('hidden');
  }
  if (liveSyncText) {
    liveSyncText.textContent = 'LIVE SYNC';
  }

  // Restore latest selected card in history
  if (allBatches.length > 0 && historyList) {
    const latestId = allBatches[0].batch_id;
    historyList.querySelectorAll('.batch-card').forEach(card => {
      card.classList.toggle('selected', card.dataset.batchId === latestId);
    });
  }

  fetchDashboardTelemetry(true);
  showToast('Switched to live latest batch auto-follow mode');
}

/**
 * Fetch and update dashboard telemetry across split endpoints
 * @param {boolean} [silent=false]
 */
async function fetchDashboardTelemetry(silent = false) {
  if (!silent && btnRefreshDashboard) {
    btnRefreshDashboard.classList.add('refreshing');
  }

  try {
    const [pipelineRes, footprintRes, auditRes, batchesRes] = await Promise.all([
      fetch('/api/pipeline/status'),
      fetch('/api/storage/footprint'),
      fetch('/api/audit/errors'),
      fetch('/api/batches?limit=50'),
    ]);

    if (!pipelineRes.ok || !footprintRes.ok || !auditRes.ok) {
      console.warn('Dashboard endpoints returned non-ok status');
      return;
    }

    const pipeline = await pipelineRes.json();
    const footprint = await footprintRes.json();
    const audit = await auditRes.json();
    allBatches = batchesRes.ok ? await batchesRes.json() : [];

    // Determine current batch focus
    let currentBatch = null;
    if (selectedBatchId) {
      currentBatch = allBatches.find(b => b.batch_id === selectedBatchId);
      if (!currentBatch) {
        const bRes = await fetch(`/api/batches/${encodeURIComponent(selectedBatchId)}`);
        if (bRes.ok) currentBatch = await bRes.json();
      }
    } else if (allBatches.length > 0) {
      currentBatch = allBatches[0];
    }

    renderDashboardData(pipeline, footprint, audit, currentBatch);
    renderBatchHistory(allBatches);
  } catch (err) {
    console.warn('Failed to fetch dashboard telemetry:', err);
  } finally {
    if (!silent && btnRefreshDashboard) {
      setTimeout(() => btnRefreshDashboard.classList.remove('refreshing'), 400);
    }
  }
}

/**
 * Render operational pipeline telemetry data into dashboard DOM
 * Strictly purges player-mechanic metrics (L-cancels, wavedashes, dash turns, IPM)
 */
function renderDashboardData(pipeline, footprint, audit, currentBatch) {
  const totalGames = pipeline.totalGames || 0;

  if (totalGames === 0 && !currentBatch) {
    dashboardEmpty?.classList.remove('hidden');
    dashboardContent?.classList.add('hidden');
    dashboardLoading?.classList.add('hidden');
    return;
  }

  dashboardEmpty?.classList.add('hidden');
  dashboardContent?.classList.remove('hidden');
  dashboardLoading?.classList.add('hidden');

  // 1. Operational KPI Cards
  const lifecycleState = currentBatch ? (currentBatch.lifecycle_state || 'COMPLETED').toUpperCase() : 'IDLE';
  if (kpiBatchLifecycleVal) {
    kpiBatchLifecycleVal.textContent = lifecycleState;
    kpiBatchLifecycleVal.className = 'kpi-value ' + (
      lifecycleState === 'COMPLETED' ? 'text-green' :
      lifecycleState === 'FAILED' ? 'text-red' :
      lifecycleState === 'INGESTING' || lifecycleState === 'PARSING' ? 'text-cyan' :
      'text-yellow'
    );
  }
  if (kpiBatchLifecycleSub) {
    kpiBatchLifecycleSub.textContent = currentBatch ? (currentBatch.run_name || currentBatch.batch_id.slice(0, 8)) : 'No active batch';
  }

  const throughput = currentBatch?.throughput_rpm != null ? Number(currentBatch.throughput_rpm).toFixed(1) : (totalGames > 0 ? '24.0' : '--');
  if (kpiThroughputVal) kpiThroughputVal.textContent = throughput;
  if (kpiThroughputSub) kpiThroughputSub.textContent = 'Replays per minute';

  const payloadMB = footprint?.payloadStorage?.totalBytes ? (footprint.payloadStorage.totalBytes / (1024 * 1024)).toFixed(1) + ' MB' : '-- MB';
  if (kpiStorageVal) kpiStorageVal.textContent = payloadMB;
  if (kpiStorageSub) {
    const buf = footprint?.tempSlpCount ?? 0;
    kpiStorageSub.textContent = `${buf} temp .slp buffer (${buf === 0 ? 'Purged' : 'Active'})`;
  }

  const disc = currentBatch?.discovered_count || 0;
  const proc = currentBatch?.processed_count || 0;
  const skip = currentBatch?.skipped_count || 0;
  const dedupRatio = disc > 0 ? ((proc / disc) * 100).toFixed(0) : (totalGames > 0 ? '100' : '--');
  if (kpiDedupVal) kpiDedupVal.textContent = `${dedupRatio}%`;
  if (kpiDedupSub) kpiDedupSub.textContent = currentBatch ? `${proc} committed / ${skip} cached` : 'Committed vs Skipped';

  const corrupt = audit.statusCounts?.FAILED_CORRUPT || 0;
  const failedDl = audit.statusCounts?.FAILED_DOWNLOAD || 0;
  const batchFailed = currentBatch ? (currentBatch.failed_count || 0) : (corrupt + failedDl);
  const integrityPct = (proc + batchFailed > 0) ? (((proc) / (proc + batchFailed)) * 100).toFixed(1) + '%' : '100%';
  if (kpiIntegrityVal) kpiIntegrityVal.textContent = integrityPct;
  if (kpiIntegritySub) kpiIntegritySub.textContent = `${batchFailed} corrupt / failed`;

  // 2. Ingestion Funnel Nodes
  if (stageLunarBadge) {
    const isIngesting = currentBatch && currentBatch.lifecycle_state === 'ingesting';
    stageLunarBadge.textContent = isIngesting ? 'DOWNLOADING' : 'STANDBY';
    stageLunarBadge.className = 'stage-badge ' + (isIngesting ? 'status-ready' : 'status-ok');
  }

  const tempCount = footprint?.tempSlpCount ?? pipeline.tempSlpCount ?? 0;
  if (stageBufferMetric) stageBufferMetric.textContent = `${tempCount} .slp files`;
  if (stageBufferBadge) {
    if (tempCount === 0) {
      stageBufferBadge.textContent = 'PURGED';
      stageBufferBadge.className = 'stage-badge status-clean';
      if (funnelStatusBadge) {
        funnelStatusBadge.textContent = 'OPTIMAL // ZERO ACCUMULATION';
        funnelStatusBadge.style.color = 'var(--accent-green)';
      }
    } else {
      stageBufferBadge.textContent = `${tempCount} BUFFERED`;
      stageBufferBadge.className = 'stage-badge status-ready';
      if (funnelStatusBadge) {
        funnelStatusBadge.textContent = 'ACTIVE INGESTION STREAM';
        funnelStatusBadge.style.color = 'var(--accent-cyan)';
      }
    }
  }

  if (stageParserBadge) {
    const isParsing = currentBatch && currentBatch.lifecycle_state === 'parsing';
    stageParserBadge.textContent = isParsing ? 'STREAMING' : 'READY';
    stageParserBadge.className = 'stage-badge ' + (isParsing ? 'status-ready' : 'status-clean');
  }

  if (stageSqliteMetric) stageSqliteMetric.textContent = `${totalGames} Indexed`;

  if (stagePayloadMetric && footprint?.payloadStorage) {
    stagePayloadMetric.textContent = `${footprint.payloadStorage.fileCount} payloads (${payloadMB})`;
  }

  // 3. Batch Execution & Audit Panel
  if (auditRunName) {
    auditRunName.textContent = currentBatch ? (currentBatch.run_name || currentBatch.batch_id.slice(0, 10)) : (pipeline.activeCheckpoint?.run_name || 'lunar_batch');
  }
  if (auditDownloaded) {
    auditDownloaded.textContent = (currentBatch ? currentBatch.discovered_count : (pipeline.activeCheckpoint?.total_downloaded || totalGames)).toLocaleString();
  }
  if (auditProcessed) {
    auditProcessed.textContent = (currentBatch ? currentBatch.processed_count : (pipeline.activeCheckpoint?.total_processed || totalGames)).toLocaleString();
  }
  if (auditSkipped) {
    auditSkipped.textContent = (currentBatch ? currentBatch.skipped_count : (pipeline.activeCheckpoint?.total_skipped || 0)).toLocaleString();
  }

  if (auditLogBox) {
    if (audit.recentFailures && audit.recentFailures.length > 0) {
      if (auditStatusPill) {
        auditStatusPill.textContent = `${audit.recentFailures.length} ISSUES LOGGED`;
        auditStatusPill.className = 'card-status-pill text-red';
      }
      auditLogBox.innerHTML = audit.recentFailures.map(f => {
        const shortId = f.replay_id ? f.replay_id.slice(0, 12) : 'Unknown';
        const msg = f.error_message || 'Corrupt UBJSON stream';
        return `<div class="audit-log-line"><span class="text-red">[${f.status}]</span> ${shortId}... - ${escapeHtml(msg)}</div>`;
      }).join('');
    } else {
      if (auditStatusPill) {
        auditStatusPill.textContent = 'ALL SYSTEMS NOMINAL';
        auditStatusPill.className = 'card-status-pill text-green';
      }
      auditLogBox.innerHTML = '<span class="t-dim">Zero corruption errors logged. Batch pipeline operating cleanly.</span>';
    }
  }

  // 4. Storage, Cache & Ingestion Telemetry (Right Sub-Panel)
  if (telemetryBatchPill) {
    telemetryBatchPill.textContent = currentBatch ? `Batch ${currentBatch.batch_id.slice(0, 8)}` : 'Global Scope';
  }
  if (telemetryPayloadCount) {
    telemetryPayloadCount.textContent = footprint?.payloadStorage?.fileCount ? footprint.payloadStorage.fileCount.toLocaleString() : '0';
  }
  if (telemetryPayloadSize) {
    telemetryPayloadSize.textContent = payloadMB;
  }
  if (telemetryBufferStatus) {
    telemetryBufferStatus.textContent = `${tempCount} (${tempCount === 0 ? 'Purged' : 'Active'})`;
    telemetryBufferStatus.className = 'footprint-val text-mono ' + (tempCount === 0 ? 'text-green' : 'text-yellow');
  }

  // Telemetry Meters
  const totalBatchItems = proc + skip + batchFailed;
  const committedPct = totalBatchItems > 0 ? ((proc / totalBatchItems) * 100).toFixed(0) : (totalGames > 0 ? '100' : '0');
  if (meterCommittedVal) meterCommittedVal.textContent = `${committedPct}%`;
  if (meterCommittedFill) meterCommittedFill.style.width = `${committedPct}%`;

  const skippedPct = totalBatchItems > 0 ? ((skip / totalBatchItems) * 100).toFixed(0) : '0';
  if (meterSkippedVal) meterSkippedVal.textContent = `${skippedPct}%`;
  if (meterSkippedFill) meterSkippedFill.style.width = `${skippedPct}%`;

  const failedPct = totalBatchItems > 0 ? ((batchFailed / totalBatchItems) * 100).toFixed(0) : '0';
  if (meterFailedVal) meterFailedVal.textContent = `${failedPct}%`;
  if (meterFailedFill) meterFailedFill.style.width = `${failedPct}%`;

  const rpmNum = parseFloat(throughput) || 0;
  const rpmClamped = Math.min(24, Math.max(0, rpmNum));
  const ratePct = ((rpmClamped / 24) * 100).toFixed(0);
  if (meterRateVal) meterRateVal.textContent = `${rpmNum.toFixed(1)} / 24 rpm`;
  if (meterRateFill) meterRateFill.style.width = `${ratePct}%`;

  if (lastSyncedTime) lastSyncedTime.textContent = 'Updated ' + new Date().toLocaleTimeString();
}

/**
 * Execute the active command via the SSE endpoint
 */
async function executeCommand() {
  if (isRunning) return;

  const args = getActiveCommandArgs();
  const commandStr = `node src/cli.js ${args.join(' ')}`;

  // Clear previous output and log command header
  terminalOutput.innerHTML = '';
  appendTerminalText(`\x1b[90m$ ${commandStr}\x1b[0m\n\n`);
  setExecutionState('running', 'RUNNING');

  // If tray is minimized, restore it to default so user sees live output
  if (trayState === 'min') {
    setTrayState('default');
  }

  // Poll pipeline metrics during batch ingestion runs
  if (args[0] === 'batch') {
    batchPollInterval = setInterval(() => {
      fetchDashboardTelemetry(true);
    }, 2500);
  }

  activeAbortController = new AbortController();

  try {
    const response = await fetch('/api/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ args }),
      signal: activeAbortController.signal,
    });

    if (!response.ok) {
      const err = await response.json();
      appendTerminalText(`\x1b[31m[Error] ${err.error || response.statusText}\x1b[0m\n`);
      setExecutionState('error', 'FAILED');
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop(); // Retain incomplete chunk

      for (const block of lines) {
        if (!block.trim()) continue;
        const line = block.replace(/^data:\s*/, '');
        try {
          const event = JSON.parse(line);
          if (event.type === 'stdout') {
            appendTerminalText(event.text);
          } else if (event.type === 'stderr') {
            appendTerminalText(`\x1b[31m${event.text}\x1b[0m`);
          } else if (event.type === 'error') {
            appendTerminalText(`\x1b[31m[Execution Error] ${event.message}\x1b[0m\n`);
          } else if (event.type === 'exit') {
            if (event.code === 0) {
              setExecutionState('completed', 'SUCCESS');
              appendTerminalText(`\n\x1b[32m✔ Process exited successfully (Code 0)\x1b[0m\n`);
              // Auto-refresh dashboard, history, and recent games
              fetchDashboardTelemetry(true);
              fetchBatchHistory();
              loadRecentGames();
            } else if (event.signal === 'SIGINT') {
              setExecutionState('error', 'ABORTED');
              appendTerminalText(`\n\x1b[33m⚠ Process aborted by user (SIGINT)\x1b[0m\n`);
            } else {
              setExecutionState('error', `EXIT ${event.code}`);
              appendTerminalText(`\n\x1b[31m✖ Process exited with code ${event.code}\x1b[0m\n`);
            }
          }
        } catch (_) {}
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      appendTerminalText(`\n\x1b[33m[Client] Connection aborted.\x1b[0m\n`);
    } else {
      appendTerminalText(`\n\x1b[31m[Fetch Error] ${err.message}\x1b[0m\n`);
    }
    setExecutionState('error', 'FAILED');
  } finally {
    if (batchPollInterval) {
      clearInterval(batchPollInterval);
      batchPollInterval = null;
    }
    activeAbortController = null;
    if (isRunning) setExecutionState('idle', 'IDLE');
  }
}

/**
 * Abort the running process
 */
async function abortCommand() {
  if (!isRunning) return;
  appendTerminalText(`\n\x1b[33m[Server] Sending SIGINT abort signal...\x1b[0m\n`);

  try {
    await fetch('/api/abort', { method: 'POST' });
  } catch (err) {
    console.error('Failed to dispatch abort:', err);
  }
}

/**
 * Initialize characters dropdown options from API
 */
async function loadCharacters() {
  try {
    const res = await fetch('/api/characters');
    if (!res.ok) return;
    const characters = await res.json();

    selectCharA.innerHTML = '';
    selectCharB.innerHTML = '';
    if (filterCharA) filterCharA.innerHTML = '<option value="" selected>Any Character</option>';
    if (filterCharB) filterCharB.innerHTML = '<option value="" selected>Any Opponent</option>';

    // Alphabetical sort for dropdown readability
    const sorted = [...characters].sort((a, b) => a.name.localeCompare(b.name));

    for (const char of sorted) {
      const alias = char.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const optA = new Option(char.name, alias);
      const optB = new Option(char.name, alias);

      if (char.name === 'Fox') optA.selected = true;
      if (char.name === 'Marth') optB.selected = true;

      selectCharA.add(optA);
      selectCharB.add(optB);

      if (filterCharA) filterCharA.add(new Option(char.name, alias));
      if (filterCharB) filterCharB.add(new Option(char.name, alias));
    }
  } catch (err) {
    console.warn('Failed to load characters:', err);
  }
}

/**
 * Initialize recent games dropdown from API
 */
async function loadRecentGames() {
  try {
    const res = await fetch('/api/recent-games');
    if (!res.ok) return;
    const games = await res.json();

    selectRecentGames.innerHTML = '<option value="">-- Choose from recent ingested matches --</option>';

    for (const g of games) {
      const dateStr = g.startAt ? new Date(g.startAt).toLocaleDateString() : 'Unknown';
      const playerStr = g.players.map(p => `${p.characterName} (${p.connectCode || 'Port ' + p.port})`).join(' vs ');
      const label = `[${dateStr}] ${g.stageName} - ${playerStr} (${g.durationSeconds?.toFixed(0)}s)`;
      const opt = new Option(label, g.gameId);
      selectRecentGames.add(opt);
    }
  } catch (err) {
    console.warn('Failed to load recent games:', err);
  }
}

// Event Listeners - Navigation
tabs.forEach(tab => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

// Matchup events
selectCharA.addEventListener('change', updateCommandPreview);
selectCharB.addEventListener('change', updateCommandPreview);
btnSwapChars.addEventListener('click', () => {
  const temp = selectCharA.value;
  selectCharA.value = selectCharB.value;
  selectCharB.value = temp;
  updateCommandPreview();
});

// Batch events
sliderBatchSize.addEventListener('input', (e) => {
  labelBatchSize.textContent = e.target.value;
  updateCommandPreview();
});
inputBatchCount.addEventListener('input', updateCommandPreview);
inputBatchRun.addEventListener('input', updateCommandPreview);
checkBatchContinuous.addEventListener('change', () => {
  inputBatchCount.disabled = checkBatchContinuous.checked;
  updateCommandPreview();
});

// Filter Accordion & Granular Controls
btnToggleFilters?.addEventListener('click', toggleFilterAccordion);
btnResetFilters?.addEventListener('click', resetFilters);

datePills.forEach(pill => {
  pill.addEventListener('click', () => setDatePreset(pill.dataset.preset));
});

filterStartDate?.addEventListener('input', () => {
  validateFilters();
  updateCommandPreview();
});
filterEndDate?.addEventListener('input', () => {
  validateFilters();
  updateCommandPreview();
});

filterP1Code?.addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase();
  validateFilters();
  updateCommandPreview();
});
filterP2Code?.addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase();
  validateFilters();
  updateCommandPreview();
});

filterSource?.addEventListener('change', () => {
  updateFilterBadge();
  updateCommandPreview();
});
filterCharA?.addEventListener('change', () => {
  updateFilterBadge();
  updateCommandPreview();
});
filterCharB?.addEventListener('change', () => {
  updateFilterBadge();
  updateCommandPreview();
});
filterStage?.addEventListener('change', () => {
  updateFilterBadge();
  updateCommandPreview();
});
filterMinDuration?.addEventListener('input', () => {
  updateFilterBadge();
  updateCommandPreview();
});

// History & Context Banner Controls
btnRefreshHistory?.addEventListener('click', fetchBatchHistory);
btnJumpLatest?.addEventListener('click', jumpToLatestBatch);

// Player events
inputPlayerCode.addEventListener('input', updateCommandPreview);
document.querySelectorAll('.tag-pill[data-fill]').forEach(pill => {
  pill.addEventListener('click', () => {
    inputPlayerCode.value = pill.dataset.fill;
    updateCommandPreview();
  });
});

// Game events
selectRecentGames.addEventListener('change', () => {
  if (selectRecentGames.value) {
    inputGameId.value = selectRecentGames.value;
    updateCommandPreview();
  }
});
inputGameId.addEventListener('input', updateCommandPreview);

// Status events
inputStatusRun.addEventListener('input', updateCommandPreview);

// Export events
document.querySelectorAll('input[name="format"]').forEach(radio => {
  radio.addEventListener('change', updateCommandPreview);
});
inputExportOut.addEventListener('input', updateCommandPreview);

// Custom events
inputCustomArgs.addEventListener('input', updateCommandPreview);

// Button actions
btnExecute.addEventListener('click', executeCommand);
btnAbort.addEventListener('click', abortCommand);

btnCopyCommand.addEventListener('click', () => {
  navigator.clipboard.writeText(commandPreviewEl.textContent);
  showToast('Command copied to clipboard! 📋');
});

btnCopyOutput.addEventListener('click', () => {
  navigator.clipboard.writeText(terminalOutput.innerText);
  showToast('Terminal output copied! 📋');
});

btnClearTerm.addEventListener('click', () => {
  terminalOutput.innerHTML = '<span class="t-dim">Console cleared.</span>\n';
});

// Console Tray Controls
btnTrayMin?.addEventListener('click', () => setTrayState('min'));
btnTrayDefault?.addEventListener('click', () => setTrayState('default'));
btnTrayMax?.addEventListener('click', () => setTrayState('max'));

// Dashboard Actions
btnRefreshDashboard?.addEventListener('click', () => fetchDashboardTelemetry(false));

// Empty State CTA
btnEmptyStartSync?.addEventListener('click', () => {
  switchTab('batch');
  sliderBatchSize.value = 100;
  labelBatchSize.textContent = '100';
  inputBatchCount.value = 1;
  checkBatchContinuous.checked = false;
  inputBatchCount.disabled = false;
  updateCommandPreview();
  btnExecute.focus();
  showToast('Ready! Click Run Command to start ingestion 🚀');
});

// Initial boot
loadCharacters().then(() => updateCommandPreview());
loadRecentGames();
fetchDashboardTelemetry();
fetchBatchHistory();
