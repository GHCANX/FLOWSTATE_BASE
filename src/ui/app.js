// Flowstate Browser Frontend Clientside App
let currentTab = 'matchup';
let isRunning = false;
let executionStartTime = null;
let timerInterval = null;
let activeAbortController = null;

// Tray State
let trayState = 'default'; // 'min', 'default', 'max'
let batchPollInterval = null;

// DOM Elements
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

// Dashboard Elements
const dashboardEmpty = document.getElementById('dashboard-empty');
const dashboardLoading = document.getElementById('dashboard-loading');
const dashboardContent = document.getElementById('dashboard-content');
const btnRefreshDashboard = document.getElementById('btn-refresh-dashboard');
const lastSyncedTime = document.getElementById('last-synced-time');
const btnEmptyStartSync = document.getElementById('btn-empty-start-sync');

// KPI Elements
const kpiGamesVal = document.getElementById('kpi-games-val');
const kpiGamesSub = document.getElementById('kpi-games-sub');
const kpiHealthVal = document.getElementById('kpi-health-val');
const kpiHealthSub = document.getElementById('kpi-health-sub');
const kpiCheckpointVal = document.getElementById('kpi-checkpoint-val');
const kpiCheckpointSub = document.getElementById('kpi-checkpoint-sub');
const kpiLcancelVal = document.getElementById('kpi-lcancel-val');
const kpiLcancelSub = document.getElementById('kpi-lcancel-sub');
const kpiWavedashVal = document.getElementById('kpi-wavedash-val');
const kpiWavedashSub = document.getElementById('kpi-wavedash-sub');

// Funnel Elements
const stageBufferMetric = document.getElementById('stage-buffer-metric');
const stageBufferBadge = document.getElementById('stage-buffer-badge');
const stageSqliteMetric = document.getElementById('stage-sqlite-metric');
const funnelStatusBadge = document.getElementById('funnel-status-badge');

// Audit Elements
const auditStatusPill = document.getElementById('audit-status-pill');
const auditRunName = document.getElementById('audit-run-name');
const auditDownloaded = document.getElementById('audit-downloaded');
const auditProcessed = document.getElementById('audit-processed');
const auditFailed = document.getElementById('audit-failed');
const auditLogBox = document.getElementById('audit-log-box');
const topCharsPill = document.getElementById('top-chars-pill');

// Mechanical Benchmarks Elements
const meterLcancelVal = document.getElementById('meter-lcancel-val');
const meterLcancelFill = document.getElementById('meter-lcancel-fill');
const meterDashVal = document.getElementById('meter-dash-val');
const meterDashFill = document.getElementById('meter-dash-fill');
const meterWavedashVal = document.getElementById('meter-wavedash-val');
const meterWavedashFill = document.getElementById('meter-wavedash-fill');
const meterIpmVal = document.getElementById('meter-ipm-val');
const meterIpmFill = document.getElementById('meter-ipm-fill');

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
      return args;
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
    btnExecute.disabled = false;
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
 * Fetch and update dashboard telemetry across the 3 split endpoints
 * @param {boolean} [silent=false]
 */
async function fetchDashboardTelemetry(silent = false) {
  if (!silent && btnRefreshDashboard) {
    btnRefreshDashboard.classList.add('refreshing');
  }

  try {
    const [pipelineRes, mechanicsRes, auditRes] = await Promise.all([
      fetch('/api/pipeline/status'),
      fetch('/api/analytics/mechanics'),
      fetch('/api/audit/errors'),
    ]);

    if (!pipelineRes.ok || !mechanicsRes.ok || !auditRes.ok) {
      console.warn('Dashboard endpoints returned non-ok status');
      return;
    }

    const pipeline = await pipelineRes.json();
    const mechanics = await mechanicsRes.json();
    const audit = await auditRes.json();

    renderDashboardData(pipeline, mechanics, audit);
  } catch (err) {
    console.warn('Failed to fetch dashboard telemetry:', err);
  } finally {
    if (!silent && btnRefreshDashboard) {
      setTimeout(() => btnRefreshDashboard.classList.remove('refreshing'), 400);
    }
  }
}

/**
 * Render telemetry data into dashboard DOM
 */
