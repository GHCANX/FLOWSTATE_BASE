---
name: melee-tactical-interpreter
description: >-
  Interpret macro gameplay, punish games, edgeguarding sequences, shield pressure,
  behavioral habit profiling, getup distributions, offensive grab triggers,
  over-extension boundaries, and win-probability momentum in Super Smash Bros. Melee replays.
  Use when analyzing match flow, detecting clips, evaluating neutral openings, tracking
  recovery denial, scoring highlights, or profiling tactical habits.
---

# Melee Tactical Interpreter Skill Guide

This skill translates raw frame data, spatial coordinates, and player action states into high-level tactical insights, competitive habit profiles, risk-reward metrics, and precise event classifications.

---

## 1. Neutral Wins, Combos, and Conversions

### Combos vs. Conversions
- **Combo (`ComboComputer`)**:
  - Starts when opponent enters hitstun (`0x4B`–`0x61`), grab (`0xD4`–`0xDF`), or command grab (`0x10A`–`0x130`, `0x147`–`0x152`).
  - Records each distinct move landed (`moveId`, damage, hit count).
  - Resets when opponent is out of damage/stun/tumble/tech/down for **more than 45 frames** (`COMBO_STRING_RESET_FRAMES`).
- **Conversion (`ConversionComputer`)**:
  - Represents an entire punish sequence from neutral to advantage, including reset reads, missed tech punishes, and tech chases.
  - Terminates when opponent regains grounded/airborne control (`isInControl`) for 45+ frames or loses a stock.
  - **Opening Classification**:
    - `"neutral-win"`: Opponent was in control and not in an active combo prior to the opening hit.
    - `"counter-attack"`: Player hit the opponent while recovering from opponent's prior conversion window.
    - `"trade"`: Both players landed hits within the same frame window.

---

## 2. Edgeguarding & Recovery Denial Algorithm

Derived from LunarMelee Clipper's validated edgeguard parser (`external/lm-clipper-master/src/models/methods/edgeguard.ts`).

### Stage Geometry Bounds (Legal Stages)
Coordinates are centered at $X = 0$, stage surface at $Y \approx 0$.

| Stage | ID | `ground.xMax` | `ledgeGrab` ($+2.91$) | Blastzone $(L, R, T, B)$ |
|---|---|---|---|---|
| Fountain of Dreams | 2 | 63.35 | 66.26 | $(-198.8, 198.8, 202.5, -146.3)$ |
| Pokémon Stadium | 3 | 87.75 | 90.66 | $(-230.0, 230.0, 180.0, -111.0)$ |
| Yoshi's Story | 8 | 56.00 | 58.91 | $(-175.7, 173.6, 168.0, -91.0)$ |
| Dream Land N64 | 28 | 77.27 | 80.18 | $(-255.0, 255.0, 250.0, -123.0)$ |
| Battlefield | 31 | 68.40 | 71.31 | $(-224.0, 224.0, 200.0, -108.8)$ |
| Final Destination | 32 | 85.57 | 88.47 | $(-246.0, 246.0, 188.0, -140.0)$ |

### Character 99th-Percentile Recovery Ranges
Empirical distances (world units from ledge) a character can physically recover from:
- **Fox**: 95 | **Falco**: 95 | **Marth**: 90 | **Sheik**: 90 | **Captain Falcon**: 95
- **Peach**: 95 | **Jigglypuff**: 95 | **Samus**: 100 | **Pikachu**: 100 | **Luigi**: 80
- **Ice Climbers**: 75 | **Ganondorf**: 90 | **Dr. Mario**: 75 | **Default**: 95

### Core Edgeguard Rules
1. **Launch Hit**: The clip starts with the hit that sends the victim offstage ($|X| > \text{ground.xMax}$).
2. **Actionable Recovery Boundary**: From death, walk backwards to find the launch. The victim must not have recovered (landed in control on stage or hung on ledge) prior to death.
3. **Recovery Attempt Requirement**: Victim must have triggered at least one recovery action while offstage (double jump, air dodge, up-B/side-B special).
4. **The Denial Test**:
   - Hit denial (`blockedByHit`): An incoming hit connects **only while the victim is within their character's recovery range of the ledge**. (Prevents counting random chip damage way out in the blastzone).
   - Ledge-steal denial (`ledgeSteal`): Attacker occupies the ledge while the victim is in recovery range.
