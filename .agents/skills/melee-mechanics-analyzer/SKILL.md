---
name: melee-mechanics-analyzer
description: >-
  Detect, evaluate, and quantify competitive Super Smash Bros. Melee mechanics
  from frame-by-frame Slippi replay data. Covers L-canceling, wavedashing,
  wavelanding, dash dancing, ledge options, GALINT, shield drops, crouch canceling,
  amsah teching, v-canceling, slide-off DI, powershielding, out-of-shield (OOS) options,
  smash DI (SDI), peach float cancels, JC grabs, and spacie multishining.
---

# Melee Mechanics Analyzer Skill Guide

This skill specifies the exact action states, controller inputs, frame deltas, and state machine algorithms required to detect, quantify, and analyze 20+ competitive Melee mechanics from frame-by-frame `.slp` data.

---

## 1. Action State IDs Reference

| Name | Hex | Dec | Description |
|---|---|---|---|
| `ACTION_WAIT` | `0x0E` | 14 | Standing actionable |
| `DASH` | `0x14` | 20 | Initial dash animation |
| `TURN` | `0x12` | 18 | Turning around |
| `RUN` | `0x15` | 21 | Full run |
| `ACTION_KNEE_BEND` | `0x18` | 24 | Jumpsquat startup (3-6 frames per character) |
| `JUMP_FORWARD` | `0x19` | 25 | Forward airborne jump |
| `JUMP_BACKWARD` | `0x1A` | 26 | Backward airborne jump |
| `FALL` | `0x1D` | 29 | Regular falling |
| `LANDING_FALL_SPECIAL` | `0x29` | 41 | Landing in special fall (e.g. after air dodge / wavedash) |
| `ATTACK_AIR_START` | `0x41` | 65 | Aerial attacks start (Nair 65, Fair 66, Bair 67, Uair 68, Dair 69) |
| `LANDING_AIR_START` | `0x46` | 70 | Aerial landing lag start (Nair 70, Fair 71, Bair 72, Uair 73, Dair 74) |
| `GUARD_ON` | `0xB2` | 178 | Shield startup |
| `GUARD` | `0xB3` | 179 | Shield hold |
| `GUARD_REFLECT` | `0xB6` | 182 | Powershield physical/projectile reflection |
| `DAMAGE_START` | `0x4B` | 75 | Damage / hitstun states (75 through 91 `0x5B`) |
| `DAMAGE_FALL` | `0x26` | 38 | Tumble state |
| `AIR_DODGE` | `0xEC` | 236 | Directional air dodge |
| `SPOT_DODGE` | `0xEB` | 235 | Spot dodge |
| `ROLL_FORWARD` | `0xE9` | 233 | Roll forward |
| `ROLL_BACKWARD` | `0xEA` | 234 | Roll backward |
| `CLIFF_CATCH` | `0xFC` | 252 | Catching ledge |
| `CLIFF_WAIT` | `0xFD` | 253 | Hanging on ledge |
| `NEUTRAL_TECH` | `0xC7` | 199 | Neutral ground tech |
| `FORWARD_TECH` | `0xC8` | 200 | Forward ground tech |
| `BACKWARD_TECH` | `0xC9` | 201 | Backward ground tech |
| `WALL_TECH` | `0xCA` | 202 | Wall tech |
| `TECH_MISS_UP` | `0xB7` | 183 | Missed tech (face up) |
| `TECH_MISS_DOWN` | `0xBF` | 191 | Missed tech (face down) |
| `SHINE` (Fox/Falco) | `360`–`368` | Reflector startup, hold, and turn |

---

## 2. Advanced Movement & Landing Mechanics

### 1. L-Canceling (Lag Reduction)
- **Target**: Halving landing lag when landing during an aerial.
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
     - If `jumpFrames >= 5` AND $\Delta Y > 0.1$: Classified as **Waveland** (e.g. jumping up to platform).
     - Otherwise: Classified as **Wavedash**.
  4. If `ACTION_KNEE_BEND` is NOT present: Classified as **Waveland**.
  5. **Airborne Frame Gap**: $t_{\text{air\_dodge}} - t_{\text{jumpsquat startup}}$ evaluates execution speed (+0f = frame-perfect).

### 3. Dash Dancing & Dash Pivots
- **Dash Dancing**: Sequence of `DASH` (`0x14`) with `facingDirection` inverting ($1 \leftrightarrow -1$) in $\le 15$ frames per turn without entering `TURN` or `RUN`.
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

### 6. GALINT (Grounded Actionable Ledge Intangibility)
- **Definition**: The exact number of frames a character is both fully actionable on the stage and completely intangible following a ledgedash.
- **Calculation**:
  1. Trigger on ledgedash: `CLIFF_WAIT` (`0xFD`) $\to$ ledge drop/jump $\to$ `AIR_DODGE` $\to$ `LANDING_FALL_SPECIAL` on stage.
  2. While in `LANDING_FALL_SPECIAL` (10 frames of landing lag), character is not actionable.
  3. Actionable begins on frame $t_{\text{act}} = t_{\text{land}} + 10$.
  4. Inspect `post.hurtboxCollisionState` on and after $t_{\text{act}}$:
     - Count continuous frames where `hurtboxCollisionState === 1` (invulnerable) or `2` (intangible).
     - $\text{GALINT} = \text{count of actionable intangible frames}$. (Max varies by character: Fox up to +14f, Marth up to +4f, Sheik up to +10f).

