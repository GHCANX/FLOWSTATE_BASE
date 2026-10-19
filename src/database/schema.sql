-- FlowState Melee Analysis Engine Database Schema

-- 1. Checkpoint Tracker for Sliding-Window Ingestion
CREATE TABLE IF NOT EXISTS ingestion_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_name TEXT NOT NULL,
    current_year INTEGER NOT NULL,
    current_date TEXT NOT NULL,
    current_page INTEGER NOT NULL DEFAULT 1,
    last_processed_replay_id TEXT,
    total_downloaded INTEGER NOT NULL DEFAULT 0,
    total_processed INTEGER NOT NULL DEFAULT 0,
    total_failed INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (DATETIME('now'))
);

-- 1b. Multi-Batch Run Tracker & Lifecycle States
CREATE TABLE IF NOT EXISTS batch_runs (
    batch_id TEXT PRIMARY KEY,
    run_name TEXT NOT NULL,
    lifecycle_state TEXT NOT NULL,         -- 'queued', 'ingesting', 'parsing', 'storing', 'caching', 'completed', 'failed'
    filter_criteria TEXT,                  -- JSON string of applied filters
    batch_size INTEGER NOT NULL DEFAULT 100,
    discovered_count INTEGER NOT NULL DEFAULT 0,
    downloaded_count INTEGER NOT NULL DEFAULT 0,
    processed_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    storage_bytes INTEGER NOT NULL DEFAULT 0,
    throughput_rpm REAL,
    started_at TEXT NOT NULL DEFAULT (DATETIME('now')),
    completed_at TEXT,
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_batch_runs_started ON batch_runs(started_at DESC);

-- 2. Audit Log / Per-Replay Status
CREATE TABLE IF NOT EXISTS replay_status (
    replay_id TEXT PRIMARY KEY,
    file_hash TEXT UNIQUE,
    source TEXT NOT NULL,                  -- 'lunar_api', 'local_test'
    status TEXT NOT NULL,                  -- 'COMPLETED', 'FAILED_CORRUPT', 'FAILED_DOWNLOAD'
    error_message TEXT,
    processed_at TEXT NOT NULL DEFAULT (DATETIME('now'))
);

-- 3. Compact Match Metadata
CREATE TABLE IF NOT EXISTS games (
    game_id TEXT PRIMARY KEY,              -- Lunar replay ID or file hash
    lunar_replay_id TEXT UNIQUE,
    file_hash TEXT NOT NULL UNIQUE,
    slp_version TEXT,
    start_at TEXT NOT NULL,                -- ISO-8601 UTC timestamp
    duration_frames INTEGER NOT NULL,
    duration_seconds REAL NOT NULL,
    stage_id INTEGER NOT NULL,
    game_mode INTEGER NOT NULL,            -- 2 = VS, 8 = Online
    is_teams BOOLEAN NOT NULL DEFAULT 0,
    winner_port INTEGER,
    end_method INTEGER,                    -- 1 = TIME, 2 = GAME, 7 = NO CONTEST
    lras_port INTEGER,                     -- Port who rage-quit (-1 if normal)
    payload_path TEXT NOT NULL,            -- Relative path to .json.gz payload
    created_at TEXT NOT NULL DEFAULT (DATETIME('now'))
);

CREATE INDEX IF NOT EXISTS idx_games_start_at ON games(start_at);
CREATE INDEX IF NOT EXISTS idx_games_stage ON games(stage_id);

-- 4. Player Profiles in Game
CREATE TABLE IF NOT EXISTS game_players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
    player_index INTEGER NOT NULL,         -- 0 to 3
    port INTEGER NOT NULL,                 -- 1 to 4
    character_id INTEGER NOT NULL,
    costume_index INTEGER NOT NULL,
    connect_code TEXT,                     -- e.g. 'MANG#0'
    display_name TEXT,
    nametag TEXT,
    user_id TEXT,
    start_stocks INTEGER NOT NULL DEFAULT 4,
    end_stocks INTEGER NOT NULL,
    placement INTEGER,
    is_winner BOOLEAN NOT NULL DEFAULT 0,
    UNIQUE(game_id, player_index)
);

