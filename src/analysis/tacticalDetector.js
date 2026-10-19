import { getStageGeometry } from '../constants/stageGeometry.js';
import { getRecoveryRange } from '../constants/recoveryData.js';
import { 
  isDamage, 
  isShield, 
  isAttack, 
  isWakeup, 
  isDownWait, 
  isStandardLedgeOption, 
  isCliffOption, 
  isTech, 
  isLedge, 
  ACTION_STATES 
} from '../constants/actionStates.js';

function isPermittedLedgedashAirborneState(anim) {
  return (
    anim === ACTION_STATES.AIR_DODGE ||
    (anim >= ACTION_STATES.JUMP_F && anim <= 0x1C) ||
    (anim >= ACTION_STATES.FALL && anim <= 0x23) ||
    (anim >= ACTION_STATES.SHINE_START && anim <= ACTION_STATES.SHINE_END)
  );
}

export class TacticalDetector {
  /**
   * @param {Object} settings 
   */
  constructor(settings) {
    this.settings = settings;
    this.stageId = settings.stageId;
    this.geometry = getStageGeometry(this.stageId);
    this.players = settings.players.map(p => p.playerIndex);

    // Stocks
    this.stocks = [];
    this.playerStocks = {};
    for (const p of settings.players) {
      this.playerStocks[p.playerIndex] = {
        currentStock: p.startStocks || 4,
        startFrame: -39,
        startPercent: 0,
      };
    }

    // Conversions / Punishes
    this.conversions = [];
    this.activeConversions = {}; // pIdx -> active conversion

    // Edgeguards
    this.edgeguards = [];

    // Shield Pressure
    this.pressureEvents = [];
    this.activePressure = {}; // attacker -> active sequence

    // Phantom Hits
    this.phantomHits = [];

    // Habit & Vulnerability Profiling Engine (M1)
    this.habitStats = {};
    this.habitState = {};
    for (const pIdx of this.players) {
      this.habitStats[pIdx] = {
        climb_count: 0,
        climb_punished: 0,
        attack_count: 0,
        attack_punished: 0,
        roll_count: 0,
        roll_punished: 0,
        jump_count: 0,
        jump_punished: 0,
        ledgedash_count: 0,
        ledgedash_punished: 0,
        tech_neutral_count: 0,
        tech_neutral_punished: 0,
        tech_forward_count: 0,
        tech_forward_punished: 0,
        tech_back_count: 0,
        tech_back_punished: 0,
        tech_miss_count: 0,
        tech_miss_punished: 0,
        wakeup_stand_count: 0,
        wakeup_stand_punished: 0,
        wakeup_forward_count: 0,
        wakeup_forward_punished: 0,
        wakeup_back_count: 0,
        wakeup_back_punished: 0,
        wakeup_attack_count: 0,
        wakeup_attack_punished: 0,
        grabs_shield_pressure: 0,
        grabs_scramble: 0,
        grabs_neutral: 0,
        neutral_resets: 0,
        over_extensions: 0,
        oos_roll_count: 0,
        oos_roll_punished: 0,
        oos_spotdodge_count: 0,
        oos_spotdodge_punished: 0,
        oos_grab_count: 0,
        oos_grab_punished: 0,
        oos_aerial_count: 0,
        oos_aerial_punished: 0,
        corner_drift_count: 0,
      };

      this.habitState[pIdx] = {
        activePunishTrackers: [],
        ledgedashCandidate: null,
        lastCliffWaitFrame: -999,
        lastShieldFrame: -999,
        lastDamageFrame: -999,
        lastCornerDriftFrame: -999,
        activeTransitionWindow: null,
        jumpsquatOosFrame: -999,
      };
    }

    this.getupEvents = [];
    this.grabTriggers = [];
    this.transitionDecisions = [];
    this.escapeSequences = [];
  }

