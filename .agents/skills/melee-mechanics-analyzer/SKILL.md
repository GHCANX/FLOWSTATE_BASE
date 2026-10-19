---
name: melee-mechanics-analyzer
description: >-
  Detect, evaluate, and quantify competitive Super Smash Bros. Melee mechanics
  from frame-by-frame Slippi replay data. Covers L-canceling, wavedashing,
  wavelanding, dash dancing, ledge options, GALINT, shield drops, crouch canceling,
  amsah teching, v-canceling, slide-off DI, powershielding, out-of-shield (OOS) options,
  smash DI (SDI), peach float cancels, JC grabs, spacie multishining, getup/wakeup habits,
  35-frame ledgedash heuristics, and 30-frame post-actionable punish tracking.
---

# Melee Mechanics Analyzer Skill Guide

This skill specifies the exact action states, controller inputs, frame deltas, state machine algorithms, and heuristic thresholds required to detect, quantify, and analyze competitive Melee mechanics and behavioral execution habits from frame-by-frame `.slp` data.

---

## 1. Action State IDs Reference

### Movement, Idle, & Special Landings
| Name | Hex | Dec | Description |
|---|---|---|---|
| `ACTION_WAIT` | `0x0E` | 14 | Standing actionable |
| `DASH` | `0x14` | 20 | Initial dash animation |
| `TURN` | `0x12` | 18 | Turning around |
| `RUN` | `0x15` | 21 | Full run |
| `ACTION_KNEE_BEND` | `0x18` | 24 | Jumpsquat startup (3–6 frames per character) |
| `JUMP_FORWARD` | `0x19` | 25 | Forward airborne jump |
| `JUMP_BACKWARD` | `0x1A` | 26 | Backward airborne jump |
| `FALL` | `0x1D` | 29 | Regular falling |
| `FALL_FORWARD` | `0x1E` | 30 | Forward airborne fall |
| `FALL_BACKWARD` | `0x1F` | 31 | Backward airborne fall |
| `FALL_SPECIAL` | `0x23` | 35 | Special fall (helpless freefall) |
| `LANDING_FALL_SPECIAL` | `0x29` | 41 | Landing in special fall (e.g. after air dodge / wavedash) |
| `PASS` | `0x27` | 39 | Platform drop-through |
| `TEETER` | `0xF5` | 245 | Ledge teetering |

### Attacks, Tilts, Smashes, & Aerials
| Name | Hex | Dec | Description |
|---|---|---|---|
| `ATTACK_11` | `0x2C` | 44 | Jab 1 (first grounded attack state) |
| `ATTACK_DASH` | `0x32` | 50 | Dash attack |
| `ATTACK_S4_START` | `0x3A` | 58 | Forward smash start |
| `ATTACK_HI4` | `0x3F` | 63 | Up-smash (`ATTACK_USMASH`) |
| `ATTACK_LW4` | `0x40` | 64 | Down-smash (`ATTACK_DSMASH`) |
| `ATTACK_AIR_N` | `0x41` | 65 | Neutral aerial (Nair) |
| `ATTACK_AIR_F` | `0x42` | 66 | Forward aerial (Fair) |
| `ATTACK_AIR_B` | `0x43` | 67 | Back aerial (Bair) |
| `ATTACK_AIR_HI` | `0x44` | 68 | Up aerial (Uair) |
| `ATTACK_AIR_LW` | `0x45` | 69 | Down aerial (Dair) |
| `LANDING_AIR_START` | `0x46` | 70 | Aerial landing lag start (Nair 70, Fair 71, Bair 72, Uair 73, Dair 74) |
| `CHARACTER_SPECIALS` | $\ge 341$ | $\ge 341$ | Character-specific neutral, side, up, and down specials |

> **Offensive Move Numeric Matcher**: In `@slippi/slippi-js`, action states are numeric. All offensive attacks (grounded attacks, tilts, smashes, dash attacks, aerials, and specials) match the predicate:
> `(id >= 0x2C && id <= 0x45) || id >= 341` (decimal `44` to `69` or $\ge 341$).

