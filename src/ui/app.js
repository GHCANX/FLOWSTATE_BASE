// Flowstate Browser Frontend Clientside App
import {
  CHARACTER_MAP,
  STAGE_ASSET_MAP,
  escapeHtml,
  ansiToHtml,
  getCharacterPortraitUrl,
  getCharacterInitials,
  getStageDetails
} from './utils.js';

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

// Live Spectator & Match Panel Elements
const formSpectate = document.getElementById('form-spectate');
const spectatorStatusBadge = document.getElementById('spectator-status-badge');
const spectatorStatusText = document.getElementById('spectator-status-text');
const broadcastKeyVal = document.getElementById('broadcast-key-val');
const btnCopyBroadcastKey = document.getElementById('btn-copy-broadcast-key');
const btnStartSpectator = document.getElementById('btn-start-spectator');
const btnStopSpectator = document.getElementById('btn-stop-spectator');
const chkAutoArchive = document.getElementById('chk-auto-archive');
const chkLunarUpload = document.getElementById('chk-lunar-upload');

// Slippi Account Elements
const slippiAccountBadge = document.getElementById('slippi-account-badge');
const slippiAccountStatus = document.getElementById('slippi-account-status');
const slippiLoginSection = document.getElementById('slippi-login-section');
const slippiProfileSection = document.getElementById('slippi-profile-section');
const slippiEmailInput = document.getElementById('slippi-email');
const slippiPasswordInput = document.getElementById('slippi-password');
const btnSlippiLogin = document.getElementById('btn-slippi-login');
const btnSlippiLogout = document.getElementById('btn-slippi-logout');
const slippiDisplayName = document.getElementById('slippi-display-name');
const slippiConnectCode = document.getElementById('slippi-connect-code');

// Broadcasters List Elements
const broadcastersCard = document.getElementById('broadcasters-card');
const broadcastersList = document.getElementById('broadcasters-list');
const broadcastersCount = document.getElementById('broadcasters-count');


const dashboardPanel = document.getElementById('dashboard-panel');
const liveMatchPanel = document.getElementById('live-match-panel');
const liveMatchBadge = document.getElementById('live-match-badge');
const liveMatchBadgeText = document.getElementById('live-match-badge-text');
const liveMatchStagePill = document.getElementById('live-match-stage-pill');
const matchWaitingState = document.getElementById('match-waiting-state');
const matchPregameState = document.getElementById('match-pregame-state');
const matchActiveCard = document.getElementById('match-active-card');
const matchStageBackdrop = document.getElementById('match-stage-backdrop');
const matchStageName = document.getElementById('match-stage-name');
const matchStageTag = document.getElementById('match-stage-tag');
const vsStageLabel = document.getElementById('vs-stage-label');

// Pre-Game Dashboard Elements
const pregameBroadcasterName = document.getElementById('pregame-broadcaster-name');
const pregameBroadcasterCode = document.getElementById('pregame-broadcaster-code');
const pregameStatusBadge = document.getElementById('pregame-status-badge');
const pregameStatusBadgeText = document.getElementById('pregame-status-badge-text');
const pregameStreamStatus = document.getElementById('pregame-stream-status');
const pregameChunkCounter = document.getElementById('pregame-chunk-counter');
const pregameThroughput = document.getElementById('pregame-throughput');
const pregameUptime = document.getElementById('pregame-uptime');
const pregameScannerDesc = document.getElementById('pregame-scanner-desc');

