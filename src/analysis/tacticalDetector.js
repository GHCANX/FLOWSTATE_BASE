import { getStageGeometry } from '../constants/stageGeometry.js';
import { getRecoveryRange } from '../constants/recoveryData.js';
import { isDamage, isShield, ACTION_STATES } from '../constants/actionStates.js';

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
    };
  }
}