### Shields & Defensive Options
| Name | Hex | Dec | Description |
|---|---|---|---|
| `GUARD_ON` | `0xB2` | 178 | Shield startup (shield enter) |
| `GUARD` | `0xB3` | 179 | Shield hold |
| `GUARD_OFF` | `0xB4` | 180 | Shield release / drop |
| `GUARD_SET_OFF` | `0xB5` | 181 | Shield stun (hit while shielding) |
| `GUARD_REFLECT` | `0xB6` | 182 | Powershield physical/projectile reflection |
| `SPOT_DODGE` | `0xEB` | 235 | Grounded spotdodge |
| `ROLL_FORWARD` | `0xE9` | 233 | Grounded forward roll |
| `ROLL_BACKWARD` | `0xEA` | 234 | Grounded backward roll |
| `AIR_DODGE` | `0xEC` | 236 | Directional air dodge |

### Grabs & Throws
| Name | Hex | Dec | Description |
|---|---|---|---|
| `GRAB` | `0xD4` | 212 | Standing grab / Shield grab |
| `DASH_GRAB` | `0xD6` | 214 | Running dash grab |
| `THROW_FORWARD` | `0xDB` | 219 | Forward throw |
| `THROW_BACKWARD` | `0xDC` | 220 | Backward throw |
| `THROW_HI` | `0xDD` | 221 | Up throw |
| `THROW_LW` | `0xDE` | 222 | Down throw |

### Damage & Hitstun
| Name | Hex | Dec | Description |
|---|---|---|---|
| `DAMAGE_FALL` | `0x26` | 38 | Tumble state |
| `DAMAGE_START` | `0x4B` | 75 | Damage / hitstun range start (`DAMAGE_HI_1`) |
| `DAMAGE_END` | `0x61` | 97 | Damage / hitstun range end (`DAMAGE_FLY_ROLL`) |

### Ledge Options
| Name | Hex | Dec | Description |
|---|---|---|---|
| `CLIFF_CATCH` | `0xFC` | 252 | Catching ledge animation |
| `CLIFF_WAIT` | `0xFD` | 253 | Hanging on ledge |
| `CLIFF_CLIMB_SLOW` | `0xFE` | 254 | Ledge climb slow ($\ge 100\%$) |
| `CLIFF_CLIMB_QUICK` | `0xFF` | 255 | Ledge climb quick ($< 100\%$) |
| `CLIFF_ATTACK_SLOW` | `0x100` | 256 | Ledge attack slow ($\ge 100\%$) |
| `CLIFF_ATTACK_QUICK` | `0x101` | 257 | Ledge attack quick ($< 100\%$) |
| `CLIFF_ESCAPE_SLOW` | `0x102` | 258 | Ledge roll slow ($\ge 100\%$) |
| `CLIFF_ESCAPE_QUICK` | `0x103` | 259 | Ledge roll quick ($< 100\%$) |
| `CLIFF_JUMP_SLOW` | `0x104` | 260 | Ledge jump slow ($\ge 100\%$) |
| `CLIFF_JUMP_QUICK` | `0x105` | 261 | Ledge jump quick ($< 100\%$) |

### Ground Techs & Missed Techs
| Name | Hex | Dec | Description |
|---|---|---|---|
| `TECH_NEUTRAL` | `0xC7` | 199 | Neutral ground tech in place |
| `TECH_F` | `0xC8` | 200 | Forward ground tech roll |
| `TECH_B` | `0xC9` | 201 | Backward ground tech roll |
| `WALL_TECH` | `0xCA` | 202 | Wall tech in place |
| `WALL_TECH_JUMP` | `0xCB` | 203 | Wall tech jump |
| `TECH_MISS_UP` | `0xB7` | 183 | Missed tech landing on back (face up) |
| `TECH_MISS_DOWN` | `0xBF` | 191 | Missed tech landing on stomach (face down) |
| `MISSED_WALL_TECH` | `0xF7` | 247 | Missed wall tech bounce |