CREATE INDEX IF NOT EXISTS idx_players_connect_code ON game_players(connect_code);
CREATE INDEX IF NOT EXISTS idx_players_char ON game_players(character_id);

-- 5. High-Level Performance Aggregates
CREATE TABLE IF NOT EXISTS player_overall_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
    player_index INTEGER NOT NULL,
    inputs_total INTEGER NOT NULL,
    ipm REAL NOT NULL,
    digital_ipm REAL NOT NULL,
    neutral_win_ratio REAL,
    counter_hit_ratio REAL,
    beneficial_trade_ratio REAL,
    openings_per_kill REAL,
    damage_per_opening REAL,
    total_damage_dealt REAL NOT NULL,
    kill_count INTEGER NOT NULL,
    conversion_count INTEGER NOT NULL,
    UNIQUE(game_id, player_index)
);

-- 6. Granular Competitive Mechanics Execution (20+ Techs)
CREATE TABLE IF NOT EXISTS player_mechanics_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
    player_index INTEGER NOT NULL,
    -- L-Canceling
    l_cancel_success INTEGER NOT NULL DEFAULT 0,
    l_cancel_fail INTEGER NOT NULL DEFAULT 0,
    l_cancel_rate REAL,
    -- Movement & Landings
    wavedash_count INTEGER NOT NULL DEFAULT 0,
    waveland_count INTEGER NOT NULL DEFAULT 0,
    dash_dance_turns INTEGER NOT NULL DEFAULT 0,
    dash_dance_strings INTEGER NOT NULL DEFAULT 0,
    edge_cancels INTEGER NOT NULL DEFAULT 0,
    -- Ledge & Recovery
    ledge_grabs INTEGER NOT NULL DEFAULT 0,
    ledgedash_count INTEGER NOT NULL DEFAULT 0,
    avg_galint_frames REAL,
    -- Defense & Platform
    shield_drops INTEGER NOT NULL DEFAULT 0,
    crouch_cancels INTEGER NOT NULL DEFAULT 0,
    amsah_techs INTEGER NOT NULL DEFAULT 0,
    v_cancels INTEGER NOT NULL DEFAULT 0,
    slide_offs INTEGER NOT NULL DEFAULT 0,
    powershields_physical INTEGER NOT NULL DEFAULT 0,
    powershields_projectile INTEGER NOT NULL DEFAULT 0,
    -- Out of Shield Choices
    oos_grabs INTEGER NOT NULL DEFAULT 0,
    oos_aerials INTEGER NOT NULL DEFAULT 0,
    oos_smashes INTEGER NOT NULL DEFAULT 0,
    oos_wavedashes INTEGER NOT NULL DEFAULT 0,
    oos_rolls INTEGER NOT NULL DEFAULT 0,
    oos_spotdodges INTEGER NOT NULL DEFAULT 0,
    -- Teching
    tech_neutral INTEGER NOT NULL DEFAULT 0,
    tech_in INTEGER NOT NULL DEFAULT 0,
    tech_away INTEGER NOT NULL DEFAULT 0,
    tech_miss INTEGER NOT NULL DEFAULT 0,
    wall_tech_success INTEGER NOT NULL DEFAULT 0,
    wall_tech_miss INTEGER NOT NULL DEFAULT 0,
    -- Advanced Micro
    sdi_inputs INTEGER NOT NULL DEFAULT 0,
    phantom_hits INTEGER NOT NULL DEFAULT 0,
    float_cancels INTEGER NOT NULL DEFAULT 0,
    jc_grabs INTEGER NOT NULL DEFAULT 0,
    boost_grabs INTEGER NOT NULL DEFAULT 0,
    multishines INTEGER NOT NULL DEFAULT 0,
    UNIQUE(game_id, player_index)
);

