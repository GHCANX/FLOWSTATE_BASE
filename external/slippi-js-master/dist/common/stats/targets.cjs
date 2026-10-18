'use strict';

var types = require('../types.cjs');
var exists = require('../utils/exists.cjs');

// The Target item's in-game ID
const TARGET_ITEM_TYPE_ID = 209;
class TargetBreakComputer {
    targetBreaks = [];
    isTargetTestGame = false;
    setup(settings) {
        // Reset the state
        this.targetBreaks = [];
        this.isTargetTestGame = settings.gameMode === types.GameMode.TARGET_TEST;
    }
    processFrame(frame, allFrames) {
        if (!this.isTargetTestGame) {
            return;
        }
        handleTargetBreak(allFrames, frame, this.targetBreaks);
    }
    fetch() {
        return this.targetBreaks;
    }
}
function handleTargetBreak(frames, frame, targetBreaks) {
    const currentFrameNumber = frame.frame;
    const prevFrameNumber = currentFrameNumber - 1;
    // Add all targets on the first frame
    if (currentFrameNumber === types.Frames.FIRST) {
        const targets = frames[types.Frames.FIRST]?.items?.filter((item) => item.typeId === TARGET_ITEM_TYPE_ID) ?? [];
        targets.forEach((target) => {
            targetBreaks.push({
                spawnId: target.spawnId,
                frameDestroyed: undefined,
                positionX: target.positionX,
                positionY: target.positionY,
            });
        });
    }
    const currentTargets = frames[currentFrameNumber]?.items?.filter((item) => item.typeId === TARGET_ITEM_TYPE_ID) ?? [];
    const previousTargets = frames[prevFrameNumber]?.items?.filter((item) => item.typeId === TARGET_ITEM_TYPE_ID) ?? [];
    const currentTargetIds = currentTargets.map((item) => item.spawnId).filter(exists.exists);
    const previousTargetIds = previousTargets.map((item) => item.spawnId).filter(exists.exists);
    // Check if any targets were destroyed
    const brokenTargetIds = previousTargetIds.filter((id) => !currentTargetIds.includes(id));
    brokenTargetIds.forEach((id) => {
        // Update the target break
        const targetBreak = targetBreaks.find((targetBreak) => targetBreak.spawnId === id);
        if (targetBreak) {
            targetBreak.frameDestroyed = currentFrameNumber;
        }
    });
}

exports.TargetBreakComputer = TargetBreakComputer;
//# sourceMappingURL=targets.cjs.map