### Downed States & Missed-Tech Wakeup Options
| Name | Hex | Dec | Description |
|---|---|---|---|
| `DOWN_WAIT_U` | `0xB8` | 184 | Downed wait / lying face up |
| `DOWN_WAIT_D` | `0xC0` | 192 | Downed wait / lying face down |
| `DOWN_STAND_U` | `0xB9` | 185 | Wakeup neutral stand (from face up) |
| `DOWN_STAND_D` | `0xC1` | 193 | Wakeup neutral stand (from face down) |
| `DOWN_FORWARD_U` | `0xBA` | 186 | Wakeup roll forward (from face up) |
| `DOWN_FORWARD_D` | `0xC2` | 194 | Wakeup roll forward (from face down) |
| `DOWN_BACK_U` | `0xBB` | 187 | Wakeup roll backward (from face up) |
| `DOWN_BACK_D` | `0xC3` | 195 | Wakeup roll backward (from face down) |
| `DOWN_ATTACK_U` | `0xBC` | 188 | Wakeup getup attack (from face up) |
| `DOWN_ATTACK_D` | `0xC4` | 196 | Wakeup getup attack (from face down) |

---

## 2. Advanced Movement & Landing Mechanics

### 1. L-Canceling (Lag Reduction)
- **Target**: Halving landing lag when landing during an aerial attack.
- **Engine Flags**: In `PostFrameUpdateType`, when `actionStateId` is in `[0x46, 0x4A]` (or `[0x2A, 0x2E]`):
  - `post.lCancelStatus === 1`: Successful L-cancel.
  - `post.lCancelStatus === 2`: Failed / missed L-cancel.
- **Input Verification**: Inspect `PreFrameUpdateType` for $1 \le \Delta t \le 7$ frames prior to landing:
  - Analog trigger $> 0.3$ OR digital L/R/Z button pressed.
- **Formula**: `LCancel_Rate = (Successes / (Successes + Fails)) * 100`.

### 2. Wavedash vs. Waveland
- **Wavedash Definition**: Jumpsquat $\to$ immediate diagonal air dodge into stage $\to$ `LANDING_FALL_SPECIAL` (`0x29`).
- **Waveland Definition**: Airborne state (jump, platform drift, or knockback recovery) $\to$ diagonal air dodge into stage surface $\to$ `LANDING_FALL_SPECIAL` (`0x29`).
- **Detection Logic**:
  1. Trigger on current frame: `post.actionStateId === LANDING_FALL_SPECIAL` (`0x29`).
  2. Inspect preceding window (15 frames lookback):
     - Must contain `AIR_DODGE` (`0xEC`).
     - Check if window contains `ACTION_KNEE_BEND` (`0x18`).
  3. If `ACTION_KNEE_BEND` is present:
     - Count jump frames between knee bend and landing.
     - Calculate $\Delta Y = |Y_{\text{landing}} - Y_{\text{knee\_bend}}|$.
     - If `jumpFrames >= 5` AND $\Delta Y > 0.15$: Classified as **Waveland** (e.g. jumping up to platform).
     - Otherwise: Classified as **Wavedash**.
  4. If `ACTION_KNEE_BEND` is NOT present: Classified as **Waveland**.
  5. **Airborne Frame Gap**: $t_{\text{air\_dodge}} - t_{\text{jumpsquat startup}}$ evaluates execution speed (+0f = frame-perfect).

### 3. Dash Dancing & Dash Pivots
- **Dash Dancing**: Sequence of `DASH` (`0x14`) with `facingDirection` inverting ($1 \leftrightarrow -1$) in $\le 15$ frames per turn without entering `TURN` (`0x12`) or `RUN` (`0x15`).
- **Dash Pivots (Frame-1 Attack/Grab)**:
  - Frame $t-1$: `post.actionStateId === DASH` (`0x14`).
  - Frame $t$: `post.actionStateId === TURN` (`0x12`) and stick reversed.
  - Frame $t+1$: Action state immediately enters an attack (`ATTACK_FTILT`, `ATTACK_FSMASH`, `ATTACK_UTILT`) or `GRAB` (`0xD4`), canceling turn on frame 1.

### 4. Moonwalking
- **Definition**: Rolling control stick along bottom rim ($X \to \text{down} \to -X$) during dash without crossing deadzone center, avoiding `TURN` animation while acquiring negative horizontal velocity.
- **Signal**: `post.actionStateId === DASH` (`0x14`), `facingDirection` unchanged, but horizontal velocity $\text{groundX}$ reverses polarity against `facingDirection`.

