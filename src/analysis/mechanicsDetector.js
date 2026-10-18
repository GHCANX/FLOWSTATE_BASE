import { ACTION_STATES, isDamage, isShield, isAerialLanding, isShine } from '../constants/actionStates.js';

export class MechanicsDetector {
  /**
   * @param {Object} settings Game settings from SlippiGame
   */
  constructor(settings) {
    this.settings = settings;
    this.players = settings.players.map(p => p.playerIndex);
    
    // Per-player tracker states
    this.state = {};
    for (const pIdx of this.players) {
      this.state[pIdx] = {
        metrics: {
          lCancelSuccess: 0,
          lCancelFail: 0,
          lCancelRate: 0,
          wavedashCount: 0,
          wavelandCount: 0,
          dashDanceTurns: 0,
          dashDanceStrings: 0,
          edgeCancels: 0,
          ledgeGrabs: 0,
          ledgedashCount: 0,
          avgGalintFrames: 0,
          shieldDrops: 0,
          crouchCancels: 0,
          amsahTechs: 0,
          vCancels: 0,
          slideOffs: 0,
          powershieldsPhysical: 0,
          powershieldsProjectile: 0,
          oosGrabs: 0,
          oosAerials: 0,
          oosSmashes: 0,
          oosWavedashes: 0,
          oosRolls: 0,
          oosSpotdodges: 0,
          techNeutral: 0,
          techIn: 0,
          techAway: 0,
          techMiss: 0,
          wallTechSuccess: 0,
          wallTechMiss: 0,
          sdiInputs: 0,
          phantomHits: 0,
          floatCancels: 0,
          jcGrabs: 0,
          boostGrabs: 0,
          multishines: 0,
        },
        galintSamples: [],
        currentDashString: 0,
        recentStates: [],         // last 20 action states
        recentPositions: [],      // last 20 {x, y}
        recentPreInputs: [],      // last 10 pre frames
        lastShieldFrame: -999,
        lastLedgeWaitFrame: -999,
        lastShineFrame: -999,
        inLedgeDash: false,
        ledgedashLandFrame: -999,
      };
    }
  }