5. **Forced Landing Reads**: If the victim dies near center or off the top, `stageTouches >= 1` is required to verify the victim was forced onto the stage from offstage and punished.

---

## 3. Shield Pressure & Advantage States

Derived from `external/lm-clipper-master/src/models/methods/pressure.ts`.

### Advantage Evaluation Model
Continuous advantage is calculated each frame:
- **Defender States**:
  - Shielding: `0xB2`–`0xB6` (`GUARD_ON` through `GUARD_REFLECT`).
  - Scrambling: rolls/spotdodge/airdodge (`0xE9`–`0xEC`), tech/down (`0xB7`–`0xCC`), ledge hang (`0xFC`–`0xFD`).
  - Hitstun: `0x4B`–`0x61` or `DAMAGE_FALL` (`0x26`).
- **Attacker Offense**:
  - Active attacks/grabs/specials (`0x2C`–`0x45`, `0xD4`–`0xDF`, specials $\ge 341$).
  - Proximity: Euclidean distance $\sqrt{(X_A - X_D)^2 + (Y_A - Y_D)^2} < 30$ units.
- **Metrics Extracted**:
  - `shieldHits`: Number of distinct attack landings into shield.
  - `shieldFrames`: Duration defender held shield under close-range threat.
  - `openings`: Frame where shield pressure cracked into a true hit or shield-poke/grab.
  - `endedInKill`: Whether the sequence culminated in a stock conversion.

---

## 4. Phantom Hits (Glancing Blows)

Derived from `external/lm-clipper-master/src/models/methods/phantom.ts`.

A phantom hit occurs when an attack hitbox barely touches a hurtbox (overlap $< 0.01$ units).
### The Two Invariant Signatures:
1. **Asymmetric Hitlag**:
   - The defender freezes in hitlag (`defender.post.hitlagRemaining > 0`).
   - The attacker is **NOT** frozen (`attacker.post.hitlagRemaining === 0`) and continues their animation.
2. **Delayed Half-Damage**:
   - The attack deals half standard damage.
   - Zero damage is dealt during the freeze frames; percent increases only on the frame the defender's hitlag expires.

---

## 5. Win Probability, Momentum, & Highlights

Derived from `external/lm-clipper-master/src/models/methods/highlight.ts`.

### Effective Stock Win Probability Proxy
$$effStocks = stocksRemaining - \min\left(\frac{percent}{150}, 1.0\right)$$
$$\Delta effStocks = effStocks_{\text{killer}} - effStocks_{\text{victim}}$$
$$P(\text{win}) = \frac{1}{1 + e^{-1.15 \cdot \Delta effStocks}}$$

### Highlight Flavors:
- **Comeback Swing**: Scored when a player with $P(\text{win}) < 0.38$ reverses the lead and wins.
- **Tension Standoff**: Both players at kill percent ($> 85\%$) on decisive stocks, measuring duration in neutral before the game-winning blow.
- **Clutch**: Both players on their final stock ($1\text{v}1$, game point).
- **Spectacle**: Multi-move 0-to-deaths (starts $< 20\%$, ends in kill), deep offstage gimps ($< 60\%$), and spike/meteor finishes.

---

## 6. Behavioral Habit & Tactical Vulnerability Profiling Engine

The behavioral habit profiling engine quantifies player decision patterns, recovery distributions, risk profiles, and vulnerability tendencies on a frame-by-frame basis using exact mathematical formulas and unambiguous heuristic thresholds.

### 6.1 Defensive Recovery & Getup Habits Profiling

#### Ledge Option Distribution & Ledgedash Heuristic
When a player hangs on the ledge (`CLIFF_WAIT` `0xFD` / 253), their recovery choices are partitioned into standard ledge options and advanced ledgedashes:
1. **Standard Ledge Options**:
   - **Climb**: `CLIFF_CLIMB_SLOW` (`0xFE` / 254) or `CLIFF_CLIMB_QUICK` (`0xFF` / 255) $\to$ `climb_count`.
   - **Attack**: `CLIFF_ATTACK_SLOW` (`0x100` / 256) or `CLIFF_ATTACK_QUICK` (`0x101` / 257) $\to$ `attack_count`.
   - **Roll / Escape**: `CLIFF_ESCAPE_SLOW` (`0x102` / 258) or `CLIFF_ESCAPE_QUICK` (`0x103` / 259) $\to$ `roll_count`.
   - **Jump**: `CLIFF_JUMP_SLOW` (`0x104` / 260) or `CLIFF_JUMP_QUICK` (`0x105` / 261) $\to$ `jump_count`.
