'use strict';

var dateFns = require('date-fns');
var types = require('../types.cjs');
var exists = require('./exists.cjs');

function frameToGameTimer(frame, options) {
    const { timerType, startingTimerSeconds } = options;
    if (timerType === types.TimerType.DECREASING) {
        if (!exists.exists(startingTimerSeconds)) {
            return "Unknown";
        }
        const centiseconds = Math.ceil((((60 - (frame % 60)) % 60) * 99) / 59);
        const date = new Date(0, 0, 0, 0, 0, startingTimerSeconds - frame / 60, centiseconds * 10);
        return dateFns.format(date, "mm:ss.SS");
    }
    if (timerType === types.TimerType.INCREASING) {
        const centiseconds = Math.floor(((frame % 60) * 99) / 59);
        const date = new Date(0, 0, 0, 0, 0, frame / 60, centiseconds * 10);
        return dateFns.format(date, "mm:ss.SS");
    }
    return "Infinite";
}

exports.frameToGameTimer = frameToGameTimer;
//# sourceMappingURL=gameTimer.cjs.map