  processFrame(frame, prevFrame) {
    if (!frame || !frame.players) return;

    const fNum = frame.frame;

    // 1. Check Stocks & Deaths
    for (const pIdx of this.players) {
      const p = frame.players[pIdx]?.post;
      const prevP = prevFrame?.players?.[pIdx]?.post;
      if (!p || !prevP) continue;

      if (p.stocksRemaining < prevP.stocksRemaining) {
        // Stock lost
        const killerIdx = p.lastHitBy ?? (this.players.find(x => x !== pIdx) ?? 0);
        let koDir = 'bottom';
        if (this.geometry) {
          if (prevP.positionY >= this.geometry.blastzone.top - 15) koDir = 'top';
          else if (prevP.positionX <= this.geometry.blastzone.left + 15) koDir = 'left';
          else if (prevP.positionX >= this.geometry.blastzone.right - 15) koDir = 'right';
        }

        const stockRecord = {
          playerIndex: pIdx,
          stockNumber: this.playerStocks[pIdx].currentStock,
          startFrame: this.playerStocks[pIdx].startFrame,
          endFrame: fNum,
          startPercent: this.playerStocks[pIdx].startPercent,
          endPercent: prevP.percent ?? 0,
          deathAnimation: p.actionStateId,
          koDirection: koDir,
          killedBy: killerIdx,
        };
        this.stocks.push(stockRecord);

        // Terminate any active conversion on victim with didKill = true
        if (this.activeConversions[pIdx]) {
          const conv = this.activeConversions[pIdx];
          conv.endFrame = fNum;
          conv.endPercent = prevP.percent ?? 0;
          conv.didKill = true;
          this.conversions.push(conv);
          delete this.activeConversions[pIdx];
        }

        // Reset next stock tracker
        this.playerStocks[pIdx] = {
          currentStock: p.stocksRemaining,
          startFrame: fNum,
          startPercent: 0,
        };
      }
    }

    // 2. Punishes & Conversions (Singles 1v1)
    if (this.players.length === 2) {
      const p0Idx = this.players[0];
      const p1Idx = this.players[1];
      this._handleConversion(p0Idx, p1Idx, frame, prevFrame);
      this._handleConversion(p1Idx, p0Idx, frame, prevFrame);
      this._handlePressure(p0Idx, p1Idx, frame, prevFrame);
      this._handlePressure(p1Idx, p0Idx, frame, prevFrame);
      this._handlePhantom(p0Idx, p1Idx, frame, prevFrame);
      this._handleHabits(frame, prevFrame);
    }
  }

  _handleConversion(attackerIdx, victimIdx, frame, prevFrame) {
    const fNum = frame.frame;
    const att = frame.players[attackerIdx]?.post;
    const vic = frame.players[victimIdx]?.post;
    const prevVic = prevFrame?.players?.[victimIdx]?.post;
    if (!att || !vic || !prevVic) return;

    const vicIsDamaged = isDamage(vic.actionStateId) || (vic.percent > prevVic.percent);
    const damageTaken = vic.percent - prevVic.percent;

    let conv = this.activeConversions[victimIdx];

    if (vicIsDamaged && damageTaken > 0) {
      if (!conv) {
        // Start new conversion
        conv = {
          attackerIndex: attackerIdx,
          victimIndex: victimIdx,
          startFrame: fNum,
          endFrame: fNum,
          startPercent: prevVic.percent,
          endPercent: vic.percent,
          damageDealt: damageTaken,
          moveCount: 1,
          openingType: 'neutral-win',
          didKill: false,
          moves: [
            {
              frame: fNum,
              moveId: att.lastAttackLanded ?? 0,
              hitCount: 1,
              damage: damageTaken,
            }
          ],
          resetTimer: 0,
        };
        this.activeConversions[victimIdx] = conv;
      } else {
        // Extend existing conversion
        conv.endFrame = fNum;
        conv.endPercent = vic.percent;
        conv.damageDealt += damageTaken;
        conv.moveCount++;
        conv.resetTimer = 0;
        conv.moves.push({
          frame: fNum,
          moveId: att.lastAttackLanded ?? 0,
          hitCount: 1,
          damage: damageTaken,
        });
      }
    } else if (conv) {
      conv.resetTimer++;
      // Terminate after 45 frames of victim being out of hitstun/tumble
      if (conv.resetTimer > 45) {
        this.conversions.push(conv);
        // Advantage neutralized for attacker
        if (this.habitState && this.habitState[conv.attackerIndex]) {
          const currentDist = Math.hypot(att.positionX - vic.positionX, att.positionY - vic.positionY);
          this.habitState[conv.attackerIndex].activeTransitionWindow = {
            startFrame: fNum,
            endFrame: fNum + 45,
            startDistance: currentDist,
            committedAttack: false,
            attackStartFrame: null,
            attackAnim: null,
            hitLanded: false,
            evaluated: false,
          };
        }
        delete this.activeConversions[victimIdx];
      }
    }
  }