2. **35-Frame Ledgedash Heuristic**:
   - **Trigger**: Player is in `CLIFF_WAIT` (`0xFD` / 253) at frame $t_{\text{wait}}$, drops or jumps, air dodges toward the stage, and enters `LANDING_FALL_SPECIAL` (`0x29` / 41) at frame $t_{\text{land}}$.
   - **Timing Condition**: $t_{\text{land}} - t_{\text{wait}} \le 35$ frames ($\le 0.583$ s).
   - **Stage Surface Constraint**: The landing coordinate must be contained within the legal stage bounds:
     $$|X_{\text{land}}| \le \text{ground.xMax}$$
   - **Permitted Intermediate Airborne States**: Only airborne states are permitted between ledge drop and landing:
     - `FALL` (`0x1D` / 29)
     - `JUMP_F` (`0x19` / 25) or `JUMP_B` (`0x1A` / 26)
     - `AIR_DODGE` (`0xEC` / 236)
   - **Disqualification Conditions**:
     - Player re-grabs the ledge (`CLIFF_CATCH` `0xFC` / 252) prior to landing.
     - Player enters hitstun or damage (`isDamage(anim)` or percent increases) prior to landing.
   - **Counter**: On successful match, increments `ledgedash_count`.

#### Ground Tech Option Distribution
Tracked on state transitions following knockdown/tumble:
- `TECH_NEUTRAL` (`0xC7` / 199) $\to$ `tech_neutral_count`.
- `TECH_F` (`0xC8` / 200) $\to$ `tech_forward_count`.
- `TECH_B` (`0xC9` / 201) $\to$ `tech_back_count`.
- `WALL_TECH` (`0xCA` / 202) $\to$ tracked in mechanics.
- Missed Tech: `TECH_MISS_UP` (`0xB7` / 183) or `TECH_MISS_DOWN` (`0xBF` / 191) $\to$ `tech_miss_count`.

#### Missed-Tech Wakeup Option Distribution
Tracked when waking up from grounded downed states `DOWN_WAIT_U` (`0xB8` / 184) or `DOWN_WAIT_D` (`0xC0` / 192):
- **Neutral Stand**: `DOWN_STAND_U` (`0xB9` / 185) or `DOWN_STAND_D` (`0xC1` / 193) $\to$ `wakeup_stand_count`.
- **Roll Forward**: `DOWN_FORWARD_U` (`0xBA` / 186) or `DOWN_FORWARD_D` (`0xC2` / 194) $\to$ `wakeup_forward_count`.
- **Roll Backward**: `DOWN_BACK_U` (`0xBB` / 187) or `DOWN_BACK_D` (`0xC3` / 195) $\to$ `wakeup_back_count`.
- **Getup Attack**: `DOWN_ATTACK_U` (`0xBC` / 188) or `DOWN_ATTACK_D` (`0xC4` / 196) $\to$ `wakeup_attack_count`.

#### Strict 30-Frame Post-Actionable Punish Classification Rule
Every getup, tech, wakeup, or out-of-shield option is tracked through a dual-phase vulnerability window:
1. **Phase 1 (Animation End-Lag)**: The vulnerable frames of the option animation after any intangibility expires.
2. **Phase 2 (Post-Actionable Recovery Window)**: A strict **30-frame (0.50 s)** window starting immediately when the player enters an actionable state (e.g. `WAIT` `0x0E`, `DASH` `0x14`).
3. **Punish Classification Logic**:
   - If the player takes damage (`percent > prevPercent`) or enters hitstun (`isDamage(anim)`):
     - **Counter-Hit Check**: If the player landed an offensive hit on the opponent *prior* to taking damage within this window, the sequence is classified as a successful counter-hit and is **NOT** marked as punished.
     - If the player takes damage without landing a counter-hit first, the option is flagged as **punished**, incrementing the corresponding `*_punished` counter (e.g., `climb_punished`, `attack_punished`, `roll_punished`, `jump_punished`, `ledgedash_punished`, `tech_neutral_punished`, `tech_forward_punished`, `tech_back_punished`, `tech_miss_punished`, `wakeup_stand_punished`, `wakeup_forward_punished`, `wakeup_back_punished`, `wakeup_attack_punished`, `oos_roll_punished`, `oos_spotdodge_punished`, `oos_grab_punished`, `oos_aerial_punished`).
   - If 30 frames elapse post-actionable without damage taken, the option expires cleanly unpunished.

