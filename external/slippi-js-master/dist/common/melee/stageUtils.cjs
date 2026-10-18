'use strict';

var stages = require('./stages.json.cjs');

const ALL_STAGES = new Map(Object.entries(stages.default).map(([key, value]) => {
    const stageId = parseInt(key);
    const info = {
        id: stageId,
        name: value.name,
        mode: value.mode,
    };
    return [stageId, info];
}));
const UnknownStage = {
    id: -1,
    name: "Unknown Stage",
};
function getStageInfo(stageId) {
    const stageInfo = ALL_STAGES.get(stageId);
    if (!stageInfo) {
        return UnknownStage;
    }
    return {
        id: stageId,
        name: stageInfo.name,
    };
}
function getStageName(stageId) {
    const stage = getStageInfo(stageId);
    return stage.name;
}
function getStages(mode = "vs") {
    return Array.from(ALL_STAGES.values()).filter((stage) => {
        return mode === "all" || stage.mode === mode;
    });
}

exports.UnknownStage = UnknownStage;
exports.getStageInfo = getStageInfo;
exports.getStageName = getStageName;
exports.getStages = getStages;
//# sourceMappingURL=stageUtils.cjs.map
