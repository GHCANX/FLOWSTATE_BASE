'use strict';

function keyBy(arr, fn) {
    const result = {};
    for (const item of arr) {
        result[String(fn(item))] = item;
    }
    return result;
}

exports.keyBy = keyBy;
//# sourceMappingURL=keyBy.cjs.map