---

### 6.2 Offensive Transitions & Commitment Profiles

#### Action State Numeric Matching
In `@slippi/slippi-js`, action states are numeric integers:
- Grounded attacks, tilts, smashes, dash attacks, and aerials: integer values `44` to `69` (`0x2C` through `0x45`).
- Character specials: integer values $\ge 341$.
- Attack commitment predicate:
  $$(ID \ge 44 \land ID \le 69) \lor ID \ge 341 \quad \Longleftrightarrow \quad (ID \ge 0\text{x}2C \land ID \le 0\text{x}45) \lor ID \ge 341$$

#### Grab Initiation Context & Triggers
When a player initiates a grab (`GRAB` `0xD4` / 212 or `DASH_GRAB` `0xD6` / 214 with `anim !== prevAnim`), the initiation context is partitioned into three mutually exclusive categories:
1. **Shield-Pressure Grab**:
   - Initiated when the opponent has been in shield (`isShield(oppAnim)`) within $\le 15$ frames, or opponent shielded an incoming attack $\le 15$ frames prior.
   - Metric: Increments `grabs_shield_pressure`.
2. **Scramble Grab**:
   - Initiated when both players are simultaneously actionable (neither in hitstun, tumble, shield, or uninterruptible animations),
   - Euclidean separation distance satisfies:
     $$D = \sqrt{(X_1 - X_2)^2 + (Y_1 - Y_2)^2} \le 18.0 \text{ world units}$$
   - AND clean history: neither player has been in hitstun (`isDamage`) or shield (`isShield`) within the preceding 30 frames ($[t - 30, t]$).
   - Metric: Increments `grabs_scramble`.
3. **Neutral Setup Grab**:
   - Initiated from neutral spacing ($D > 18.0$ world units) via dash-grab or jump-in without prior shield contact within 15 frames.
   - Metric: Increments `grabs_neutral`.

#### Neutral Reset vs. Over-Extension Boundary
Evaluated over a **45-frame window** following advantage neutralization (e.g. conversion termination where `resetTimer > 45`, or a blocked attack resolving with frame advantage $\le 0$):
1. **Neutral Reset**:
   - Player increases Euclidean distance from opponent:
     $$\Delta D = D_{\text{end}} - D_{\text{start}} > 0$$
   - Player executes a dash-dance away, waveland back, or defensive guard (shield / retreat).
   - Metric: Increments `neutral_resets`.
2. **Over-Extension**:
   - Player commits to an active attack (range `44`–`69` / `0x2C`–`0x45` or $\ge 341$), dashes directly forward toward the opponent ($\Delta D < 0$), or attempts a grab while the opponent is already actionable or in frame parity,
   - Resulting in a whiff (attack finishes without landing a hit) or taking counter-hit damage (`isDamage`).
   - Metric: Increments `over_extensions`.

---

### 6.3 Defensive Escape Habits & Out-Of-Shield (OOS) Options

#### OOS Option Breakdown
Tracked upon the first non-shield frame exiting `GUARD` (`0xB2`–`0xB6`):
- **Shield Grab**: `GRAB` (`0xD4` / 212) $\to$ `oos_grab_count`.
- **Up-Smash OOS**: `ATTACK_USMASH` (`0x3F` / 63) or via jumpsquat `ACTION_KNEE_BEND` (`0x18` / 24) canceling into up-smash $\to$ `oos_smashes`.
- **Aerial OOS**: Aerial attack state `0x41`–`0x45` (Nair, Fair, Bair, Uair, Dair) initiated out of jumpsquat `ACTION_KNEE_BEND` (`0x18`) $\to$ `oos_aerial_count`.
- **Roll Forward / Backward OOS**: `ROLL_FORWARD` (`0xE9` / 233) or `ROLL_BACKWARD` (`0xEA` / 234) $\to$ `oos_roll_count`.
- **Spotdodge OOS**: `SPOT_DODGE` (`0xEB` / 235) $\to$ `oos_spotdodge_count`.
- **Wavedash OOS**: `ACTION_KNEE_BEND` (`0x18`) $\to$ `AIR_DODGE` (`0xEC`) $\to$ `LANDING_FALL_SPECIAL` (`0x29`) $\to$ `oos_wavedashes`.
- **OOS Punish Tracking**: Monitored through the 30-frame post-actionable recovery window $\to$ `oos_grab_punished`, `oos_aerial_punished`, `oos_roll_punished`, `oos_spotdodge_punished`.