### 7. Ledge Stalling & Regrabs
- **Definition**: Repeatedly refreshing ledge invincibility.
- **Signal**: `CLIFF_WAIT` $\to$ drop/special $\to$ `CLIFF_CATCH` within $\le 30$ frames without ever setting foot on stage. Track total ledge grab count per match to evaluate ledge grab limit (LGL) enforcement.

---

## 4. Advanced Defensive Mechanics

### 8. V-Cancel (Velocity Canceling)
- **Definition**: Pressing L or R precisely 2 to 3 frames before taking a hit in the air, subtracting 5% of incoming knockback velocity.
- **Signal**:
  1. Frame $t$: Player is airborne (`post.isAirborne === true`), transitions from non-damaged state to `DAMAGE_START` (`0x4B`–`0x5B`) or `DAMAGE_FALL` (`0x26`).
  2. Check `pre.physicalButtons` on frames $t-3$, $t-2$, and $t-1$:
     - A fresh digital L or R press ($0 \to 1$) occurred within $[t-3, t-2]$.
     - The trigger was NOT already held prior to $t-3$.
  3. Player was not in hitstun prior to the hit.

### 9. Amsah Teching
- **Definition**: Using ASDI Down to smash into the ground upon receiving a high-knockback hit that would normally launch or tumble, immediately buffering a ground tech.
- **Signal**:
  1. Player is struck by an attack with sufficient knockback to cause tumble ($KB > 80$).
  2. Instead of becoming airborne or flying into tumble, player connects with the ground within 1–2 frames due to stick $Y < -0.66$ (ASDI down) and immediately executes `NEUTRAL_TECH` (`0xC7`), `FORWARD_TECH` (`0xC8`), or `BACKWARD_TECH` (`0xC9`).

### 10. Slide-Off DI
- **Definition**: Using ASDI or shield pushback at the edge of a platform or stage lip to slide off into an immediate falling state, cutting hitstun short or escaping tech chases.
- **Signal**:
  - Player takes a hit on a platform, or is pushed in shield near $X_{\text{lip}}$.
  - Within 1–2 frames, $X$ position crosses platform boundary and state switches from grounded hitstun/shield to `FALL` (`0x1D`), instantly restoring airborne aerial options.

### 11. Crouch Canceling (CC) & True ASDI Down
- **Signal**: Defender takes damage while in `SQUAT` (`0x0A`) / `SQUAT_WAIT` (`0x0B`).
- Evaluated as true CC if defender remains grounded in light hitstun and does not enter tumble (`DAMAGE_FALL` `0x26`).

### 12. Powershielding (Physical & Projectile)
- **Engine Flags**: `post.stateBitFlags4 & 0x20` is set to 1.
- Alternatively, shield activation within 2 frames of incoming damage.

### 13. Out of Shield (OOS) Option Breakdown
- Track first non-shield state upon exiting `GUARD`:
  - **Shield Grab**: `CATCH` (`0xD4`) on frame 1.
  - **Up-Smash OOS**: `ACTION_KNEE_BEND` (`0x18`) $\to$ `ATTACK_USMASH` (`0x3F`).
  - **Aerial OOS**: `ACTION_KNEE_BEND` $\to$ aerial attack state (`0x41`–`0x45`).
  - **Wavedash OOS**: `ACTION_KNEE_BEND` $\to$ `AIR_DODGE` $\to$ `LANDING_FALL_SPECIAL`.
  - **Roll / Spotdodge OOS**: `0xE9`, `0xEA`, or `0xEB`.

### 14. Smash DI (SDI)
- In `PostFrameUpdateType`, during frames where `hitlagRemaining > 0`:
  - Compute Euclidean displacement: $\Delta r = \sqrt{(X_t - X_{t-1})^2 + (Y_t - Y_{t-1})^2}$.
  - If $\Delta r > 0.7$ units per frame, count as 1 SDI input.

---

## 5. Character-Specific Advanced Techniques

### 15. Peach Float Cancel
- **Definition**: Peach landing during an aerial while in her floating state cancels all aerial landing lag to a universal 4 frames, without requiring an L-cancel input.
- **Signal**: Character is Peach (`internalCharacterId === 0x09`), landing from an aerial while float was active; landing lag is exactly 4 frames and `lCancelStatus === 0`.

### 16. Jump-Canceled Grab (JC Grab) & Boost Grab
- **JC Grab**: Player is in `RUN` (`0x15`), inputs `ACTION_KNEE_BEND` (`0x18`), and transitions into standing `GRAB` (`0xD4`) within jumpsquat frames (much faster than dash grab `0xD6`).
- **Boost Grab**: Player is in `ATTACK_DASH` (`0x32`) and cancels into `DASH_GRAB` (`0xD6`) on frame 1–2.

### 17. Spacie Multishining & Waveshining (Fox/Falco)
- **Multishine**: Shine (`360`–`368`) $\to$ jump cancel `ACTION_KNEE_BEND` on frame 4 (Fox) or frame 5 (Falco) $\to$ immediate second shine on frame 1 of leaving ground.
- **Waveshine**: Shine $\to$ jump cancel $\to$ immediate diagonal wavedash out of jumpsquat.