function renderDashboardData(pipeline, mechanics, audit) {
  const totalGames = pipeline.totalGames || 0;

  if (totalGames === 0) {
    dashboardEmpty?.classList.remove('hidden');
    dashboardContent?.classList.add('hidden');
    dashboardLoading?.classList.add('hidden');
    return;
  }

  dashboardEmpty?.classList.add('hidden');
  dashboardContent?.classList.remove('hidden');
  dashboardLoading?.classList.add('hidden');

  // 1. KPI Cards
  if (kpiGamesVal) kpiGamesVal.textContent = totalGames.toLocaleString();
  if (kpiGamesSub) kpiGamesSub.textContent = 'Committed to SQLite';

  const completed = audit.statusCounts?.COMPLETED || 0;
  const corrupt = audit.statusCounts?.FAILED_CORRUPT || 0;
  const failedDl = audit.statusCounts?.FAILED_DOWNLOAD || 0;
  const totalAudit = completed + corrupt + failedDl;
  const healthRate = totalAudit > 0 ? ((completed / totalAudit) * 100).toFixed(1) : '100.0';
  if (kpiHealthVal) kpiHealthVal.textContent = `${healthRate}%`;
  if (kpiHealthSub) kpiHealthSub.textContent = `${corrupt + failedDl} failed / ${completed} done`;

  const cp = pipeline.activeCheckpoint;
  if (cp) {
    if (kpiCheckpointVal) kpiCheckpointVal.textContent = `${cp.current_year} | P.${cp.current_page}`;
    if (kpiCheckpointSub) kpiCheckpointSub.textContent = `Run: ${cp.run_name}`;
    if (auditRunName) auditRunName.textContent = cp.run_name;
    if (auditDownloaded) auditDownloaded.textContent = (cp.total_downloaded || 0).toLocaleString();
    if (auditProcessed) auditProcessed.textContent = (cp.total_processed || 0).toLocaleString();
    if (auditFailed) auditFailed.textContent = (cp.total_failed || 0).toLocaleString();
  } else {
    if (kpiCheckpointVal) kpiCheckpointVal.textContent = 'Standby';
    if (kpiCheckpointSub) kpiCheckpointSub.textContent = 'No active cursor';
    if (auditRunName) auditRunName.textContent = 'lunar_batch';
    if (auditDownloaded) auditDownloaded.textContent = totalGames.toString();
    if (auditProcessed) auditProcessed.textContent = totalGames.toString();
    if (auditFailed) auditFailed.textContent = '0';
  }

  // 2. Funnel Nodes
  const tempCount = pipeline.tempSlpCount || 0;
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

  if (stageSqliteMetric) stageSqliteMetric.textContent = `${totalGames} Games Indexed`;

  // 3. Audit Log
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

  // 4. Character summary pill
  if (topCharsPill && mechanics.topCharacters && mechanics.topCharacters.length > 0) {
    topCharsPill.textContent = 'Top: ' + mechanics.topCharacters.slice(0, 3).map(c => c.characterName).join(', ');
  }

  // 5. Mechanical benchmarks
  const mech = mechanics.mechanics || {};
  const overall = mechanics.overall || {};

  const lCancelRate = mech.avg_l_cancel_rate != null ? Number(mech.avg_l_cancel_rate).toFixed(1) : '0.0';
  if (kpiLcancelVal) kpiLcancelVal.textContent = `${lCancelRate}%`;
  if (meterLcancelVal) meterLcancelVal.textContent = `${lCancelRate}%`;
  if (meterLcancelFill) meterLcancelFill.style.width = `${Math.min(100, Math.max(0, parseFloat(lCancelRate)))}%`;

  const dashTurns = mech.avg_dash_turns != null ? Number(mech.avg_dash_turns).toFixed(1) : '0.0';
  if (meterDashVal) meterDashVal.textContent = `${dashTurns} turns`;
  const dtPct = Math.min(100, Math.max(4, (parseFloat(dashTurns) / 50) * 100));
  if (meterDashFill) meterDashFill.style.width = `${dtPct}%`;

  const wavedashes = mech.avg_wavedashes != null ? Number(mech.avg_wavedashes).toFixed(1) : '0.0';
  if (kpiWavedashVal) kpiWavedashVal.textContent = `${wavedashes}`;
  if (meterWavedashVal) meterWavedashVal.textContent = `${wavedashes}`;
  const wdPct = Math.min(100, Math.max(4, (parseFloat(wavedashes) / 30) * 100));
  if (meterWavedashFill) meterWavedashFill.style.width = `${wdPct}%`;

  const ipm = overall.avg_ipm != null ? Number(overall.avg_ipm).toFixed(0) : '0';
  if (meterIpmVal) meterIpmVal.textContent = `${ipm} IPM`;
  const ipmPct = Math.min(100, Math.max(4, (parseFloat(ipm) / 600) * 100));
  if (meterIpmFill) meterIpmFill.style.width = `${ipmPct}%`;

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
      fetch('/api/pipeline/status')
        .then(r => r.ok ? r.json() : null)
        .then(p => {
          if (p && p.activeCheckpoint) {
            const cp = p.activeCheckpoint;
            if (kpiCheckpointVal) kpiCheckpointVal.textContent = `${cp.current_year} | P.${cp.current_page}`;
            if (stageBufferMetric) stageBufferMetric.textContent = `${p.tempSlpCount || 0} .slp files`;
          }
        })
        .catch(() => {});
    }, 3000);
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
              // Auto-refresh dashboard and recent games
              fetchDashboardTelemetry(true);
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

// Event Listeners
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

// Player events
inputPlayerCode.addEventListener('input', updateCommandPreview);
document.querySelectorAll('.tag-pill').forEach(pill => {
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

// Empty State CTA: switch to batch ingestion, set defaults, and pulse run button
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