#### Corner Drift & Spatial Evasion Under Pressure
- **Definition**: Unforced directional drift toward the stage edge lip while under close proximity pressure from the opponent.
- **Heuristic Bounds**:
  1. Opponent proximity threat: Euclidean distance $D \le 20.0$ world units.
  2. Drift vector toward ledge: Player moves outward toward stage edge:
     $$|X_t| > |X_{t-1}| \quad \text{and} \quad |X_t| \to \text{ground.xMax} \quad (|X_t| \ge \text{ground.xMax} - 15.0)$$
  3. Unforced concession: Defender is not in hitstun, tumble, or shield stun.
- **Tactical Vulnerability Meaning**: Quantifies the rate of conceding stage control and backing into the corner without opponent offensive commitment.
- **Metric**: Increments `corner_drift_count`.

---

## 7. Analytical Querying, Rolling Aggregations & Storage Contracts

### 7.1 Rolling Aggregate SQL Formulas
To calculate rolling habit frequencies and punish rates across multiple matches, aggregations compute sums of raw numerators and denominators:

$$\text{Option Punish Rate} = \frac{\sum \text{punished}}{\sum \text{count}} \times 100$$

In SQLite, division by zero is safely guarded using `NULLIF(SUM(count), 0)`:
```sql
SELECT
    connect_code,
    COUNT(DISTINCT game_id) AS games_analyzed,
    SUM(climb_count) AS total_climbs,
    SUM(climb_punished) AS punished_climbs,
    SUM(climb_punished) * 1.0 / NULLIF(SUM(climb_count), 0) AS climb_punish_rate,
    SUM(attack_count) AS total_attacks,
    SUM(attack_punished) * 1.0 / NULLIF(SUM(attack_count), 0) AS attack_punish_rate,
    SUM(roll_count) AS total_rolls,
    SUM(roll_punished) * 1.0 / NULLIF(SUM(roll_count), 0) AS roll_punish_rate,
    SUM(jump_count) AS total_jumps,
    SUM(jump_punished) * 1.0 / NULLIF(SUM(jump_count), 0) AS jump_punish_rate,
    SUM(ledgedash_count) AS total_ledgedashes,
    SUM(ledgedash_punished) * 1.0 / NULLIF(SUM(ledgedash_count), 0) AS ledgedash_punish_rate,
    SUM(tech_neutral_count) AS tech_neutral_count,
    SUM(tech_neutral_punished) * 1.0 / NULLIF(SUM(tech_neutral_count), 0) AS tech_neutral_punish_rate,
    SUM(tech_forward_count) AS tech_forward_count,
    SUM(tech_forward_punished) * 1.0 / NULLIF(SUM(tech_forward_count), 0) AS tech_forward_punish_rate,
    SUM(tech_back_count) AS tech_back_count,
    SUM(tech_back_punished) * 1.0 / NULLIF(SUM(tech_back_count), 0) AS tech_back_punish_rate,
    SUM(tech_miss_count) AS tech_miss_count,
    SUM(tech_miss_punished) * 1.0 / NULLIF(SUM(tech_miss_count), 0) AS tech_miss_punish_rate,
    SUM(wakeup_stand_count) AS wakeup_stand_count,
    SUM(wakeup_stand_punished) * 1.0 / NULLIF(SUM(wakeup_stand_count), 0) AS wakeup_stand_punish_rate,
    SUM(wakeup_forward_count) AS wakeup_forward_count,
    SUM(wakeup_forward_punished) * 1.0 / NULLIF(SUM(wakeup_forward_count), 0) AS wakeup_forward_punish_rate,
    SUM(wakeup_back_count) AS wakeup_back_count,
    SUM(wakeup_back_punished) * 1.0 / NULLIF(SUM(wakeup_back_count), 0) AS wakeup_back_punish_rate,
    SUM(wakeup_attack_count) AS wakeup_attack_count,
    SUM(wakeup_attack_punished) * 1.0 / NULLIF(SUM(wakeup_attack_count), 0) AS wakeup_attack_punish_rate,
    SUM(grabs_shield_pressure) AS grabs_shield_pressure,
    SUM(grabs_scramble) AS grabs_scramble,
    SUM(grabs_neutral) AS grabs_neutral,
    SUM(neutral_resets) AS neutral_resets,
    SUM(over_extensions) AS over_extensions,
    SUM(oos_roll_count) AS oos_roll_count,
    SUM(oos_roll_punished) * 1.0 / NULLIF(SUM(oos_roll_count), 0) AS oos_roll_punish_rate,
    SUM(oos_spotdodge_count) AS oos_spotdodge_count,
    SUM(oos_spotdodge_punished) * 1.0 / NULLIF(SUM(oos_spotdodge_count), 0) AS oos_spotdodge_punish_rate,
    SUM(oos_grab_count) AS oos_grab_count,
    SUM(oos_grab_punished) * 1.0 / NULLIF(SUM(oos_grab_count), 0) AS oos_grab_punish_rate,
    SUM(oos_aerial_count) AS oos_aerial_count,
    SUM(oos_aerial_punished) * 1.0 / NULLIF(SUM(oos_aerial_count), 0) AS oos_aerial_punish_rate,
    SUM(corner_drift_count) AS corner_drift_count
FROM player_habits_stats phs
JOIN games g ON phs.game_id = g.game_id
JOIN game_players gp ON phs.game_id = gp.game_id AND phs.player_index = gp.player_index
LEFT JOIN game_players opp ON phs.game_id = opp.game_id AND opp.player_index != phs.player_index
WHERE phs.connect_code = ? AND phs.is_complete = 1
GROUP BY phs.connect_code;
```

