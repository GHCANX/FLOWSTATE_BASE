'use strict';

var framedataUtils = require('../melee/framedataUtils.cjs');
var exists = require('../utils/exists.cjs');
var keyBy = require('../utils/keyBy.cjs');
var common = require('./common.cjs');

// Frame pattern that indicates a dash dance turn was executed
const dashDanceAnimations = [common.State.DASH, common.State.TURN, common.State.DASH];
class ActionsComputer {
    playerPermutations = [];
    state = new Map();
    setup(settings) {
        this.state = new Map();
        this.playerPermutations = common.getSinglesPlayerPermutationsFromSettings(settings);
        this.playerPermutations.forEach((indices) => {
            const playerCounts = {
                playerIndex: indices.playerIndex,
                wavedashCount: 0,
                wavelandCount: 0,
                airDodgeCount: 0,
                dashDanceCount: 0,
                spotDodgeCount: 0,
                ledgegrabCount: 0,
                rollCount: 0,
                tauntCount: 0,
                edgeCancelCount: {
                    success: 0,
                    slow: 0,
                },
                lCancelCount: {
                    success: 0,
                    fail: 0,
                },
                attackCount: {
                    jab1: 0,
                    jab2: 0,
                    jab3: 0,
                    jabm: 0,
                    dash: 0,
                    ftilt: 0,
                    utilt: 0,
                    dtilt: 0,
                    fsmash: 0,
                    usmash: 0,
                    dsmash: 0,
                    nair: 0,
                    fair: 0,
                    bair: 0,
                    uair: 0,
                    dair: 0,
                },
                grabCount: {
                    success: 0,
                    fail: 0,
                },
                throwCount: {
                    up: 0,
                    forward: 0,
                    back: 0,
                    down: 0,
                },
                groundTechCount: {
                    // tech away/in are in reference to the opponents position and not the stage
                    away: 0,
                    in: 0,
                    neutral: 0,
                    fail: 0,
                },
                wallTechCount: {
                    success: 0,
                    fail: 0,
                },
            };
            const playerState = {
                playerCounts: playerCounts,
                animations: [],
                actionFrameCounters: [],
                positionsY: [],
                lastLCancelStatus: 0,
                lastHandledAirDodgeEndIndex: -1,
            };
            this.state.set(indices, playerState);
        });
    }
    processFrame(frame) {
        this.playerPermutations.forEach((indices) => {
            const state = this.state.get(indices);
            if (state) {
                handleActionCompute(state, indices, frame);
            }
        });
    }
    fetch() {
        return Array.from(this.state.values()).map((val) => val.playerCounts);
    }
}
function isMissGroundTech(animation) {
    return animation === common.State.TECH_MISS_DOWN || animation === common.State.TECH_MISS_UP;
}
function isRolling(animation) {
    return animation === common.State.ROLL_BACKWARD || animation === common.State.ROLL_FORWARD;
}
function isGrabAction(animation) {
    // Includes Grab pull, wait, pummel, and throws
    return animation > common.State.GRAB && animation <= common.State.THROW_DOWN && animation !== common.State.DASH_GRAB;
}
function isGrabbing(animation) {
    return animation === common.State.GRAB || animation === common.State.DASH_GRAB;
}
function isAerialLanding(animation) {
    return animation >= common.State.AERIAL_LANDING_START && animation <= common.State.AERIAL_LANDING_END;
}
function isForwardTilt(animation) {
    return animation >= common.State.ATTACK_FTILT_START && animation <= common.State.ATTACK_FTILT_END;
}
function isForwardSmash(animation) {
    return animation >= common.State.ATTACK_FSMASH_START && animation <= common.State.ATTACK_FSMASH_END;
}
function isTaunting(animation) {
    return animation === common.State.TAUNT_LEFT || animation === common.State.TAUNT_RIGHT;
}
function getLandLagFromLandAnimation(animation, internalCharacterId) {
    let aerialName;
    if (animation === common.State.AERIAL_BAIR_LANDING) {
        aerialName = "bair";
    }
    else if (animation === common.State.AERIAL_FAIR_LANDING) {
        aerialName = "fair";
    }
    else if (animation === common.State.AERIAL_DAIR_LANDING) {
        aerialName = "dair";
    }
    else if (animation === common.State.AERIAL_NAIR_LANDING) {
        aerialName = "nair";
    }
    else if (animation === common.State.AERIAL_UAIR_LANDING) {
        aerialName = "upair";
    }
    else {
        return undefined;
    }
    const aerialFrameData = framedataUtils.getAerialFrameData(internalCharacterId, aerialName);
    if (aerialFrameData) {
        return [aerialFrameData.landingLag, aerialFrameData.lcancelledLandingLag];
    }
    return undefined;
}
//count the number of frames the previous animation took
function getPrevAnimationLength(state) {
    // last element of animations is the first frame of the current action, so
    // start with the element before that
    const startIndex = state.animations.length - 2;
    let i = startIndex;
    let frameCount = 0;
    // count frames backwards until we find a different animation
    while (state.animations[i] === state.animations[startIndex]) {
        frameCount += 1;
        i--;
    }
    return frameCount;
}
function handleActionCompute(state, indices, frame) {
    const playerFrame = frame.players[indices.playerIndex].post;
    const opponentFrame = frame.players[indices.opponentIndex].post;
    const incrementCount = (setter, condition) => {
        if (!condition) {
            return;
        }
        setter(state.playerCounts);
    };
    // Manage animation state
    const currentAnimation = playerFrame.actionStateId;
    state.animations.push(currentAnimation);
    const currentFrameCounter = playerFrame.actionStateCounter;
    state.actionFrameCounters.push(currentFrameCounter);
    state.positionsY.push(playerFrame.positionY ?? 0);
    // Grab last 3 frames
    const last3Frames = state.animations.slice(-3);
    const prevAnimation = last3Frames[last3Frames.length - 2];
    const prevFrameCounter = state.actionFrameCounters[state.actionFrameCounters.length - 2];
    // New action if new animation or frame counter goes back down (repeated action)
    const isNewAction = currentAnimation !== prevAnimation || prevFrameCounter > currentFrameCounter;
    if (!isNewAction) {
        return;
    }
    // Increment counts based on conditions
    const didDashDance = last3Frames.length === dashDanceAnimations.length &&
        last3Frames.every((frame, i) => frame === dashDanceAnimations[i]);
    incrementCount((c) => (c.dashDanceCount += 1), didDashDance);
    incrementCount((c) => (c.rollCount += 1), isRolling(currentAnimation));
    incrementCount((c) => (c.spotDodgeCount += 1), currentAnimation === common.State.SPOT_DODGE);
    incrementCount((c) => (c.airDodgeCount += 1), currentAnimation === common.State.AIR_DODGE);
    incrementCount((c) => (c.ledgegrabCount += 1), currentAnimation === common.State.CLIFF_CATCH);
    // Taunts
    incrementCount((c) => (c.tauntCount += 1), isTaunting(currentAnimation));
    // Grabs
    incrementCount((c) => (c.grabCount.success += 1), isGrabbing(prevAnimation) && isGrabAction(currentAnimation));
    incrementCount((c) => (c.grabCount.fail += 1), isGrabbing(prevAnimation) && !isGrabAction(currentAnimation));
    if (currentAnimation === common.State.DASH_GRAB && prevAnimation === common.State.ATTACK_DASH) {
        state.playerCounts.attackCount.dash -= 1; // subtract from dash attack if boost grab
    }
    // Basic attacks
    incrementCount((c) => (c.attackCount.jab1 += 1), currentAnimation === common.State.ATTACK_JAB1);
    incrementCount((c) => (c.attackCount.jab2 += 1), currentAnimation === common.State.ATTACK_JAB2);
    incrementCount((c) => (c.attackCount.jab3 += 1), currentAnimation === common.State.ATTACK_JAB3);
    incrementCount((c) => (c.attackCount.jabm += 1), currentAnimation === common.State.ATTACK_JABM);
    incrementCount((c) => (c.attackCount.dash += 1), currentAnimation === common.State.ATTACK_DASH);
    incrementCount((c) => (c.attackCount.ftilt += 1), isForwardTilt(currentAnimation));
    incrementCount((c) => (c.attackCount.utilt += 1), currentAnimation === common.State.ATTACK_UTILT);
    incrementCount((c) => (c.attackCount.dtilt += 1), currentAnimation === common.State.ATTACK_DTILT);
    incrementCount((c) => (c.attackCount.fsmash += 1), isForwardSmash(currentAnimation));
    incrementCount((c) => (c.attackCount.usmash += 1), currentAnimation === common.State.ATTACK_USMASH);
    incrementCount((c) => (c.attackCount.dsmash += 1), currentAnimation === common.State.ATTACK_DSMASH);
    incrementCount((c) => (c.attackCount.nair += 1), currentAnimation === common.State.AERIAL_NAIR);
    incrementCount((c) => (c.attackCount.fair += 1), currentAnimation === common.State.AERIAL_FAIR);
    incrementCount((c) => (c.attackCount.bair += 1), currentAnimation === common.State.AERIAL_BAIR);
    incrementCount((c) => (c.attackCount.uair += 1), currentAnimation === common.State.AERIAL_UAIR);
    incrementCount((c) => (c.attackCount.dair += 1), currentAnimation === common.State.AERIAL_DAIR);
    // GnW is weird and has unique IDs for some moves
    if (playerFrame.internalCharacterId === 0x18) {
        incrementCount((c) => (c.attackCount.jab1 += 1), currentAnimation === common.State.GNW_JAB1);
        incrementCount((c) => (c.attackCount.jabm += 1), currentAnimation === common.State.GNW_JABM);
        incrementCount((c) => (c.attackCount.dtilt += 1), currentAnimation === common.State.GNW_DTILT);
        incrementCount((c) => (c.attackCount.fsmash += 1), currentAnimation === common.State.GNW_FSMASH);
        incrementCount((c) => (c.attackCount.nair += 1), currentAnimation === common.State.GNW_NAIR);
        incrementCount((c) => (c.attackCount.bair += 1), currentAnimation === common.State.GNW_BAIR);
        incrementCount((c) => (c.attackCount.uair += 1), currentAnimation === common.State.GNW_UAIR);
    }
    // Peach is also weird and has a unique ID for her fsmash
    // FSMASH1 = Golf Club, FSMASH2 = Frying Pan, FSMASH3 = Tennis Racket
    if (playerFrame.internalCharacterId === 0x09) {
        incrementCount((c) => (c.attackCount.fsmash += 1), currentAnimation === common.State.PEACH_FSMASH1);
        incrementCount((c) => (c.attackCount.fsmash += 1), currentAnimation === common.State.PEACH_FSMASH2);
        incrementCount((c) => (c.attackCount.fsmash += 1), currentAnimation === common.State.PEACH_FSMASH3);
    }
    // Throws
    incrementCount((c) => (c.throwCount.up += 1), currentAnimation === common.State.THROW_UP);
    incrementCount((c) => (c.throwCount.forward += 1), currentAnimation === common.State.THROW_FORWARD);
    incrementCount((c) => (c.throwCount.down += 1), currentAnimation === common.State.THROW_DOWN);
    incrementCount((c) => (c.throwCount.back += 1), currentAnimation === common.State.THROW_BACK);
    // Techs
    const opponentDir = playerFrame.positionX > opponentFrame.positionX ? -1 : 1;
    const facingOpponent = playerFrame.facingDirection === opponentDir;
    incrementCount((c) => (c.groundTechCount.fail += 1), isMissGroundTech(currentAnimation));
    incrementCount((c) => (c.groundTechCount.in += 1), currentAnimation === common.State.FORWARD_TECH && facingOpponent);
    incrementCount((c) => (c.groundTechCount.in += 1), currentAnimation === common.State.BACKWARD_TECH && !facingOpponent);
    incrementCount((c) => (c.groundTechCount.neutral += 1), currentAnimation === common.State.NEUTRAL_TECH);
    incrementCount((c) => (c.groundTechCount.away += 1), currentAnimation === common.State.BACKWARD_TECH && facingOpponent);
    incrementCount((c) => (c.groundTechCount.away += 1), currentAnimation === common.State.FORWARD_TECH && !facingOpponent);
    incrementCount((c) => (c.wallTechCount.success += 1), currentAnimation === common.State.WALL_TECH);
    incrementCount((c) => (c.wallTechCount.fail += 1), currentAnimation === common.State.MISSED_WALL_TECH);
    if (isAerialLanding(currentAnimation)) {
        incrementCount((c) => (c.lCancelCount.success += 1), playerFrame.lCancelStatus === 1);
        incrementCount((c) => (c.lCancelCount.fail += 1), playerFrame.lCancelStatus === 2);
    }
    // check for edge canceled aerial
    if (isAerialLanding(prevAnimation) &&
        (currentAnimation === common.State.FALL || currentAnimation === common.State.TEETER) &&
        exists.exists(playerFrame.internalCharacterId)) {
        const landingFrames = getPrevAnimationLength(state);
        const [landingLag, lCanceledLag] = getLandLagFromLandAnimation(prevAnimation, playerFrame.internalCharacterId);
        // only counts as a successful edge cancel if an L cancel wouldn't have been faster
        incrementCount((c) => (c.edgeCancelCount.success += 1), landingFrames < lCanceledLag);
        incrementCount((c) => (c.edgeCancelCount.slow += 1), landingFrames >= lCanceledLag && landingFrames < landingLag);
        // make edge cancels not count as failed L cancels
        if (landingFrames <= lCanceledLag && state.lastLCancelStatus === 2) {
            state.playerCounts.lCancelCount.fail -= 1;
        }
    }
    // Handles wavedash detection (and waveland)
    handleActionWavedash(state.playerCounts, state.animations, state.positionsY, state);
    if (exists.exists(playerFrame.lCancelStatus) && playerFrame.lCancelStatus > 0) {
        state.lastLCancelStatus = playerFrame.lCancelStatus;
    }
}
function handleActionWavedash(counts, animations, positionsY, playerState) {
    const currentAnimation = animations[animations.length - 1];
    const prevAnimation = animations[animations.length - 2];
    const isSpecialLanding = currentAnimation === common.State.LANDING_FALL_SPECIAL;
    const isAcceptablePrevious = isWavedashInitiationAnimation(prevAnimation);
    const isPossibleWavedash = isSpecialLanding && isAcceptablePrevious;
    if (!isPossibleWavedash) {
        return;
    }
    // Here we special landed, it might be a wavedash, let's check
    // We grab the last 15 frames here because that should be enough time to execute a
    // wavedash. This number could be tweaked if we find false negatives.
    // Normally, wavedashes happen faster, but can be delayed.
    const lookbackFrames = 15;
    const recentFrames = animations.slice(-lookbackFrames);
    const recentAnimations = keyBy.keyBy(recentFrames, (animation) => animation);
    // Find the most recent air dodge within the lookback window. A single air dodge span
    // can only be consumed by one landing, so if it was already decremented by a previous
    // landing, don't count it again.
    const airDodgeEndIndex = findLastIndexWithinLookback(animations, lookbackFrames);
    if (Object.keys(recentAnimations).length === 2 && recentAnimations[common.State.AIR_DODGE]) {
        // If the only other animation is air dodge, this might be really late to the point
        // where it was actually an air dodge. Air dodge animation is really long
        if (airDodgeEndIndex !== undefined) {
            playerState.lastHandledAirDodgeEndIndex = airDodgeEndIndex;
        }
        return;
    }
    if (recentAnimations[common.State.AIR_DODGE]) {
        if (airDodgeEndIndex !== undefined && airDodgeEndIndex > playerState.lastHandledAirDodgeEndIndex) {
            // If one of the recent animations was an air dodge, let's remove that from the
            // air dodge counter, we don't want to count air dodges used to wavedash/land
            counts.airDodgeCount -= 1;
            playerState.lastHandledAirDodgeEndIndex = airDodgeEndIndex;
        }
    }
    if (recentAnimations[common.State.ACTION_KNEE_BEND]) {
        // If a jump was started recently, we will consider this a wavedash unless the player
        // spent too many frames in the air and their Y positions changed
        // (indicating they were traveling through the air, not wavedashing).
        // We use CONTROLLED_JUMP_START + 1 because CONTROLLED_JUMP_START equals ACTION_KNEE_BEND,
        // and we only want to count actual airborne jump frames, not the knee bend frames.
        const airborneJumpStart = common.State.CONTROLLED_JUMP_START + 1;
        const jumpFrames = recentFrames.filter((animation) => animation >= airborneJumpStart && animation <= common.State.CONTROLLED_JUMP_END).length;
        // Calculate Y position difference between knee bend start and landing
        const recentPositionsY = positionsY.slice(-lookbackFrames);
        const kneeBendIndex = recentFrames.findLastIndex((anim) => anim === common.State.ACTION_KNEE_BEND);
        const yDifference = recentPositionsY[recentPositionsY.length - 1] - recentPositionsY[kneeBendIndex];
        const epsilon = 0.1;
        const changedY = Math.abs(yDifference) > epsilon;
        // If the player was airborne for at least 5 frames and their Y positions changed,
        // they were traveling through the air (e.g. jumping to a platform) so they wavelanded, not wavedashed
        // 5 was chosen because it is the minimum number of jump frames it takes a character to get from ground to
        // a non-moving platform, Falco on the lowest FoD platform.
        // Edge cases:
        // - Any wavedash that is done with >15 frames from knee bend to landing
        // e.g. Fox/Falco JC shine where the first and second jump combine to 4+ frames in air.
        // - Any wavedash that has 5 or more frames in the air and changes Y position,
        // e.g. Late wavedash to/from Yoshi's center to slope, Late wavedash on FoD moving platforms (4+ frames in air).
        if (jumpFrames >= 5 && changedY) {
            counts.wavelandCount += 1;
        }
        else {
            counts.wavedashCount += 1;
        }
    }
    else {
        // If there was no jump recently, this is a waveland
        counts.wavelandCount += 1;
    }
}
function isWavedashInitiationAnimation(animation) {
    if (animation === common.State.AIR_DODGE) {
        return true;
    }
    const isAboveMin = animation >= common.State.CONTROLLED_JUMP_START;
    const isBelowMax = animation <= common.State.CONTROLLED_JUMP_END;
    return isAboveMin && isBelowMax;
}
/**
 * Find the index of the most recent AIR_DODGE frame within the last `lookbackFrames`
 * frames of `animations`. Each entry in `animations` corresponds to a frame, so the
 * returned number represents where that air dodge sits in the player's frame history.
 * Should be used to determine whether a landing's air dodge has already been consumed by a
 * previous landing (via `lastHandledAirDodgeEndIndex`), preventing an air dodge from
 * being decremented from the count more than once.
 * Returns undefined if there is no air dodge within the lookback window.
 */
function findLastIndexWithinLookback(animations, lookbackFrames) {
    for (let i = animations.length - 1; i >= Math.max(0, animations.length - lookbackFrames); i--) {
        if (animations[i] === common.State.AIR_DODGE) {
            return i;
        }
    }
    return undefined;
}

exports.ActionsComputer = ActionsComputer;
//# sourceMappingURL=actions.cjs.map