### 5. Edge Canceling
- **Definition**: Sliding off a platform or stage lip during aerial landing or special move recovery to bypass landing lag.
- **Signal**: Frame $t-1$ is in `LANDING_AIR` (`0x46`–`0x4A`) or `LANDING_FALL_SPECIAL` (`0x29`); Frame $t$ transitions directly to `FALL` (`0x1D`) or `TEETER` (`0xF5`) after fewer frames than standard landing lag.

---

## 3. Ledge & Recovery Mechanics

### 6. Standard Ledge Options
Recorded on frame $t$ when a player hanging on ledge (`CLIFF_WAIT` `0xFD` / 253) executes a standard getup action:
- **Climb**: `CLIFF_CLIMB_SLOW` (`0xFE` / 254) or `CLIFF_CLIMB_QUICK` (`0xFF` / 255) $\to$ `climb_count`.
- **Attack**: `CLIFF_ATTACK_SLOW` (`0x100` / 256) or `CLIFF_ATTACK_QUICK` (`0x101` / 257) $\to$ `attack_count`.
- **Roll / Escape**: `CLIFF_ESCAPE_SLOW` (`0x102` / 258) or `CLIFF_ESCAPE_QUICK` (`0x103` / 259) $\to$ `roll_count`.
- **Jump**: `CLIFF_JUMP_SLOW` (`0x104` / 260) or `CLIFF_JUMP_QUICK` (`0x105` / 261) $\to$ `jump_count`.