### 7.2 Incomplete Match Filtering Invariant (`is_complete = 1`)
- **Completion Definition**: A match is marked `is_complete = 1` if:
  1. Duration $\ge 1800$ frames ($\ge 30$ seconds).
  2. Did not terminate via LRAS or No Contest (`end_method !== 7` and `lras_port === null || lras_port < 0`).
- **Rolling Queries Guarantee**: All rolling queries and scouting profile aggregations must enforce:
  $$\text{WHERE } \text{is\_complete} = 1$$
  Short matches ($< 30$s) and rage-quits are excluded to prevent skewed behavioral habit distributions.

### 7.3 Relational Multi-Factor Querying
Relational JOINs enable matchup-specific tactical scouting:
- `?opponentConnectCode=` $\to$ filters against `opp.connect_code = ?`
- `?characterId=` $\to$ filters against `phs.character_id = ?`
- `?opponentCharacterId=` $\to$ filters against `opp.character_id = ?`
- `?stageId=` $\to$ filters against `g.stage_id = ?`

### 7.4 Dual-Storage Habit Payload Architecture
Date-sharded `.json.gz` payloads store fine-grained event timelines:
```json
{
  "habits": {
    "getupEvents": [
      {
        "frame": 420,
        "playerIndex": 0,
        "category": "ledge",
        "option": "ledgedash",
        "actionStateId": 41,
        "positionX": 60.5,
        "positionY": 0.0,
        "isPunished": false,
        "punishFrame": null
      }
    ],
    "grabTriggers": [
      {
        "frame": 850,
        "playerIndex": 1,
        "type": "scramble",
        "distance": 14.2,
        "success": true
      }
    ],
    "transitionDecisions": [
      {
        "frame": 1200,
        "playerIndex": 0,
        "type": "over_extension",
        "actionStateId": 65,
        "distanceDelta": -5.3,
        "counterHit": true
      }
    ],
    "escapeSequences": [
      {
        "frame": 1540,
        "playerIndex": 1,
        "source": "oos",
        "option": "roll_f",
        "isPunished": true,
        "damageTaken": 12.0
      }
    ]
  }
}
```

### 7.5 Pipeline Scope Isolation
Telemetry integrity requires strict architectural separation:
- Ingestion and pipeline monitoring endpoints (`/api/pipeline/status`, `/api/batches`, `/api/storage/footprint`) strictly deliver infrastructure telemetry: throughput RPM, batch progress %, parse integrity errors, cache hit ratio, and compressed storage footprint.
- Player tactical habits and behavioral metrics must NEVER leak into ingestion telemetry views.
