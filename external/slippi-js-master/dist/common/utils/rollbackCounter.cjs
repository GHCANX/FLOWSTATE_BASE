'use strict';

class RollbackCounter {
    rollbackFrames = {};
    rollbackFrameCount = 0;
    rollbackPlayerIdx; // for keeping track of rollbacks by following a single player
    lastFrameWasRollback = false;
    currentRollbackLength = 0;
    rollbackLengths = [];
    checkIfRollbackFrame(currentFrame, playerIdx) {
        if (this.rollbackPlayerIdx == null) {
            // we only want to follow a single player to avoid double counting. So we use whoever is on first.
            this.rollbackPlayerIdx = playerIdx;
        }
        else if (this.rollbackPlayerIdx !== playerIdx) {
            return;
        }
        if (currentFrame && currentFrame.players) {
            // frame already exists for currentFrameNumber so we must be rolling back
            // Note: We detect during PreFrameUpdate, but new versions have a
            // FrameStart command that has already initialized the frame, so we must
            // check for player data too.
            if (this.rollbackFrames[currentFrame.frame]) {
                this.rollbackFrames[currentFrame.frame].push(currentFrame);
            }
            else {
                this.rollbackFrames[currentFrame.frame] = [currentFrame];
            }
            this.rollbackFrameCount++;
            this.currentRollbackLength++;
            this.lastFrameWasRollback = true;
        }
        else if (this.lastFrameWasRollback) {
            this.rollbackLengths.push(this.currentRollbackLength);
            this.currentRollbackLength = 0;
            this.lastFrameWasRollback = false;
        }
        return this.lastFrameWasRollback;
    }
    getFrames() {
        return this.rollbackFrames;
    }
    getCount() {
        return this.rollbackFrameCount;
    }
    getLengths() {
        return this.rollbackLengths;
    }
}

exports.RollbackCounter = RollbackCounter;
//# sourceMappingURL=rollbackCounter.cjs.map