### 7. 35-Frame Ledgedash Heuristic Window
- **Definition**: Dropping from ledge, jumping/air dodging onto the stage surface, and landing in `LANDING_FALL_SPECIAL` (`0x29` / 41) within a strict timing and spatial window.
- **Detection Algorithm & Criteria**:
  1. **Initiation**: Player was in `CLIFF_WAIT` (`0xFD` / 253) at frame $t_{\text{wait}}$.
  2. **Landing**: Player enters `LANDING_FALL_SPECIAL` (`0x29` / 41) at frame $t_{\text{land}}$.
  3. **Timing Window**: $t_{\text{land}} - t_{\text{wait}} \le 35$ frames ($\le 0.583$ s).
  4. **Stage Surface Containment**: Player's landing position must be on the stage:
     $$|X_{\text{land}}| \le \text{ground.xMax}$$
     where $\text{ground.xMax}$ is stage-specific (Battlefield 68.40, FD 85.57, Yoshi's 56.00, FoD 63.35, Stadium 87.75, Dream Land 77.27).
  5. **Intermediate Airborne States**: Only airborne states are permitted between ledge drop and landing:
     - `FALL` (`0x1D` / 29)
     - `JUMP_F` (`0x19` / 25) or `JUMP_B` (`0x1A` / 26)
     - `AIR_DODGE` (`0xEC` / 236)
  6. **Disqualification Invariants**:
     - Player re-grabs the ledge (`CLIFF_CATCH` `0xFC` / 252) before landing.
     - Player enters hitstun or damage (`isDamage(anim)` or percent increases) prior to landing.
- **Metric**: Increments `ledgedash_count`.

### 8. GALINT (Grounded Actionable Ledge Intangibility)
- **Definition**: The exact number of frames a character is both fully actionable on the stage and completely intangible following a ledgedash.
- **Calculation**:
  1. Trigger on ledgedash: `CLIFF_WAIT` (`0xFD`) $\to$ drop/jump $\to$ `AIR_DODGE` $\to$ `LANDING_FALL_SPECIAL` on stage.
  2. While in `LANDING_FALL_SPECIAL` (10 frames of landing lag), character is not actionable.
  3. Actionable begins on frame $t_{\text{act}} = t_{\text{land}} + 10$.
  4. Inspect `post.hurtboxCollisionState` on and after $t_{\text{act}}$:
     - Count continuous frames where `hurtboxCollisionState === 1` (invulnerable) or `2` (intangible).
     - $\text{GALINT} = \text{count of actionable intangible frames}$. (Max varies by character: Fox up to +14f, Marth up to +4f, Sheik up to +10f).

### 9. Ledge Stalling & Regrabs
- **Definition**: Repeatedly refreshing ledge invincibility.
- **Signal**: `CLIFF_WAIT` $\to$ drop/special $\to$ `CLIFF_CATCH` within $\le 30$ frames without ever setting foot on stage. Track total ledge grab count per match to evaluate ledge grab limit (LGL) enforcement.

---

## 4. Advanced Defensive Mechanics & Punish Windows

### 10. Ground Teching vs. Missed-Tech Wakeup Options
Distinct classification based on player state prior to recovery:
1. **Ground Tech Options** (initiated when hitting ground from tumble `DAMAGE_FALL` `0x26`):
   - `TECH_NEUTRAL` (`0xC7` / 199) $\to$ `tech_neutral_count`.
   - `TECH_F` (`0xC8` / 200) $\to$ `tech_forward_count`.
   - `TECH_B` (`0xC9` / 201) $\to$ `tech_back_count`.
   - `WALL_TECH` (`0xCA` / 202) $\to$ `wall_tech_success`.
   - Missed Tech: `TECH_MISS_UP` (`0xB7` / 183) or `TECH_MISS_DOWN` (`0xBF` / 191) $\to$ `tech_miss_count`.
2. **Missed-Tech Wakeup Options** (initiated after entering grounded down states `DOWN_WAIT_U` `0xB8` / 184 or `DOWN_WAIT_D` `0xC0` / 192):
   - **Neutral Stand**: `DOWN_STAND_U` (`0xB9` / 185) or `DOWN_STAND_D` (`0xC1` / 193) $\to$ `wakeup_stand_count`.
   - **Roll Forward**: `DOWN_FORWARD_U` (`0xBA` / 186) or `DOWN_FORWARD_D` (`0xC2` / 194) $\to$ `wakeup_forward_count`.
   - **Roll Backward**: `DOWN_BACK_U` (`0xBB` / 187) or `DOWN_BACK_D` (`0xC3` / 195) $\to$ `wakeup_back_count`.
   - **Getup Attack**: `DOWN_ATTACK_U` (`0xBC` / 188) or `DOWN_ATTACK_D` (`0xC4` / 196) $\to$ `wakeup_attack_count`.

### 11. Strict 30-Frame Post-Actionable Punish Window
- **Scope**: Applied to all defensive recovery events (ledge options, ledgedash, ground techs, missed-tech wakeups, and out-of-shield escapes).
- **Vulnerability Window**:
  1. The animation's vulnerable end-lag frames (frames after intangibility/invulnerability expires).
  2. A strict **30-frame (0.50 s) post-actionable recovery window** beginning the frame the player regains actionable control (e.g., `WAIT` `0x0E`, `DASH` `0x14`).
- **Punish Classification Logic**:
  - If the player takes damage (`percent > prevPercent`) or enters hitstun (`isDamage(anim)`) during vulnerable end-lag or within the 30-frame post-actionable window:
    - **Counter-Hit Check**: If the defender landed a hit on the opponent *prior* to taking damage within this window, the sequence is classified as a successful counter-hit and is **NOT** punished.
    - If no counter-hit occurred prior to taking damage: the defensive option is flagged as **punished**, incrementing the corresponding `*_punished` counter (e.g. `climb_punished`, `tech_neutral_punished`, `wakeup_forward_punished`, `ledgedash_punished`, `oos_roll_punished`).
  - If 30 frames elapse post-actionable with no damage taken, the tracking window closes cleanly.

### 12. Out of Shield (OOS) Option Breakdown & Escapes
Track the first non-shield state upon exiting `GUARD` (`0xB2`–`0xB6`):
- **Shield Grab**: `GRAB` (`0xD4` / 212) on frame 1 of exiting shield $\to$ `oos_grab_count`.
- **Up-Smash OOS**: `ATTACK_USMASH` (`0x3F` / 63), or jumpsquat `ACTION_KNEE_BEND` (`0x18` / 24) canceling directly into up-smash $\to$ `oos_smashes`.
- **Aerial OOS**: Aerial attack state `0x41`–`0x45` (Nair, Fair, Bair, Uair, Dair) initiated out of jumpsquat `ACTION_KNEE_BEND` (`0x18`) $\to$ `oos_aerial_count`.
- **Roll Forward / Backward OOS**: `ROLL_FORWARD` (`0xE9` / 233) or `ROLL_BACKWARD` (`0xEA` / 234) $\to$ `oos_roll_count`.
- **Spotdodge OOS**: `SPOT_DODGE` (`0xEB` / 235) $\to$ `oos_spotdodge_count`.
- **Wavedash OOS**: `ACTION_KNEE_BEND` (`0x18`) $\to$ `AIR_DODGE` (`0xEC`) $\to$ `LANDING_FALL_SPECIAL` (`0x29`) $\to$ `oos_wavedashes`.
- **OOS Punish Tracking**: Evaluated under the 30-frame post-actionable punish rule $\to$ `oos_grab_punished`, `oos_aerial_punished`, `oos_roll_punished`, `oos_spotdodge_punished`.

### 13. Corner Drift (Tactical Concession)
- **Definition**: Directional drift toward the nearest ledge lip while under close-range opponent proximity pressure, conceding center stage without being hit.
- **Heuristic Thresholds**:
  1. Opponent proximity: Euclidean distance $D = \sqrt{\Delta X^2 + \Delta Y^2} \le 20.0$ world units.
  2. Drift vector toward ledge: Player's horizontal coordinate moves outward toward stage edge:
     $$|X_t| > |X_{t-1}| \quad \text{and} \quad |X_t| \to \text{ground.xMax} \quad (|X_t| \ge \text{ground.xMax} - 15.0)$$
  3. Unforced action: Player is not in hitstun, tumble, or shield stun.
- **Metric**: Increments `corner_drift_count`.

### 14. V-Cancel (Velocity Canceling)
- **Definition**: Pressing L or R precisely 2 to 3 frames before taking a hit in the air, subtracting 5% of incoming knockback velocity.
- **Signal**:
  1. Frame $t$: Player is airborne (`post.isAirborne === true`), transitions from non-damaged state to `DAMAGE_START` (`0x4B`–`0x5B`) or `DAMAGE_FALL` (`0x26`).
  2. Check `pre.physicalButtons` on frames $t-3$, $t-2$, and $t-1$:
     - A fresh digital L or R press ($0 \to 1$) occurred within $[t-3, t-2]$.
     - The trigger was NOT already held prior to $t-3$.
  3. Player was not in hitstun prior to the hit.

### 15. Amsah Teching
- **Definition**: Using ASDI Down to smash into the ground upon receiving a high-knockback hit that would normally launch or tumble, immediately buffering a ground tech.
- **Signal**:
  1. Player is struck by an attack with sufficient knockback to cause tumble ($KB > 80$).
  2. Instead of becoming airborne or flying into tumble, player connects with the ground within 1–2 frames due to stick $Y < -0.66$ (ASDI down) and immediately executes `NEUTRAL_TECH` (`0xC7`), `FORWARD_TECH` (`0xC8`), or `BACKWARD_TECH` (`0xC9`).

### 16. Slide-Off DI
- **Definition**: Using ASDI or shield pushback at the edge of a platform or stage lip to slide off into an immediate falling state, cutting hitstun short or escaping tech chases.
- **Signal**:
  - Player takes a hit on a platform, or is pushed in shield near $X_{\text{lip}}$.
  - Within 1–2 frames, $X$ position crosses platform boundary and state switches from grounded hitstun/shield to `FALL` (`0x1D`), instantly restoring airborne aerial options.

### 17. Crouch Canceling (CC) & True ASDI Down
- **Signal**: Defender takes damage while in `SQUAT` (`0x0A`) / `SQUAT_WAIT` (`0x0B`).
- Evaluated as true CC if defender remains grounded in light hitstun and does not enter tumble (`DAMAGE_FALL` `0x26`).

### 18. Powershielding (Physical & Projectile)
- **Engine Flags**: `post.stateBitFlags4 & 0x20` is set to 1.
- Alternatively, shield activation within 2 frames of incoming damage.

### 19. Smash DI (SDI)
- In `PostFrameUpdateType`, during frames where `hitlagRemaining > 0`:
  - Compute Euclidean displacement: $\Delta r = \sqrt{(X_t - X_{t-1})^2 + (Y_t - Y_{t-1})^2}$.
  - If $\Delta r > 0.7$ units per frame, count as 1 SDI input.

---

## 5. Offensive Move Commitments & Grab Initiation Triggers

### 20. Action State Numeric Range Matching
In `@slippi/slippi-js`, `post.actionStateId` is represented as an integer:
- Grounded attacks, tilts, smashes, dash attacks, and aerials: integer range `44` to `69` (`0x2C` through `0x45`).
- Character specials: integer values $\ge 341$.
- Grab initiation states: `GRAB` (`0xD4` / 212) and `DASH_GRAB` (`0xD6` / 214).
- Matching predicate:
  ```javascript
  const isAttackCommitment = (id) => (id >= 0x2C && id <= 0x45) || id >= 341;
  const isGrabInitiation = (id) => id === 0xD4 || id === 0xD6;
  ```

### 21. Grab Initiation Context & Triggers
When a player initiates a grab (`anim === 0xD4 || anim === 0xD6` with `anim !== prevAnim`), categorize by spatial and tactical context:
1. **Shield-Pressure Grab**:
   - Initiated within $\le 15$ frames of the opponent shielding an incoming attack (`isShield(oppAnim)`).
   - Increments `grabs_shield_pressure`.
2. **Scramble Grab**:
   - Initiated when both players are simultaneously actionable (neither in hitstun, tumble, shield, or uninterruptible state),
   - Euclidean distance $D = \sqrt{\Delta X^2 + \Delta Y^2} \le 18.0$ world units,
   - AND clean history: neither player has been in hitstun (`isDamage`) or shield (`isShield`) within the preceding 30 frames ($[t - 30, t]$).
   - Increments `grabs_scramble`.
3. **Neutral Setup Grab**:
   - Initiated from neutral spacing ($D > 18.0$ world units) via dash-grab or jump-in without prior shield contact within 15 frames.
   - Increments `grabs_neutral`.

### 22. Neutral Reset vs. Over-Extension Boundary
Evaluated over a **45-frame window** following advantage neutralization (e.g. conversion termination with resetTimer > 45 or blocked attack with frame advantage $\le 0$):
1. **Neutral Reset**:
   - Player executes horizontal movement increasing Euclidean separation distance:
     $$\Delta D = D_{\text{end}} - D_{\text{start}} > 0$$
   - Player performs a dash-dance away, waveland back, or defensive guard (shield / retreat).
   - Increments `neutral_resets`.
2. **Over-Extension**:
   - Player commits to an active attack (`(id >= 0x2C && id <= 0x45) || id >= 341`), forward dash directly toward opponent ($\Delta D < 0$), or grab attempt while the opponent is already actionable or in frame parity,
   - Resulting in a whiff (attack completes without dealing damage) or taking counter-hit damage (`isDamage`).
   - Increments `over_extensions`.

---

## 6. Character-Specific Advanced Techniques

### 23. Peach Float Cancel
- **Definition**: Peach landing during an aerial while in her floating state cancels all aerial landing lag to a universal 4 frames, without requiring an L-cancel input.
- **Signal**: Character is Peach (`internalCharacterId === 0x09`), landing from an aerial while float was active; landing lag is exactly 4 frames and `lCancelStatus === 0`.

### 24. Jump-Canceled Grab (JC Grab) & Boost Grab
- **JC Grab**: Player is in `RUN` (`0x15`), inputs `ACTION_KNEE_BEND` (`0x18`), and transitions into standing `GRAB` (`0xD4`) within jumpsquat frames (much faster than dash grab `0xD6`).
- **Boost Grab**: Player is in `ATTACK_DASH` (`0x32`) and cancels into `DASH_GRAB` (`0xD6`) on frame 1–2.

### 25. Spacie Multishining & Waveshining (Fox/Falco)
- **Multishine**: Shine (`360`–`368`) $\to$ jump cancel `ACTION_KNEE_BEND` on frame 4 (Fox) or frame 5 (Falco) $\to$ immediate second shine on frame 1 of leaving ground.
- **Waveshine**: Shine $\to$ jump cancel $\to$ immediate diagonal wavedash out of jumpsquat.
