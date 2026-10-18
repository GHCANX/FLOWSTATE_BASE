---
name: melee-tactical-interpreter
description: >-
  Interpret macro gameplay, punish games, edgeguarding sequences, shield pressure,
  and win-probability momentum in Super Smash Bros. Melee replays. Use when
  analyzing match flow, detecting clips, evaluating neutral openings, tracking
  recovery denial, or scoring highlights.
---

# Melee Tactical Interpreter Skill Guide

This skill translates raw frame data and player states into high-level tactical insights, competitive narratives, and precise event classifications.

---

## 1. Neutral Wins, Combos, and Conversions

### Combos vs. Conversions
- **Combo (`ComboComputer`)**:
  - Starts when opponent enters hitstun (`0x4B`–`0x5B`), grab (`0xD4`–`0xDF`), or command grab (`0x10A`–`0x130`, `0x147`–`0x152`).
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
