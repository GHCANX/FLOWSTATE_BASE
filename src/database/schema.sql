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