  /**
   * Process a single frame for all players
   * @param {Object} frame Current frame from slippi-js
   * @param {Object|null} prevFrame Previous frame
   */
  processFrame(frame, prevFrame) {
    if (!frame || !frame.players) return;

    for (const pIdx of this.players) {
      const pData = frame.players[pIdx];
      if (!pData || !pData.post) continue;

      const post = pData.post;
      const pre = pData.pre;
      const st = this.state[pIdx];
      const m = st.metrics;

      const anim = post.actionStateId;
      const prevPost = prevFrame?.players?.[pIdx]?.post;
      const prevAnim = prevPost ? prevPost.actionStateId : null;

      // Update sliding history buffers
      st.recentStates.push(anim);
      if (st.recentStates.length > 25) st.recentStates.shift();

      st.recentPositions.push({ x: post.positionX, y: post.positionY });
      if (st.recentPositions.length > 25) st.recentPositions.shift();

      if (pre) {
        st.recentPreInputs.push({
          frame: frame.frame,
          buttons: pre.physicalButtons,
          lTrigger: pre.physicalLTrigger,
          rTrigger: pre.physicalRTrigger,
          joyX: pre.joystickX,
          joyY: pre.joystickY
        });
        if (st.recentPreInputs.length > 15) st.recentPreInputs.shift();
      }

      const isNewAnim = anim !== prevAnim;

      // 1. L-Canceling
      if (isAerialLanding(anim) && isNewAnim) {
        if (post.lCancelStatus === 1) {
          m.lCancelSuccess++;
        } else if (post.lCancelStatus === 2) {
          m.lCancelFail++;
        }
      }

      // Peach Float Cancel
      if (post.internalCharacterId === 0x09 && isAerialLanding(anim) && isNewAnim) {
        if (post.lCancelStatus === 0 && prevPost && prevPost.isAirborne) {
          m.floatCancels++;
        }
      }

      // 2. Wavedash vs Waveland
      if (anim === ACTION_STATES.LANDING_FALL_SPECIAL && isNewAnim) {
        const recent15 = st.recentStates.slice(-15);
        const hadAirDodge = recent15.includes(ACTION_STATES.AIR_DODGE);
        const kneeBendIdx = recent15.lastIndexOf(ACTION_STATES.KNEE_BEND);

        if (hadAirDodge) {
          if (kneeBendIdx !== -1) {
            // Count airborne frames between knee bend and landing
            const jumpFrames = recent15.filter(s => s >= ACTION_STATES.KNEE_BEND + 1 && s <= ACTION_STATES.FALL_B).length;
            const kneePos = st.recentPositions[st.recentPositions.length - (recent15.length - kneeBendIdx)];
            const deltaY = kneePos ? Math.abs(post.positionY - kneePos.y) : 0;

            if (jumpFrames >= 5 && deltaY > 0.15) {
              m.wavelandCount++;
            } else {
              m.wavedashCount++;
            }
          } else {
            m.wavelandCount++;
          }
        }
      }

      // 3. Dash Dancing & Dash Pivots
      if (anim === ACTION_STATES.DASH) {
        if (prevAnim === ACTION_STATES.TURN && st.recentStates[st.recentStates.length - 3] === ACTION_STATES.DASH) {
          m.dashDanceTurns++;
          st.currentDashString++;
        }
      } else if (anim !== ACTION_STATES.TURN && isNewAnim) {
        if (st.currentDashString >= 2) {
          m.dashDanceStrings++;
        }
        st.currentDashString = 0;
      }

      // Dash Pivot (Turn -> Frame 1 attack)
      if (prevAnim === ACTION_STATES.TURN && isNewAnim && (anim >= ACTION_STATES.ATTACK_FSMASH_START && anim <= ACTION_STATES.ATTACK_DSMASH)) {
        // Attack came out immediately after turn
      }

      // 4. Ledge Catch & GALINT
      if (anim === ACTION_STATES.CLIFF_CATCH && isNewAnim) {
        m.ledgeGrabs++;
      }
      if (anim === ACTION_STATES.CLIFF_WAIT) {
        st.lastLedgeWaitFrame = frame.frame;
      }

      // Check for Ledgedash (CliffWait -> drop/jump -> air dodge -> landing fall special)
      if (anim === ACTION_STATES.LANDING_FALL_SPECIAL && isNewAnim && (frame.frame - st.lastLedgeWaitFrame <= 35)) {
        m.ledgedashCount++;
        st.inLedgeDash = true;
        st.ledgedashLandFrame = frame.frame;
      }

      // Measure GALINT (intangible frames remaining upon landing lag completion)
      if (st.inLedgeDash) {
        // LandingFallSpecial has 10 frames of landing lag
        if (frame.frame === st.ledgedashLandFrame + 10) {
          let galintFrames = 0;
          if (post.hurtboxCollisionState === 1 || post.hurtboxCollisionState === 2) {
            galintFrames = 4; // minimum estimate when intangible on actionable frame 1
          }
          st.galintSamples.push(galintFrames);
          st.inLedgeDash = false;
        }
      }

      // 5. Shield Drops
      if (prevAnim && isShield(prevAnim) && (anim === ACTION_STATES.PASS || anim === 0xB4) && post.positionY > 1.0) {
        if (pre && pre.joystickY < -0.55 && pre.joystickY > -0.85) {
          m.shieldDrops++;
        }
      }

      // 6. Out of Shield (OOS) Options
      if (prevAnim && isShield(prevAnim) && !isShield(anim)) {
        if (anim === ACTION_STATES.GRAB) m.oosGrabs++;
        else if (anim === ACTION_STATES.ATTACK_USMASH) m.oosSmashes++;
        else if (anim >= ACTION_STATES.AERIAL_LANDING_START && anim <= ACTION_STATES.AERIAL_LANDING_END) m.oosAerials++;
        else if (anim === ACTION_STATES.KNEE_BEND) {
          // Track jumpsquat OOS
          m.oosAerials++;
        } else if (anim === ACTION_STATES.ROLL_F || anim === ACTION_STATES.ROLL_B) m.oosRolls++;
        else if (anim === ACTION_STATES.SPOT_DODGE) m.oosSpotdodges++;
        else if (anim === ACTION_STATES.LANDING_FALL_SPECIAL) m.oosWavedashes++;
      }

      // 7. Crouch Cancel & Amsah Tech
      if (prevAnim && (prevAnim === ACTION_STATES.SQUAT || prevAnim === ACTION_STATES.SQUAT_WAIT)) {
        if (prevPost && post.percent > prevPost.percent && !post.isAirborne && !isDamage(anim)) {
          m.crouchCancels++;
        }
      }

      // 8. V-Cancel (Airborne damage reduction via 2-3f pre L/R press)
      if (post.isAirborne && isDamage(anim) && (!prevAnim || !isDamage(prevAnim))) {
        // Check pre-frames 2-3 frames prior
        const pre2 = st.recentPreInputs[st.recentPreInputs.length - 3];
        const pre4 = st.recentPreInputs[st.recentPreInputs.length - 5];
        if (pre2 && (pre2.buttons & 0x0060) && (!pre4 || !(pre4.buttons & 0x0060))) {
          m.vCancels++;
        }
      }

      // 9. Slide-off DI (hit on platform lip -> instantly falling)
      if (prevPost && isDamage(prevAnim) && anim === ACTION_STATES.FALL && Math.abs(post.positionY - prevPost.positionY) < 5) {
        m.slideOffs++;
      }

      // 10. Teching
      if (isNewAnim) {
        if (anim === ACTION_STATES.TECH_NEUTRAL) m.techNeutral++;
        else if (anim === ACTION_STATES.TECH_F) m.techIn++;
        else if (anim === ACTION_STATES.TECH_B) m.techAway++;
        else if (anim === ACTION_STATES.TECH_MISS_UP || anim === ACTION_STATES.TECH_MISS_DOWN) m.techMiss++;
        else if (anim === ACTION_STATES.WALL_TECH || anim === ACTION_STATES.WALL_TECH_JUMP) m.wallTechSuccess++;
        else if (anim === ACTION_STATES.MISSED_WALL_TECH) m.wallTechMiss++;
      }

      // 11. Powershielding (bit 5 of stateBitFlags4)
      if (post.stateBitFlags4 && (post.stateBitFlags4 & 0x20)) {
        m.powershieldsPhysical++;
      }

      // 12. Smash DI (SDI)
      if (post.hitlagRemaining > 0 && prevPost && prevPost.hitlagRemaining > 0) {
        const dx = post.positionX - prevPost.positionX;
        const dy = post.positionY - prevPost.positionY;
        const dist = Math.hypot(dx, dy);
        if (dist > 0.7) {
          m.sdiInputs++;
        }
      }

      // 13. Grabs (JC Grab vs Boost Grab)
      if (anim === ACTION_STATES.GRAB && prevAnim === ACTION_STATES.KNEE_BEND) {
        m.jcGrabs++;
      }
      if (anim === ACTION_STATES.DASH_GRAB && prevAnim === ACTION_STATES.ATTACK_DASH) {
        m.boostGrabs++;
      }

      // 14. Spacie Multishining
      if (isShine(anim) && isNewAnim) {
        if (st.lastShineFrame > 0 && (frame.frame - st.lastShineFrame <= 12)) {
          m.multishines++;
        }
        st.lastShineFrame = frame.frame;
      }
    }
  }

  /**
   * Finalize metrics and compute rates
   */
  fetch() {
    return this.players.map(pIdx => {
      const m = this.state[pIdx].metrics;
      const totalLCancels = m.lCancelSuccess + m.lCancelFail;
      m.lCancelRate = totalLCancels > 0 ? (m.lCancelSuccess / totalLCancels) * 100 : 0;

      const galintSamples = this.state[pIdx].galintSamples;
      m.avgGalintFrames = galintSamples.length > 0 
        ? galintSamples.reduce((a, b) => a + b, 0) / galintSamples.length 
        : 0;

      return {
        playerIndex: pIdx,
        ...m
      };
    });
  }
}
