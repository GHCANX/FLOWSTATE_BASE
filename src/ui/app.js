// Flowstate Browser Frontend Clientside App
let currentTab = 'matchup';
let isRunning = false;
let executionStartTime = null;
let timerInterval = null;
let activeAbortController = null;

// DOM Elements
const tabs = document.querySelectorAll('.tab-btn');
const forms = document.querySelectorAll('.command-form');
const commandPreviewEl = document.getElementById('command-preview-text');
const btnExecute = document.getElementById('btn-execute');
const btnAbort = document.getElementById('btn-abort');
const btnCopyCommand = document.getElementById('btn-copy-command');
const btnCopyOutput = document.getElementById('btn-copy-output');
const btnClearTerm = document.getElementById('btn-clear-term');
const terminalOutput = document.getElementById('terminal-output');
const terminalViewport = document.getElementById('terminal-viewport');
const executionBadge = document.getElementById('execution-badge');
const badgeText = document.getElementById('badge-text');
const executionTimer = document.getElementById('execution-timer');
const toastEl = document.getElementById('toast');

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

// Initial boot
loadCharacters().then(() => updateCommandPreview());
loadRecentGames();