  _handlePressure(attackerIdx, defenderIdx, frame, prevFrame) {
    const fNum = frame.frame;
    const att = frame.players[attackerIdx]?.post;
    const def = frame.players[defenderIdx]?.post;
    if (!att || !def) return;

    const dist = Math.hypot(att.positionX - def.positionX, att.positionY - def.positionY);
    const inCloseProximity = dist < 32.0;
    const defShielding = isShield(def.actionStateId);

    let pr = this.activePressure[attackerIdx];

    if (inCloseProximity && defShielding) {
      if (!pr) {
        pr = {
          attackerIndex: attackerIdx,
          defenderIndex: defenderIdx,
          startFrame: fNum,
          endFrame: fNum,
          shieldHits: 0,
          shieldFrames: 1,
          scrambleFrames: 0,
          hadOpening: false,
          endedInKill: false,
          pressureScore: 10,
          resetTimer: 0,
        };
        this.activePressure[attackerIdx] = pr;
      } else {
        pr.endFrame = fNum;
        pr.shieldFrames++;
        pr.resetTimer = 0;
      }
    } else if (pr) {
      pr.resetTimer++;
      if (pr.resetTimer > 30) {
        if (pr.shieldFrames >= 20) {
          pr.pressureScore = Math.min(100, pr.shieldFrames * 1.5 + pr.shieldHits * 10);
          this.pressureEvents.push(pr);
        }
        // Advantage neutralized for attacker without opening
        if (!pr.hadOpening && this.habitState && this.habitState[attackerIdx]) {
          const currentDist = Math.hypot(att.positionX - def.positionX, att.positionY - def.positionY);
          this.habitState[attackerIdx].activeTransitionWindow = {
            startFrame: fNum,
            endFrame: fNum + 45,
            startDistance: currentDist,
            committedAttack: false,
            attackStartFrame: null,
            attackAnim: null,
            hitLanded: false,
            evaluated: false,
          };
        }
        delete this.activePressure[attackerIdx];
      }
    }
  }

  _handlePhantom(p0Idx, p1Idx, frame, prevFrame) {
    const p0 = frame.players[p0Idx]?.post;
    const p1 = frame.players[p1Idx]?.post;
    const prev0 = prevFrame?.players?.[p0Idx]?.post;
    const prev1 = prevFrame?.players?.[p1Idx]?.post;
    if (!p0 || !p1 || !prev0 || !prev1) return;

    // Signature A: Asymmetric Hitlag (defender frozen, attacker not)
    // If p0 is defender
    if (p0.hitlagRemaining > 0 && prev0.hitlagRemaining === 0 && p1.hitlagRemaining === 0) {
      if (!isDamage(p0.actionStateId)) {
        this.phantomHits.push({
          frame: frame.frame,
          attackerIndex: p1Idx,
          victimIndex: p0Idx,
          attackerState: p1.actionStateId,
        });
      }
    }
    // If p1 is defender
    if (p1.hitlagRemaining > 0 && prev1.hitlagRemaining === 0 && p0.hitlagRemaining === 0) {
      if (!isDamage(p1.actionStateId)) {
        this.phantomHits.push({
          frame: frame.frame,
          attackerIndex: p0Idx,
          victimIndex: p1Idx,
          attackerState: p0.actionStateId,
        });
      }
    }
  }

  _handleHabits(frame, prevFrame) {
    if (this.players.length !== 2) return;
    const p0Idx = this.players[0];
    const p1Idx = this.players[1];
    this._processPlayerHabits(p0Idx, p1Idx, frame, prevFrame);
    this._processPlayerHabits(p1Idx, p0Idx, frame, prevFrame);
  }

