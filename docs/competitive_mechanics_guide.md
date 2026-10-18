# Competitive Super Smash Bros. Melee Mechanics Analysis Guide

This reference document defines the technical specifications, frame data signals, controller input windows, and analytical metrics for 11+ core competitive techniques in Super Smash Bros. Melee parsed from Slippi (`.slp`) replay files.

---

## 1. L-Canceling (Lag Reduction)

- **Description**: Pressing L, R, or Z within 7 frames prior to touching the ground during an aerial attack halves landing lag.
- **Frame Data Signals**:
  - *Action States*: `AttackAirN` (`0x044`), `AttackAirF` (`0x045`), `AttackAirB` (`0x046`), `AttackAirHi` (`0x047`), `AttackAirLw` (`0x048`) transitioning to `LandingAirN` (`0x02A`) through `LandingAirLw` (`0x02E`).
  - *Slippi Flag*: `post.lCancelStatus === 1` (Success), `2` (Failure/Missed), `0` (N/A).
- **Controller Input Window**: Analog or digital L/R trigger press or Z button press within $1\text{f} \le \Delta t \le 7\text{f}$ prior to ground collision.
- **Metrics**:
  - `L-Cancel Success Rate %` = $(\text{Successes} / \text{Total Aerial Landings}) \times 100$
  - `Total Lag Saved` (estimated in frames / seconds)

---

## 2. Wavedashing & Wavelanding

- **Description**: Air dodging diagonally down into the ground immediately after leaving the floor, causing the character to slide across the stage in an actionable state.
- **Frame Data Signals**:
  - *Action States*: Jump startup `JumpF` / `JumpB` / `JumpSq` (`0x018`–`0x01A`) transitioning to `EscapeAir` (`0x0EC`) within $1\text{f} \le \Delta t \le 12\text{f}$, followed by `LandingFallSpecial` (`0x029`).
  - *Stick Vector*: Joystick $Y < -0.35$ and $|Joystick X| > 0.35$.
- **Jumpsquat Efficiency Table**:
  - 3-Frame Jumpsquat: Fox, Sheik, Pikachu, Pichu, Samus, Kirby
  - 4-Frame Jumpsquat: Falco, Marth, Captain Falcon, Luigi, Mario, Dr. Mario, Ice Climbers, Young Link
  - 5-Frame Jumpsquat: Peach, Jigglypuff, Yoshi, Ganondorf, Link, Ness, Mewtwo
  - 6-Frame Jumpsquat: Donkey Kong, Bowser, Mr. Game & Watch, Roy
- **Metrics**:
  - `Wavedash Count` & `Waveland Count`
  - `Airborne Frame Gap Delay` = $\Delta t_{\text{air dodge}} - t_{\text{jumpsquat}}$ ($+0\text{f}$ = Perfect)

---

## 3. Dash Dancing

- **Description**: Rapidly flicking the control stick left and right during the initial `Dash` animation to weave back and forth without entering the committed `Run` or `Turn` states.
- **Frame Data Signals**:
  - *Action State*: `Dash` (`0x014`).
  - *Stick Vector*: `facingDirection` inverts ($1 \leftrightarrow -1$) while staying in `Dash` state with frame delta $\le 15\text{f}$ per turn.
- **Metrics**:
  - `Total Dash-Dance Turns`
  - `Average Dash String Length`

---

## 4. Ledge Dashes & Ledge Hopping

- **Description**: Releasing ledge with invincibility (`CliffWait`), jump/air dodging onto stage, or executing a quick ledge hop aerial.
- **Frame Data Signals**:
  - *Action States*: `CliffWait` (`0x0FD`) transitioning to `CliffDrop` / `CliffJump` $\rightarrow$ `EscapeAir` (`0x0EC`) onto stage within $\le 25\text{f}$.
- **Metrics**:
  - `Ledge Dash Count`
  - `Ledge Hop Aerial Count`

---

## 5. Crouch Canceling & ASDI Down

