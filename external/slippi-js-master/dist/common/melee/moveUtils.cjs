'use strict';

var moves = require('./moves.json.cjs');

const UnknownMove = {
    id: -1,
    name: "Unknown Move",
    shortName: "unknown",
};
function getMoveInfo(moveId) {
    const moveName = moves.default[moveId.toString()];
    if (!moveName) {
        return UnknownMove;
    }
    return {
        id: moveId,
        name: moveName.name,
        shortName: moveName.shortName,
    };
}
function getMoveShortName(moveId) {
    const move = getMoveInfo(moveId);
    return move.shortName;
}
function getMoveName(moveId) {
    const move = getMoveInfo(moveId);
    return move.name;
}

exports.UnknownMove = UnknownMove;
exports.getMoveInfo = getMoveInfo;
exports.getMoveName = getMoveName;
exports.getMoveShortName = getMoveShortName;
//# sourceMappingURL=moveUtils.cjs.map