  _processPlayerHabits(pIdx, oppIdx, frame, prevFrame) {
    const p = frame.players[pIdx]?.post;
    const opp = frame.players[oppIdx]?.post;
    const prevP = prevFrame?.players?.[pIdx]?.post;
    const prevOpp = prevFrame?.players?.[oppIdx]?.post;
    if (!p || !opp) return;

    const fNum = frame.frame;
    const anim = p.actionStateId;
    const prevAnim = prevP ? prevP.actionStateId : null;
    const isNewAnim = anim !== prevAnim;
    const oppAnim = opp.actionStateId;
    const prevOppAnim = prevOpp ? prevOpp.actionStateId : null;

    const st = this.habitState[pIdx];
    const oppSt = this.habitState[oppIdx];
    const stats = this.habitStats[pIdx];

    const dist = Math.hypot(p.positionX - opp.positionX, p.positionY - opp.positionY);
    const xMax = this.geometry?.ground?.xMax ?? 85.0;

    // 1. Update State History
    if (isShield(anim)) {
      st.lastShieldFrame = fNum;
    }
    if (isShield(oppAnim)) {
      oppSt.lastShieldFrame = fNum;
    }
    const playerTookDamage = prevP ? ((p.percent > prevP.percent) || (isDamage(anim) && !isDamage(prevAnim))) : false;
    const oppTookHit = prevOpp ? ((opp.percent > prevOpp.percent) || (isDamage(oppAnim) && !isDamage(prevOppAnim))) : false;

    if (isDamage(anim) || playerTookDamage) {
      st.lastDamageFrame = fNum;
    }
    if (isDamage(oppAnim) || oppTookHit) {
      oppSt.lastDamageFrame = fNum;
    }

    // 2. Evaluate Active Punish Trackers
    const remainingTrackers = [];
    for (const tracker of st.activePunishTrackers) {
      if (oppTookHit && !playerTookDamage) {
        // Landed counter-hit before taking damage! Safe, not punished.
        tracker.eventRef.isPunished = false;
      } else if (playerTookDamage) {
        // Punished during vulnerable end-lag or strict 30f post-actionable recovery window!
        tracker.eventRef.isPunished = true;
        tracker.eventRef.punishFrame = fNum;
        if (tracker.punishCol && stats[tracker.punishCol] !== undefined) {
          stats[tracker.punishCol]++;
        }
      } else {
        // Still tracking
        if (anim === tracker.actionStateId) {
          // Still in the animation
          remainingTrackers.push(tracker);
        } else {
          // Action animation ended; now in post-actionable recovery
          if (tracker.postActionableStartFrame === null) {
            tracker.postActionableStartFrame = fNum;
          }
          const elapsed = fNum - tracker.postActionableStartFrame;
          if (elapsed < 30) {
            remainingTrackers.push(tracker);
          } else {
            // Strict 30-frame window expired safely without taking damage
            tracker.eventRef.isPunished = false;
          }
        }
      }
    }
    st.activePunishTrackers = remainingTrackers;

    const registerPunish = (category, option, countCol, punishCol, eventRef, actionStateId) => {
      st.activePunishTrackers.push({
        category,
        option,
        countCol,
        punishCol,
        eventRef,
        actionStateId,
        postActionableStartFrame: null,
      });
    };

    // 3. Ledge Options & 35f Ledgedash Heuristic
    if (anim === ACTION_STATES.CLIFF_WAIT) {
      st.lastCliffWaitFrame = fNum;
      st.ledgedashCandidate = { startFrame: fNum, valid: true };
    }

    if (st.ledgedashCandidate && st.ledgedashCandidate.valid) {
      if (fNum - st.ledgedashCandidate.startFrame > 35) {
        st.ledgedashCandidate.valid = false;
      } else if (anim === ACTION_STATES.CLIFF_CATCH) {
        st.ledgedashCandidate.valid = false;
      } else if (isDamage(anim)) {
        st.ledgedashCandidate.valid = false;
      } else if (isStandardLedgeOption(anim)) {
        st.ledgedashCandidate.valid = false;
      } else if (
        anim !== ACTION_STATES.CLIFF_WAIT &&
        anim !== ACTION_STATES.LANDING_FALL_SPECIAL &&
        (p.isAirborne === false || !isPermittedLedgedashAirborneState(anim))
      ) {
        st.ledgedashCandidate.valid = false;
      } else if (anim === ACTION_STATES.LANDING_FALL_SPECIAL && isNewAnim) {
        // Reached LANDING_FALL_SPECIAL on stage surface (|X| <= xMax) within <= 35 frames
        if (Math.abs(p.positionX) <= xMax && (fNum - st.ledgedashCandidate.startFrame <= 35)) {
          stats.ledgedash_count++;
          const ev = {
            frame: fNum,
            playerIndex: pIdx,
            category: 'ledge',
            option: 'ledgedash',
            actionStateId: anim,
            positionX: p.positionX,
            positionY: p.positionY,
            x: p.positionX,
            y: p.positionY,
            isPunished: false,
            punishFrame: null,
          };
          this.getupEvents.push(ev);
          registerPunish('ledge', 'ledgedash', 'ledgedash_count', 'ledgedash_punished', ev, anim);
        }
        st.ledgedashCandidate = null;
      }
    }

    if (isNewAnim && isStandardLedgeOption(anim)) {
      let option = 'climb';
      let countCol = 'climb_count';
      let punishCol = 'climb_punished';

      if (anim === ACTION_STATES.CLIFF_CLIMB_SLOW || anim === ACTION_STATES.CLIFF_CLIMB_QUICK) {
        option = 'climb';
        countCol = 'climb_count';
        punishCol = 'climb_punished';
      } else if (anim === ACTION_STATES.CLIFF_ATTACK_SLOW || anim === ACTION_STATES.CLIFF_ATTACK_QUICK) {
        option = 'attack';
        countCol = 'attack_count';
        punishCol = 'attack_punished';
      } else if (anim === ACTION_STATES.CLIFF_ESCAPE_SLOW || anim === ACTION_STATES.CLIFF_ESCAPE_QUICK) {
        option = 'roll';
        countCol = 'roll_count';
        punishCol = 'roll_punished';
      } else if (anim === ACTION_STATES.CLIFF_JUMP_SLOW || anim === ACTION_STATES.CLIFF_JUMP_QUICK) {
        option = 'jump';
        countCol = 'jump_count';
        punishCol = 'jump_punished';
      }

      stats[countCol]++;
      const ev = {
        frame: fNum,
        playerIndex: pIdx,
        category: 'ledge',
        option,
        actionStateId: anim,
        positionX: p.positionX,
        positionY: p.positionY,
        x: p.positionX,
        y: p.positionY,
        isPunished: false,
        punishFrame: null,
      };
      this.getupEvents.push(ev);
      registerPunish('ledge', option, countCol, punishCol, ev, anim);
    }

    // 4. Ground Tech Options
    if (isNewAnim) {
      let option = null;
      let countCol = null;
      let punishCol = null;

      if (anim === ACTION_STATES.TECH_NEUTRAL) {
        option = 'tech_neutral';
        countCol = 'tech_neutral_count';
        punishCol = 'tech_neutral_punished';
      } else if (anim === ACTION_STATES.TECH_F) {
        option = 'tech_forward';
        countCol = 'tech_forward_count';
        punishCol = 'tech_forward_punished';
      } else if (anim === ACTION_STATES.TECH_B) {
        option = 'tech_back';
        countCol = 'tech_back_count';
        punishCol = 'tech_back_punished';
      } else if (anim === ACTION_STATES.TECH_MISS_UP || anim === ACTION_STATES.TECH_MISS_DOWN) {
        option = 'tech_miss';
        countCol = 'tech_miss_count';
        punishCol = 'tech_miss_punished';
      } else if (anim === ACTION_STATES.WALL_TECH || anim === ACTION_STATES.WALL_TECH_JUMP) {
        option = 'wall_tech';
      }

      if (option) {
        if (countCol) stats[countCol]++;
        const ev = {
          frame: fNum,
          playerIndex: pIdx,
          category: 'tech',
          option,
          actionStateId: anim,
          positionX: p.positionX,
          positionY: p.positionY,
          x: p.positionX,
          y: p.positionY,
          isPunished: false,
          punishFrame: null,
        };
        this.getupEvents.push(ev);
        if (punishCol) {
          registerPunish('tech', option, countCol, punishCol, ev, anim);
        }
      }
    }

    // 5. Missed-Tech Wakeup Options
    if (isNewAnim && isWakeup(anim)) {
      let option = 'wakeup_stand';
      let countCol = 'wakeup_stand_count';
      let punishCol = 'wakeup_stand_punished';

      if (anim === ACTION_STATES.DOWN_STAND_U || anim === ACTION_STATES.DOWN_STAND_D) {
        option = 'wakeup_stand';
        countCol = 'wakeup_stand_count';
        punishCol = 'wakeup_stand_punished';
      } else if (anim === ACTION_STATES.DOWN_FORWARD_U || anim === ACTION_STATES.DOWN_FORWARD_D) {
        option = 'wakeup_forward';
        countCol = 'wakeup_forward_count';
        punishCol = 'wakeup_forward_punished';
      } else if (anim === ACTION_STATES.DOWN_BACK_U || anim === ACTION_STATES.DOWN_BACK_D) {
        option = 'wakeup_back';
        countCol = 'wakeup_back_count';
        punishCol = 'wakeup_back_punished';
      } else if (anim === ACTION_STATES.DOWN_ATTACK_U || anim === ACTION_STATES.DOWN_ATTACK_D) {
        option = 'wakeup_attack';
        countCol = 'wakeup_attack_count';
        punishCol = 'wakeup_attack_punished';
      }

      stats[countCol]++;
      const ev = {
        frame: fNum,
        playerIndex: pIdx,
        category: 'wakeup',
        option,
        actionStateId: anim,
        positionX: p.positionX,
        positionY: p.positionY,
        x: p.positionX,
        y: p.positionY,
        isPunished: false,
        punishFrame: null,
      };
      this.getupEvents.push(ev);
      registerPunish('wakeup', option, countCol, punishCol, ev, anim);
    }

    // 6. Grab Initiation Context
    if (isNewAnim && (anim === ACTION_STATES.GRAB || anim === ACTION_STATES.DASH_GRAB)) {
      let grabType = 'neutral';
      if (fNum - oppSt.lastShieldFrame <= 15) {
        // Shield-pressure grab (within 15f of opponent shielding incoming attack)
        stats.grabs_shield_pressure++;
        grabType = 'shield_pressure';
      } else {
        const neitherInHitstun30f = (fNum - st.lastDamageFrame > 30) && (fNum - oppSt.lastDamageFrame > 30);
        const neitherInShield30f = (fNum - st.lastShieldFrame > 30) && (fNum - oppSt.lastShieldFrame > 30);
        const oppActionable = !isDamage(oppAnim) && !isShield(oppAnim) && oppAnim !== ACTION_STATES.DAMAGE_FALL &&
                              !isLedge(oppAnim) && !isTech(oppAnim) && !isWakeup(oppAnim) && !isDownWait(oppAnim);

        if (dist <= 18.0 && neitherInHitstun30f && neitherInShield30f && oppActionable) {
          stats.grabs_scramble++;
          grabType = 'scramble';
        } else {
          stats.grabs_neutral++;
          grabType = 'neutral';
        }
      }

      this.grabTriggers.push({
        frame: fNum,
        playerIndex: pIdx,
        type: grabType,
        distance: dist,
        positionX: p.positionX,
        positionY: p.positionY,
        x: p.positionX,
        y: p.positionY,
      });
    }

    // 7. Neutral Reset vs Over-Extension Boundary (45f window)
    if (st.activeTransitionWindow && !st.activeTransitionWindow.evaluated) {
      const tw = st.activeTransitionWindow;
      if (isNewAnim && (isAttack(anim) || anim === ACTION_STATES.GRAB || anim === ACTION_STATES.DASH_GRAB)) {
        tw.committedAttack = true;
        tw.attackAnim = anim;
        tw.attackStartFrame = fNum;
        tw.hitLanded = false;
      }

      if (tw.committedAttack) {
        if (oppTookHit) {
          tw.hitLanded = true;
        }

        if (playerTookDamage) {
          stats.over_extensions++;
          tw.evaluated = true;
          this.transitionDecisions.push({
            frame: fNum,
            playerIndex: pIdx,
            type: 'over_extension',
            actionStateId: tw.attackAnim,
            distanceDelta: dist - tw.startDistance,
            counterHit: true,
            positionX: p.positionX,
            positionY: p.positionY,
            x: p.positionX,
            y: p.positionY,
          });
          st.activeTransitionWindow = null;
        } else if (anim !== tw.attackAnim) {
          // Attack animation completed
          if (!tw.hitLanded) {
            // Whiffed
            stats.over_extensions++;
            tw.evaluated = true;
            this.transitionDecisions.push({
              frame: fNum,
              playerIndex: pIdx,
              type: 'over_extension',
              actionStateId: tw.attackAnim,
              distanceDelta: dist - tw.startDistance,
              counterHit: false,
              positionX: p.positionX,
              positionY: p.positionY,
              x: p.positionX,
              y: p.positionY,
            });
            st.activeTransitionWindow = null;
          } else {
            // Attack landed successfully; transition window evaluated without over-extension
            tw.evaluated = true;
            st.activeTransitionWindow = null;
          }
        }
      } else if (fNum >= tw.endFrame) {
        const deltaD = dist - tw.startDistance;
        if (deltaD > 0) {
          stats.neutral_resets++;
          this.transitionDecisions.push({
            frame: fNum,
            playerIndex: pIdx,
            type: 'neutral_reset',
            actionStateId: anim,
            distanceDelta: deltaD,
            counterHit: false,
            positionX: p.positionX,
            positionY: p.positionY,
            x: p.positionX,
            y: p.positionY,
          });
        }
        tw.evaluated = true;
        st.activeTransitionWindow = null;
      }
    }

    // 8. Defensive Vulnerabilities & Escape Routes
    // Out of Shield
    if (prevP && isShield(prevP.actionStateId) && !isShield(anim)) {
      if (anim === ACTION_STATES.ROLL_F || anim === ACTION_STATES.ROLL_B) {
        stats.oos_roll_count++;
        const ev = {
          frame: fNum,
          playerIndex: pIdx,
          source: 'oos',
          option: 'roll',
          actionStateId: anim,
          positionX: p.positionX,
          positionY: p.positionY,
          x: p.positionX,
          y: p.positionY,
          isPunished: false,
          punishFrame: null,
        };
        this.escapeSequences.push(ev);
        registerPunish('oos', 'roll', 'oos_roll_count', 'oos_roll_punished', ev, anim);
      } else if (anim === ACTION_STATES.SPOT_DODGE) {
        stats.oos_spotdodge_count++;
        const ev = {
          frame: fNum,
          playerIndex: pIdx,
          source: 'oos',
          option: 'spotdodge',
          actionStateId: anim,
          positionX: p.positionX,
          positionY: p.positionY,
          x: p.positionX,
          y: p.positionY,
          isPunished: false,
          punishFrame: null,
        };
        this.escapeSequences.push(ev);
        registerPunish('oos', 'spotdodge', 'oos_spotdodge_count', 'oos_spotdodge_punished', ev, anim);
      } else if (anim === ACTION_STATES.GRAB) {
        stats.oos_grab_count++;
        const ev = {
          frame: fNum,
          playerIndex: pIdx,
          source: 'oos',
          option: 'grab',
          actionStateId: anim,
          positionX: p.positionX,
          positionY: p.positionY,
          x: p.positionX,
          y: p.positionY,
          isPunished: false,
          punishFrame: null,
        };
        this.escapeSequences.push(ev);
        registerPunish('oos', 'grab', 'oos_grab_count', 'oos_grab_punished', ev, anim);
      } else if (anim >= 0x41 && anim <= 0x45) {
        stats.oos_aerial_count++;
        const ev = {
          frame: fNum,
          playerIndex: pIdx,
          source: 'oos',
          option: 'aerial',
          actionStateId: anim,
          positionX: p.positionX,
          positionY: p.positionY,
          x: p.positionX,
          y: p.positionY,
          isPunished: false,
          punishFrame: null,
        };
        this.escapeSequences.push(ev);
        registerPunish('oos', 'aerial', 'oos_aerial_count', 'oos_aerial_punished', ev, anim);
      } else if (anim === ACTION_STATES.KNEE_BEND) {
        st.jumpsquatOosFrame = fNum;
      }
    }

    // Jumpsquat OOS leading to aerial
    if (st.jumpsquatOosFrame > 0 && fNum - st.jumpsquatOosFrame <= 6) {
      if (anim >= 0x41 && anim <= 0x45 && isNewAnim) {
        stats.oos_aerial_count++;
        const ev = {
          frame: fNum,
          playerIndex: pIdx,
          source: 'oos',
          option: 'aerial',
          actionStateId: anim,
          positionX: p.positionX,
          positionY: p.positionY,
          x: p.positionX,
          y: p.positionY,
          isPunished: false,
          punishFrame: null,
        };
        this.escapeSequences.push(ev);
        registerPunish('oos', 'aerial', 'oos_aerial_count', 'oos_aerial_punished', ev, anim);
        st.jumpsquatOosFrame = -999;
      } else if (anim === ACTION_STATES.ATTACK_USMASH) {
        st.jumpsquatOosFrame = -999;
      } else if (fNum - st.jumpsquatOosFrame > 6) {
        st.jumpsquatOosFrame = -999;
      }
    }

    // Corner Drift
    if (prevP) {
      const driftingToEdge = Math.abs(p.positionX) > Math.abs(prevP.positionX) + 0.05;
      const inCornerZone = Math.abs(p.positionX) >= xMax - 25.0;
      const unforcedConcession = !isDamage(anim) && anim !== ACTION_STATES.DAMAGE_FALL && (p.percent === prevP.percent);
      const cooldownElapsed = fNum - st.lastCornerDriftFrame >= 30;

      if (dist <= 20.0 && driftingToEdge && inCornerZone && unforcedConcession && cooldownElapsed) {
        stats.corner_drift_count++;
        st.lastCornerDriftFrame = fNum;
        this.escapeSequences.push({
          frame: fNum,
          playerIndex: pIdx,
          source: 'corner_drift',
          option: 'corner_drift',
          distance: dist,
          positionX: p.positionX,
          positionY: p.positionY,
          x: p.positionX,
          y: p.positionY,
        });
      }
    }
  }