- **Description**: Holding Down on the control stick / C-stick while taking damage to reduce hitstun and ground immediately.
- **Frame Data Signals**:
  - *Action States*: `Squat` / `SquatWait` (`0x00A` / `0x00B`) upon taking damage, resulting in instant ground recovery without tumble (`0x035`).
- **Metrics**:
  - `Crouch Cancel Count`
  - `Damage Absorbed in Crouch`

---

## 6. Shield Drops

- **Description**: Tilting the control stick down during shield (`Guard` `0x0B2`) on a soft platform to fall through instantly without rolling or spot-dodging.
- **Frame Data Signals**:
  - *Action States*: `Guard` (`0x0B2`) $\rightarrow$ `ShieldDrop` (`0x0B3`) or `Pass` (`0x027`).
  - *Stick Vector*: Joystick $Y$ tilted downward between $-0.625$ and $-0.75$.
- **Metrics**:
  - `Shield Drop Count`
  - `Platform Escape Speed`

---

## 7. Fast-Falling

- **Description**: Tilting the control stick down at the apex or descent of a jump to double the falling speed.
- **Frame Data Signals**:
  - *Action State / Flag*: `post.isFastFalling === true` during air states (`0x01D`–`0x023`).
  - *Stick Vector*: Joystick $Y < -0.66$ while vertical velocity $Y \le 0$.
- **Metrics**:
  - `Fast Fall Count`
  - `Fast Fall Ratio %` = $(\text{Fast Falls} / \text{Total Airborne Descents}) \times 100$

---

## 8. Powershielding (Physical & Projectile)

- **Description**: Shielding within 2 frames of an incoming attack, reflecting projectiles or eliminating shield stun and shield pushback.
- **Frame Data Signals**:
  - *Action States*: Transition to `GuardReflect` / `Guard` (`0x0B2`) within 2 frames of taking shield damage or reflecting.
- **Metrics**:
  - `Powershield Count`
  - `Projectile Reflection Count`

---

## 9. Out of Shield (OOS) Options

- **Description**: Acting immediately out of shield using Jump (Up-Smash/Aerials/Wavedash), Grab (Shield Grab), or Item Toss.
- **Frame Data Signals**:
  - *Action States*: `Guard` (`0x0B2`) transitioning directly to `Catch` (`0x0D4`), `JumpSq` (`0x018`), or `AttackHi4` (`0x03A`).
- **Metrics**:
  - `Total OOS Actions`
  - `OOS Choice Breakdown`: Shield Grab %, Wavedash OOS %, Up-Smash OOS %, Aerial OOS %

---

## 10. Smash DI (SDI) & Meteor Canceling

- **Description**:
  - *Smash DI*: Flicking the control stick during hitlag frames to instantly displace character position.
  - *Meteor Cancel*: Pressing Jump or Up-B 8+ frames after being hit by a meteor smash to cancel downward velocity.
- **Frame Data Signals**:
  - *SDI*: Raw position delta $\Delta X, \Delta Y > 0.7$ units per frame during hitlag (`DamageFlyRoll`).
  - *Meteor Cancel*: Jump or Special move triggered after meteor launch state.
- **Metrics**:
  - `SDI Inputs Count`
  - `Meteor Cancel Success Rate %`

---

## 11. Moonwalking & Pivot Attacks

- **Description**:
  - *Moonwalk*: Half-circle stick rotation during dash to slide backward with forward momentum.
  - *Pivot Attack*: Flicking stick backward during dash to execute an instant tilt, smash, or grab on frame 1 of turn.
- **Frame Data Signals**:
  - *Moonwalk*: `Dash` (`0x014`) with reverse joystick curve without entering `Turn` (`0x013`), resulting in backward velocity.
  - *Pivot Attack*: `Dash` (`0x014`) $\rightarrow$ `Turn` (`0x013`) $\rightarrow$ Attack state on frame 1.
- **Metrics**:
  - `Moonwalk Count`
  - `Pivot Attack Count`