// Spectator Telemetry Card Elements
const spectatorHealthBadge = document.getElementById('spectator-health-badge');
const spectatorHealthText = document.getElementById('spectator-health-text');
const spectatorPacketCounter = document.getElementById('spectator-packet-counter');
const spectatorThroughputVal = document.getElementById('spectator-throughput-val');

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

    case 'spectate': {
      return ['spectate'];
    }

    case 'sprites': {
      const char = document.getElementById('sprites-char-select')?.value || 'fox';
      const move = document.getElementById('sprites-move-select')?.value || 'shine';
      return ['sprites', char, move];
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

  // Toggle Live Match Panel vs Telemetry Dashboard Panel
  if (tabKey === 'spectate') {
    if (liveMatchPanel) liveMatchPanel.classList.remove('hidden');
    if (dashboardPanel) dashboardPanel.classList.add('hidden');
  } else {
    if (liveMatchPanel) liveMatchPanel.classList.add('hidden');
    if (dashboardPanel) dashboardPanel.classList.remove('hidden');
  }

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

  if (currentTab === 'spectate') {
    terminalOutput.innerHTML = '';
    appendTerminalText(`\x1b[36m$ node src/cli.js spectate\x1b[0m\n\n`);
    if (trayState === 'min') {
      setTrayState('default');
    }
    appendTerminalText(`\x1b[90mConnecting to Slippi Cloud Broadcast Relay...\x1b[0m\n`);
    try {
      await startSpectatorSession();
      const specId = spectatorSessionState.spectatorId || spectatorSessionState.broadcastKey || 'active';
      appendTerminalText(`\x1b[32m✔ Cloud spectator session active! Spectator ID: ${specId}\x1b[0m\n`);
      appendTerminalText(`\x1b[90mInstructions: Open Slippi Launcher → Gameplay Broadcasts → Add Spectator ID → Start\x1b[0m\n`);
    } catch (err) {
      appendTerminalText(`\x1b[31m✖ Failed to start spectator session: ${err.message}\x1b[0m\n`);
    }
    return;
  }

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

// ==========================================================================
// Live Slippi Remote Spectator Module
// ==========================================================================

let spectatorSessionState = {
  status: 'IDLE',
  parserState: 'IDLE',
  broadcastKey: null,
  spectatorId: null,
  account: null,
  activeBroadcasts: [],
  currentBroadcastId: null,
  currentBroadcaster: null,
  currentGame: null,
  sessionStartTime: null,
  telemetry: null,
};

let pregameUptimeTimer = null;
let lastConsolePacketLog = 0;

let broadcastEventSource = null;
let broadcastPollTimer = null;

function updateSlippiAuthUI(account) {
  if (account && account.authenticated) {
    if (slippiLoginSection) slippiLoginSection.classList.add('hidden');
    if (slippiProfileSection) slippiProfileSection.classList.remove('hidden');
    if (slippiAccountStatus) slippiAccountStatus.textContent = 'CONNECTED';
    if (slippiAccountBadge) slippiAccountBadge.className = 'badge-status connected';
    if (slippiDisplayName) slippiDisplayName.textContent = account.displayName || account.email || 'Slippi User';
    if (slippiConnectCode) slippiConnectCode.textContent = account.connectCode || '';
    if (broadcastKeyVal) broadcastKeyVal.textContent = account.uid || 'NO SPECTATOR ID';
    if (btnCopyBroadcastKey) btnCopyBroadcastKey.disabled = !account.uid;
  } else {
    if (slippiLoginSection) slippiLoginSection.classList.remove('hidden');
    if (slippiProfileSection) slippiProfileSection.classList.add('hidden');
    if (slippiAccountStatus) slippiAccountStatus.textContent = 'NOT CONNECTED';
    if (slippiAccountBadge) slippiAccountBadge.className = 'badge-status idle';
    if (broadcastKeyVal) broadcastKeyVal.textContent = 'PLEASE SIGN IN';
    if (btnCopyBroadcastKey) btnCopyBroadcastKey.disabled = true;
  }
}

function renderBroadcastersList(broadcasts = []) {
  if (!broadcastersCard || !broadcastersList) return;
  if (!broadcasts || broadcasts.length === 0) {
    broadcastersCard.classList.add('hidden');
    return;
  }

  broadcastersCard.classList.remove('hidden');
  if (broadcastersCount) broadcastersCount.textContent = String(broadcasts.length);

  broadcastersList.innerHTML = '';
  for (const b of broadcasts) {
    const item = document.createElement('div');
    const isCurrent = b.broadcastId === spectatorSessionState.currentBroadcastId;
    item.className = `broadcaster-item ${isCurrent ? 'active' : ''}`;

    const info = document.createElement('div');
    info.className = 'broadcaster-info';

    const tag = document.createElement('span');
    tag.className = 'broadcaster-tag';
    tag.textContent = b.broadcaster?.displayName || 'Player';

    const code = document.createElement('span');
    code.className = 'broadcaster-code';
    code.textContent = b.broadcaster?.connectCode ? `(${b.broadcaster.connectCode})` : '';

    info.appendChild(tag);
    if (b.broadcaster?.connectCode) info.appendChild(code);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn-secondary btn-xs ${isCurrent ? 'btn-active' : ''}`;
    btn.textContent = isCurrent ? 'Watching ✓' : 'Watch Stream 👁';
    btn.disabled = isCurrent;
    btn.addEventListener('click', () => watchBroadcast(b.broadcastId));

    item.appendChild(info);
    item.appendChild(btn);
    broadcastersList.appendChild(item);
  }
}

async function watchBroadcast(broadcastId) {
  try {
    const res = await fetch('/api/broadcast/watch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ broadcastId }),
    });
    if (res.ok) {
      spectatorSessionState.currentBroadcastId = broadcastId;
      renderBroadcastersList(spectatorSessionState.activeBroadcasts);
      showToast('Switched to incoming stream! 📺');
    }
  } catch (err) {
    showToast(`Failed to switch stream: ${err.message}`);
  }
}

async function loginSlippiAccount() {
  const email = slippiEmailInput?.value?.trim();
  const password = slippiPasswordInput?.value;
  if (!email || !password) {
    showToast('Please enter Slippi email and password.');
    return;
  }

  if (btnSlippiLogin) btnSlippiLogin.disabled = true;
  try {
    const res = await fetch('/api/broadcast/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Login failed');
    }
    updateSlippiAuthUI(data);
    showToast(`Logged into Slippi as ${data.displayName || data.email}! 🎉`);
  } catch (err) {
    showToast(`Slippi Auth Error: ${err.message}`);
  } finally {
    if (btnSlippiLogin) btnSlippiLogin.disabled = false;
  }
}

async function logoutSlippiAccount() {
  if (btnSlippiLogout) btnSlippiLogout.disabled = true;
  try {
    await fetch('/api/broadcast/auth/logout', { method: 'POST' });
    if (slippiPasswordInput) slippiPasswordInput.value = '';
    updateSlippiAuthUI({ authenticated: false });
    showToast('Signed out of Slippi.');
  } catch (err) {
    showToast(`Logout error: ${err.message}`);
  } finally {
    if (btnSlippiLogout) btnSlippiLogout.disabled = false;
  }
}

function updateSpectatorUI(session) {
  if (!session) return;
  spectatorSessionState = { ...spectatorSessionState, ...session };
  const { status, spectatorId, broadcastKey, account, activeBroadcasts } = spectatorSessionState;
  const statusStr = (status || 'IDLE').toUpperCase();

  // 1. Account Info
  if (account) {
    updateSlippiAuthUI(account);
  }

  // 2. Status badge in Left Panel
  if (spectatorStatusText) spectatorStatusText.textContent = statusStr;
  if (spectatorStatusBadge) {
    spectatorStatusBadge.className = `badge-status ${statusStr.toLowerCase()}`;
  }

  // 3. Spectator ID display
  const effectiveKey = spectatorId || broadcastKey || account?.uid;
  if (broadcastKeyVal) {
    if (effectiveKey && effectiveKey !== 'NO ACTIVE SESSION') {
      broadcastKeyVal.textContent = effectiveKey;
      if (btnCopyBroadcastKey) btnCopyBroadcastKey.disabled = false;
    } else if (account?.authenticated) {
      broadcastKeyVal.textContent = account.uid || 'NO SPECTATOR ID';
      if (btnCopyBroadcastKey) btnCopyBroadcastKey.disabled = false;
    } else {
      broadcastKeyVal.textContent = 'PLEASE SIGN IN';
      if (btnCopyBroadcastKey) btnCopyBroadcastKey.disabled = true;
    }
  }

  // 4. Action buttons
  const isListeningOrActive = statusStr !== 'IDLE';
  if (btnStartSpectator) btnStartSpectator.disabled = isListeningOrActive;
  if (btnStopSpectator) btnStopSpectator.disabled = !isListeningOrActive;

  // 5. Broadcasters list
  if (Array.isArray(activeBroadcasts)) {
    renderBroadcastersList(activeBroadcasts);
  }

  // 6. Live telemetry update if present
  if (session.telemetry) {
    updateTelemetryUI(session.telemetry);
  }

  // 7. Update live match panel header badge if not in game
  if (statusStr !== 'IN_GAME' && liveMatchBadgeText && liveMatchBadge) {
    const badgeText = statusStr === 'LISTENING' ? 'LISTENING' : (statusStr === 'CONNECTED' || statusStr === 'MENUS_ACTIVE' ? 'CONNECTED' : 'WAITING FOR GAME');
    liveMatchBadgeText.textContent = badgeText;
    liveMatchBadge.className = `badge-status ${statusStr.toLowerCase()}`;
  }

  // 8. Determine match panel view state
  if (spectatorSessionState.currentGame) {
    renderLiveMatchCard(spectatorSessionState.currentGame);
  } else if (spectatorSessionState.currentBroadcastId || statusStr === 'CONNECTED' || statusStr === 'MENUS_ACTIVE' || spectatorSessionState.parserState === 'MENUS_ACTIVE') {
    showMatchPregameState();
  } else if (statusStr === 'IDLE' || statusStr === 'LISTENING') {
    showMatchWaitingState();
  }
}

function startPregameUptimeTimer() {
  if (pregameUptimeTimer) return;
  const startTime = spectatorSessionState.sessionStartTime
    ? new Date(spectatorSessionState.sessionStartTime).getTime()
    : Date.now();

  const updateUptime = () => {
    if (!pregameUptime) return;
    const elapsed = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
    const hrs = Math.floor(elapsed / 3600);
    const m = Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0');
    const s = (elapsed % 60).toString().padStart(2, '0');
    pregameUptime.textContent = hrs > 0 ? `${hrs}:${m}:${s}` : `${m}:${s}`;
  };

  updateUptime();
  pregameUptimeTimer = setInterval(updateUptime, 1000);
}

function stopPregameUptimeTimer() {
  if (pregameUptimeTimer) {
    clearInterval(pregameUptimeTimer);
    pregameUptimeTimer = null;
  }
}

function showMatchWaitingState() {
  stopPregameUptimeTimer();
  if (matchWaitingState) matchWaitingState.classList.remove('hidden');
  if (matchPregameState) matchPregameState.classList.add('hidden');
  if (matchActiveCard) matchActiveCard.classList.add('hidden');
  if (liveMatchStagePill) liveMatchStagePill.textContent = '--';
  const statusStr = (spectatorSessionState.status || 'IDLE').toUpperCase();
  if (liveMatchBadgeText) liveMatchBadgeText.textContent = statusStr === 'LISTENING' ? 'LISTENING' : 'WAITING FOR GAME';
  if (liveMatchBadge) liveMatchBadge.className = `badge-status ${statusStr.toLowerCase()}`;
}

function showMatchPregameState() {
  if (matchWaitingState) matchWaitingState.classList.add('hidden');
  if (matchActiveCard) matchActiveCard.classList.add('hidden');
  if (matchPregameState) matchPregameState.classList.remove('hidden');

  if (liveMatchStagePill) liveMatchStagePill.textContent = 'STAGE SELECT';
  if (liveMatchBadgeText) liveMatchBadgeText.textContent = 'PRE-GAME';
  if (liveMatchBadge) liveMatchBadge.className = 'badge-status connected';

  const broadcaster = spectatorSessionState.currentBroadcaster;
  if (pregameBroadcasterName) {
    pregameBroadcasterName.textContent = broadcaster?.displayName || 'Active Stream';
  }
  if (pregameBroadcasterCode) {
    pregameBroadcasterCode.textContent = broadcaster?.connectCode ? `(${broadcaster.connectCode})` : '';
  }

  const pState = spectatorSessionState.parserState || spectatorSessionState.status || 'CONNECTED';
  if (pregameStatusBadgeText) {
    pregameStatusBadgeText.textContent = 'Character Select / Stage Select in Progress — Awaiting Match Start (0x35)';
  }
  if (pregameStreamStatus) {
    pregameStreamStatus.textContent = pState === 'MENUS_ACTIVE' ? 'MENUS ACTIVE' : 'CONNECTED';
    pregameStreamStatus.className = 'pregame-metric-val status-accent';
  }

  startPregameUptimeTimer();
}

function updateTelemetryUI(telemetry) {
  if (!telemetry) return;
  const packetCount = telemetry.packetCount ?? telemetry.chunkCount ?? 0;
  const rawRate = telemetry.throughputKbps ?? telemetry.throughputRate ?? 0;
  const kbps = (typeof rawRate === 'number' ? rawRate : parseFloat(rawRate) || 0).toFixed(1);
  const parserState = telemetry.parserState || telemetry.status || 'IDLE';

  // Update Spectator Session Card
  if (spectatorPacketCounter) {
    spectatorPacketCounter.textContent = packetCount.toLocaleString();
  }
  if (spectatorThroughputVal) {
    spectatorThroughputVal.textContent = `${kbps} KB/s`;
  }
  if (spectatorHealthBadge && spectatorHealthText) {
    const isOnline = spectatorSessionState.status !== 'IDLE';
    const isIngesting = packetCount > 0;
    spectatorHealthBadge.className = `badge-status ${isIngesting ? 'connected' : (isOnline ? 'listening' : 'idle')}`;
    spectatorHealthText.textContent = isIngesting
      ? (parserState === 'IN_GAME' ? 'IN GAME' : (parserState === 'MENUS_ACTIVE' ? 'MENUS ACTIVE' : 'STREAMING'))
      : (isOnline ? 'LISTENING' : 'OFFLINE');
  }

  // Update Pre-Game Dashboard
  if (pregameChunkCounter) {
    pregameChunkCounter.textContent = packetCount.toLocaleString();
  }
  if (pregameThroughput) {
    pregameThroughput.textContent = `${kbps} KB/s`;
  }
  if (pregameStreamStatus) {
    const formattedParserState = parserState === 'MENUS_ACTIVE'
      ? 'MENUS ACTIVE'
      : (parserState === 'CONNECTED_TO_STREAM' ? 'CONNECTED' : parserState);
    pregameStreamStatus.textContent = formattedParserState;
  }

  if (packetCount === 0 || packetCount < lastConsolePacketLog) {
    lastConsolePacketLog = 0;
  }

  // Console tray logging for real-time stream ingestion telemetry
  if (packetCount > 0 && (packetCount - lastConsolePacketLog >= 100 || (lastConsolePacketLog === 0 && packetCount >= 1))) {
    lastConsolePacketLog = packetCount;
    const totalKb = (((telemetry.totalBytes || telemetry.byteCount || 0)) / 1024).toFixed(1);
    appendTerminalText(`\x1b[90m[Stream Telemetry] Ingested ${packetCount} chunks (${totalKb} KB) @ ${kbps} KB/s — Parser: ${parserState}\x1b[0m\n`);
  }
}

function renderLiveMatchCard(game) {
  if (!game) return;
  spectatorSessionState.currentGame = game;
  stopPregameUptimeTimer();

  const stageInfo = getStageDetails(game.stageId, game.stageName);

  // Update stage pill in header
  if (liveMatchStagePill) {
    liveMatchStagePill.textContent = `${stageInfo.name} - ${stageInfo.legal ? 'LEGAL' : 'NON-LEGAL'}`;
  }

  // Update Live Match badge
  if (liveMatchBadgeText) liveMatchBadgeText.textContent = 'IN GAME';
  if (liveMatchBadge) liveMatchBadge.className = 'badge-status in_game';

  // Backdrop
  if (matchStageBackdrop) {
    matchStageBackdrop.style.backgroundImage = `url('/assets/stages/${stageInfo.file}')`;
  }

  // Meta bar
  if (matchStageName) matchStageName.textContent = stageInfo.name;
  if (matchStageTag) {
    matchStageTag.textContent = stageInfo.legal ? 'LEGAL' : 'NON-LEGAL';
    matchStageTag.className = `stage-legal-tag ${stageInfo.legal ? '' : 'non-legal'}`;
  }
  if (vsStageLabel) vsStageLabel.textContent = stageInfo.name;

  // Players
  const players = Array.isArray(game.players) ? game.players : [];
  const p1 = players[0] || { port: 1, characterId: 2, characterName: 'Fox', costumeIndex: 0, connectCode: '--', displayName: 'Player 1' };
  const p2 = players[1] || { port: 2, characterId: 9, characterName: 'Marth', costumeIndex: 0, connectCode: '--', displayName: 'Player 2' };

  renderPlayerSlot(1, p1);
  renderPlayerSlot(2, p2);

  // Switch to State B
  if (matchWaitingState) matchWaitingState.classList.add('hidden');
  if (matchPregameState) matchPregameState.classList.add('hidden');
  if (matchActiveCard) matchActiveCard.classList.remove('hidden');
}

function renderPlayerSlot(slotNum, player) {
  const cardEl = document.getElementById(`p${slotNum}-card`);
  const portEl = document.getElementById(`p${slotNum}-port`);
  const codeEl = document.getElementById(`p${slotNum}-code`);
  const nametagEl = document.getElementById(`p${slotNum}-nametag`);
  const charNameEl = document.getElementById(`p${slotNum}-char-name`);
  const imgEl = document.getElementById(`p${slotNum}-portrait-img`);
  const fallbackEl = document.getElementById(`p${slotNum}-fallback-avatar`);

  let portNum = player.port ?? slotNum;
  if (portNum === 0) portNum = 1;
  if (portEl) {
    portEl.textContent = `PORT ${portNum}`;
    portEl.className = `port-badge port-${portNum}`;
  }

  if (cardEl) {
    cardEl.className = `player-match-card player-${slotNum} port-${portNum}`;
  }

  if (codeEl) {
    codeEl.textContent = player.connectCode || 'LOCAL';
  }

  const charName = player.characterName || CHARACTER_MAP[player.characterId]?.name || 'Unknown';
  const displayName = player.displayName || player.nametag || charName;

  if (nametagEl) nametagEl.textContent = displayName;
  if (charNameEl) charNameEl.textContent = charName;

  const initials = CHARACTER_MAP[player.characterId]?.initials || `P${slotNum}`;
  if (fallbackEl) {
    fallbackEl.textContent = initials;
    fallbackEl.style.display = 'none';
  }

  if (imgEl) {
    imgEl.style.display = 'block';
    const costumeIdx = player.costumeIndex ?? player.characterColor ?? 0;
    const portraitUrl = getCharacterPortraitUrl(player.characterId, costumeIdx);
    imgEl.src = portraitUrl;
    imgEl.onerror = () => {
      imgEl.style.display = 'none';
      if (fallbackEl) fallbackEl.style.display = 'flex';
    };
  }
}

async function startSpectatorSession() {
  const autoArchive = chkAutoArchive ? chkAutoArchive.checked : true;
  const lunarUpload = chkLunarUpload ? chkLunarUpload.checked : true;
  lastConsolePacketLog = 0;
  if (btnStartSpectator) btnStartSpectator.disabled = true;
  try {
    const res = await fetch('/api/broadcast/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoArchive, lunarUpload }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to start session');
    }
    updateSpectatorUI(data);
    const specId = data.spectatorId || data.broadcastKey || 'active';
    showToast(`Spectator session listening! Spectator ID: ${specId} 📡`);
  } catch (err) {
    console.error('Failed to start spectator session:', err);
    showToast(`Error: ${err.message}`);
    if (btnStartSpectator) btnStartSpectator.disabled = false;
  }
}

async function stopSpectatorSession() {
  if (btnStopSpectator) btnStopSpectator.disabled = true;
  try {
    const res = await fetch('/api/broadcast/session', {
      method: 'DELETE',
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to stop session');
    }
    lastConsolePacketLog = 0;
    stopPregameUptimeTimer();
    updateSpectatorUI({
      status: 'IDLE',
      parserState: 'IDLE',
      broadcastKey: null,
      currentBroadcastId: null,
      currentBroadcaster: null,
      currentGame: null,
      telemetry: { packetCount: 0, chunkCount: 0, byteCount: 0, totalBytes: 0, throughputKbps: 0, throughputRate: 0, parserState: 'IDLE', status: 'IDLE' },
    });
    showMatchWaitingState();
    appendTerminalText('\x1b[31m[Broadcast Service] Session stopped.\x1b[0m\n');
    showToast('Spectator session stopped.');
  } catch (err) {
    console.error('Failed to stop spectator session:', err);
    showToast(`Error: ${err.message}`);
    if (btnStopSpectator) btnStopSpectator.disabled = false;
  }
}

function copyBroadcastKey() {
  const key = spectatorSessionState.broadcastKey || broadcastKeyVal?.textContent;
  if (!key || key === 'NO ACTIVE SESSION') return;

  const setFeedback = () => {
    if (!btnCopyBroadcastKey) return;
    const originalText = btnCopyBroadcastKey.innerHTML;
    btnCopyBroadcastKey.textContent = 'Copied! ✓';
    showToast('Broadcast key copied to clipboard! 📋');
    setTimeout(() => {
      btnCopyBroadcastKey.innerHTML = originalText;
    }, 2000);
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(key).then(setFeedback).catch(() => {
      fallbackCopy(key);
      setFeedback();
    });
  } else {
    fallbackCopy(key);
    setFeedback();
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (_) {}
  document.body.removeChild(ta);
}

function connectBroadcastSSE() {
  if (broadcastEventSource) {
    try { broadcastEventSource.close(); } catch (_) {}
  }

  broadcastEventSource = new EventSource('/api/broadcast/events');

  broadcastEventSource.onopen = () => {
    if (broadcastPollTimer) {
      clearInterval(broadcastPollTimer);
      broadcastPollTimer = null;
    }
  };

  broadcastEventSource.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleBroadcastEvent(msg);
    } catch (err) {
      console.warn('[SSE] Error parsing broadcast event:', err);
    }
  };

  broadcastEventSource.onerror = () => {
    if (!broadcastPollTimer) {
      pollBroadcastSession();
      broadcastPollTimer = setInterval(pollBroadcastSession, 4000);
    }
  };
}

function handleBroadcastEvent(msg) {
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case 'session': {
      updateSpectatorUI(msg);
      break;
    }
    case 'telemetry': {
      updateTelemetryUI(msg.data || msg);
      break;
    }
    case 'menuActive': {
      spectatorSessionState.status = 'MENUS_ACTIVE';
      spectatorSessionState.parserState = 'MENUS_ACTIVE';
      if (!spectatorSessionState.currentGame) {
        showMatchPregameState();
      }
      appendTerminalText(`\x1b[33m[Broadcaster] Character Select / Stage Select in Progress (Menus Active)\x1b[0m\n`);
      break;
    }
    case 'statusChange': {
      updateSpectatorUI(msg);
      appendTerminalText(`\x1b[34m[Broadcast Status] State: ${msg.status} (Parser: ${msg.parserState || msg.status})\x1b[0m\n`);
      break;
    }
    case 'broadcastsUpdated': {
      const list = Array.isArray(msg.data) ? msg.data : (Array.isArray(msg.broadcasts) ? msg.broadcasts : []);
      spectatorSessionState.activeBroadcasts = list;
      renderBroadcastersList(list);
      break;
    }
    case 'archiveComplete': {
      const gameId = msg.gameId ? `${msg.gameId.slice(0, 8)}...` : 'match';
      const isUploaded = Boolean(msg.uploaded || (msg.uploadResult && !msg.uploadResult.error));
      const dest = isUploaded ? 'Archived & Uploaded to Lunar Melee' : 'Archived to SQLite';
      showToast(`📦 Match ${gameId}: ${dest}`);
      break;
    }
    case 'archiveError': {
      showToast(`⚠️ Archive failed: ${msg.error || 'Unknown error'}`);
      break;
    }
    case 'gameStart': {
      const gameData = msg.data || msg;
      updateSpectatorUI({ status: 'IN_GAME', parserState: 'IN_GAME', currentGame: gameData });
      renderLiveMatchCard(gameData);
      const pSummary = (gameData.players || []).map(p => `${p.displayName || 'Player'} (${p.characterName || 'Char'})`).join(' vs ');
      appendTerminalText(`\x1b[32m[Match Start] GAME_START detected on ${gameData.stageName || 'Stage'} — ${pSummary}\x1b[0m\n`);
      showToast(`Live match started on ${gameData.stageName || 'Stage'}! ⚔️`);
      break;
    }
    case 'gameEnd': {
      spectatorSessionState.currentGame = null;
      const isStillConnected = Boolean(
        spectatorSessionState.currentBroadcastId ||
        (spectatorSessionState.status !== 'IDLE' && spectatorSessionState.status !== 'LISTENING')
      );
      if (msg.reason === 'relay_disconnect') {
        appendTerminalText(`\x1b[31m[Stream Disconnect] Broadcaster stream connection lost.\x1b[0m\n`);
        showToast('Live stream disconnected.');
      } else if (msg.reason === 'broadcast-ended') {
        appendTerminalText(`\x1b[33m[Stream Ended] Broadcaster terminated stream.\x1b[0m\n`);
        showToast('Broadcaster ended the stream.');
      } else {
        appendTerminalText(`\x1b[36m[Match End] GAME_END detected (0x39). Resetting parser for next game.\x1b[0m\n`);
        showToast('Live match ended. Auto-archived stats to SQLite. Ready for next game! 🎮');
      }

      if (isStillConnected && msg.reason !== 'relay_disconnect' && msg.reason !== 'broadcast-ended') {
        spectatorSessionState.status = 'CONNECTED';
        spectatorSessionState.parserState = 'MENUS_ACTIVE';
        updateSpectatorUI(spectatorSessionState);
        showMatchPregameState();
      } else {
        updateSpectatorUI({ status: spectatorSessionState.status || 'LISTENING', currentGame: null });
        showMatchWaitingState();
      }
      break;
    }
  }
}

async function pollBroadcastSession() {
  try {
    const res = await fetch('/api/broadcast/session');
    if (res.ok) {
      const session = await res.json();
      updateSpectatorUI(session);
    }
  } catch (_) {}
}

function initSpectatorService() {
  btnStartSpectator?.addEventListener('click', startSpectatorSession);
  btnStopSpectator?.addEventListener('click', stopSpectatorSession);
  btnCopyBroadcastKey?.addEventListener('click', copyBroadcastKey);
  btnSlippiLogin?.addEventListener('click', loginSlippiAccount);
  btnSlippiLogout?.addEventListener('click', logoutSlippiAccount);

  slippiPasswordInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loginSlippiAccount();
  });
  slippiEmailInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') slippiPasswordInput?.focus();
  });

  // Initial fetch and start SSE listener
  pollBroadcastSession();
  connectBroadcastSSE();
}

const CHARACTER_MOVES = {
  fox: [
    { id: 'shine', label: 'Reflector (Shine)', ident: 'REFLECTOR_GROUND_STARTUP', state: 360 },
    { id: 'usmash', label: 'Up Smash', ident: 'ATTACK_USMASH', state: 63 },
    { id: 'dair', label: 'Down Aerial (Drill)', ident: 'ATTACK_AIR_LW', state: 69 },
    { id: 'blaster', label: 'Blaster', ident: 'BLASTER_GROUND_STARTUP', state: 341 },
  ],
  falco: [
    { id: 'dair', label: 'Down Aerial', ident: 'ATTACK_AIR_LW', state: 69 },
    { id: 'laser', label: 'Blaster (Laser)', ident: 'BLASTER_GROUND_STARTUP', state: 341 },
    { id: 'shine', label: 'Reflector (Shine)', ident: 'REFLECTOR_GROUND_STARTUP', state: 360 },
  ],
  marth: [
    { id: 'fair', label: 'Forward Aerial', ident: 'ATTACK_AIR_F', state: 66 },
    { id: 'fsmash', label: 'Forward Smash', ident: 'ATTACK_S4_START', state: 58 },
    { id: 'dtilt', label: 'Down Tilt', ident: 'DOWNTILT', state: 57 },
  ],
  sheik: [
    { id: 'fair', label: 'Forward Aerial', ident: 'ATTACK_AIR_F', state: 66 },
    { id: 'needles', label: 'Needle Storm', ident: 'NEEDLE_STORM_GROUND_START_CHARGE', state: 341 },
  ],
  captainfalcon: [
    { id: 'knee', label: 'Forward Aerial (The Knee)', ident: 'ATTACK_AIR_F', state: 66 },
    { id: 'falcon_punch', label: 'Falcon Punch', ident: 'FALCON_PUNCH_GROUND', state: 347 },
  ],
  peach: [
    { id: 'turnip', label: 'Vegetable (Turnip Pull)', ident: 'VEGETABLE_GROUND', state: 352 },
  ],
  jigglypuff: [
    { id: 'rest', label: 'Rest', ident: 'REST', state: 369 },
    { id: 'bair', label: 'Back Aerial', ident: 'ATTACK_AIR_B', state: 67 },
  ],
  samus: [
    { id: 'charge_shot', label: 'Charge Shot', ident: 'CHARGE_SHOT', state: 341 },
    { id: 'missile', label: 'Missile', ident: 'MISSILE', state: 347 },
  ]
};

function initSpriteViewer() {
  const charSelect = document.getElementById('sprites-char-select');
  const moveSelect = document.getElementById('sprites-move-select');
  const spriteImg = document.getElementById('sprite-preview-img');
  const metaChar = document.getElementById('sprite-meta-char');
  const metaMove = document.getElementById('sprite-meta-move');
  const metaIdent = document.getElementById('sprite-meta-ident');
  const metaState = document.getElementById('sprite-meta-state');

  if (!charSelect || !moveSelect) return;

  function updateMoveOptions() {
    const char = charSelect.value;
    const moves = CHARACTER_MOVES[char] || [
      { id: 'nair', label: 'Neutral Air', ident: 'ATTACK_AIR_N', state: 65 },
      { id: 'fair', label: 'Forward Air', ident: 'ATTACK_AIR_F', state: 66 },
      { id: 'fsmash', label: 'Forward Smash', ident: 'ATTACK_S4_START', state: 58 }
    ];

    moveSelect.innerHTML = '';
    moves.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.label;
      moveSelect.appendChild(opt);
    });

    renderSelectedSprite();
  }

  function renderSelectedSprite() {
    const char = charSelect.value;
    const move = moveSelect.value;
    const moves = CHARACTER_MOVES[char] || [];
    const meta = moves.find(m => m.id === move) || { label: move, ident: 'ATTACK', state: 'Active' };

    if (spriteImg) {
      spriteImg.src = `/api/sprites/${char}/${move}`;
    }
    if (metaChar) metaChar.textContent = charSelect.options[charSelect.selectedIndex]?.text || char;
    if (metaMove) metaMove.textContent = meta.label;
    if (metaIdent) metaIdent.textContent = meta.ident;
    if (metaState) metaState.textContent = `ActionState: ${meta.state}`;

    updateCommandPreview();
  }

  charSelect.addEventListener('change', updateMoveOptions);
  moveSelect.addEventListener('change', renderSelectedSprite);

  updateMoveOptions();
}

initSpectatorService();
initSpriteViewer();