  /**
   * Returns raw habit counters matching player_habits_stats schema columns
   * @param {number} playerIndex 
   */
  getHabitStats(playerIndex) {
    if (!this.habitStats[playerIndex]) {
      return {
        climb_count: 0,
        climb_punished: 0,
        attack_count: 0,
        attack_punished: 0,
        roll_count: 0,
        roll_punished: 0,
        jump_count: 0,
        jump_punished: 0,
        ledgedash_count: 0,
        ledgedash_punished: 0,
        tech_neutral_count: 0,
        tech_neutral_punished: 0,
        tech_forward_count: 0,
        tech_forward_punished: 0,
        tech_back_count: 0,
        tech_back_punished: 0,
        tech_miss_count: 0,
        tech_miss_punished: 0,
        wakeup_stand_count: 0,
        wakeup_stand_punished: 0,
        wakeup_forward_count: 0,
        wakeup_forward_punished: 0,
        wakeup_back_count: 0,
        wakeup_back_punished: 0,
        wakeup_attack_count: 0,
        wakeup_attack_punished: 0,
        grabs_shield_pressure: 0,
        grabs_scramble: 0,
        grabs_neutral: 0,
        neutral_resets: 0,
        over_extensions: 0,
        oos_roll_count: 0,
        oos_roll_punished: 0,
        oos_spotdodge_count: 0,
        oos_spotdodge_punished: 0,
        oos_grab_count: 0,
        oos_grab_punished: 0,
        oos_aerial_count: 0,
        oos_aerial_punished: 0,
        corner_drift_count: 0,
      };
    }
    return { ...this.habitStats[playerIndex] };
  }

  /**
   * Returns granular habit events payload
   */
  getHabitPayload() {
    return {
      getupEvents: this.getupEvents,
      grabTriggers: this.grabTriggers,
      transitionDecisions: this.transitionDecisions,
      escapeSequences: this.escapeSequences,
    };
  }

  fetch() {
    // Flush any pending conversions
    for (const pIdx of Object.keys(this.activeConversions)) {
      this.conversions.push(this.activeConversions[pIdx]);
    }
    this.activeConversions = {};

    return {
      stocks: this.stocks,
      conversions: this.conversions,
      edgeguards: this.edgeguards,
      pressureEvents: this.pressureEvents,
      phantomHits: this.phantomHits,
      habits: this.getHabitPayload(),
    };
  }
}