CREATE INDEX IF NOT EXISTS idx_mech_game ON player_mechanics_stats(game_id);

-- 7. Behavioral Habits & Vulnerability Profiling
CREATE TABLE IF NOT EXISTS player_habits_stats (
    game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
    player_index INTEGER NOT NULL,
    connect_code TEXT,
    character_id INTEGER NOT NULL,
    is_complete BOOLEAN NOT NULL DEFAULT 1,

    -- Ledge Options (10 counters)
    climb_count INTEGER NOT NULL DEFAULT 0,
    climb_punished INTEGER NOT NULL DEFAULT 0,
    attack_count INTEGER NOT NULL DEFAULT 0,
    attack_punished INTEGER NOT NULL DEFAULT 0,
    roll_count INTEGER NOT NULL DEFAULT 0,
    roll_punished INTEGER NOT NULL DEFAULT 0,
    jump_count INTEGER NOT NULL DEFAULT 0,
    jump_punished INTEGER NOT NULL DEFAULT 0,
    ledgedash_count INTEGER NOT NULL DEFAULT 0,
    ledgedash_punished INTEGER NOT NULL DEFAULT 0,

    -- Ground Tech Options (8 counters)
    tech_neutral_count INTEGER NOT NULL DEFAULT 0,
    tech_neutral_punished INTEGER NOT NULL DEFAULT 0,
    tech_forward_count INTEGER NOT NULL DEFAULT 0,
    tech_forward_punished INTEGER NOT NULL DEFAULT 0,
    tech_back_count INTEGER NOT NULL DEFAULT 0,
    tech_back_punished INTEGER NOT NULL DEFAULT 0,
    tech_miss_count INTEGER NOT NULL DEFAULT 0,
    tech_miss_punished INTEGER NOT NULL DEFAULT 0,

    -- Missed-Tech Wakeup Options (8 counters)
    wakeup_stand_count INTEGER NOT NULL DEFAULT 0,
    wakeup_stand_punished INTEGER NOT NULL DEFAULT 0,
    wakeup_forward_count INTEGER NOT NULL DEFAULT 0,
    wakeup_forward_punished INTEGER NOT NULL DEFAULT 0,
    wakeup_back_count INTEGER NOT NULL DEFAULT 0,
    wakeup_back_punished INTEGER NOT NULL DEFAULT 0,
    wakeup_attack_count INTEGER NOT NULL DEFAULT 0,
    wakeup_attack_punished INTEGER NOT NULL DEFAULT 0,

    -- Grab Triggers (3 counters)
    grabs_shield_pressure INTEGER NOT NULL DEFAULT 0,
    grabs_scramble INTEGER NOT NULL DEFAULT 0,
    grabs_neutral INTEGER NOT NULL DEFAULT 0,

    -- Transitions & Advantage Commitment (2 counters)
    neutral_resets INTEGER NOT NULL DEFAULT 0,
    over_extensions INTEGER NOT NULL DEFAULT 0,

    -- Out of Shield Choices & Stage Control (9 counters)
    oos_roll_count INTEGER NOT NULL DEFAULT 0,
    oos_roll_punished INTEGER NOT NULL DEFAULT 0,
    oos_spotdodge_count INTEGER NOT NULL DEFAULT 0,
    oos_spotdodge_punished INTEGER NOT NULL DEFAULT 0,
    oos_grab_count INTEGER NOT NULL DEFAULT 0,
    oos_grab_punished INTEGER NOT NULL DEFAULT 0,
    oos_aerial_count INTEGER NOT NULL DEFAULT 0,
    oos_aerial_punished INTEGER NOT NULL DEFAULT 0,
    corner_drift_count INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (game_id, player_index)
);

CREATE INDEX IF NOT EXISTS idx_habits_connect_code ON player_habits_stats(connect_code);
CREATE INDEX IF NOT EXISTS idx_habits_char ON player_habits_stats(character_id);

