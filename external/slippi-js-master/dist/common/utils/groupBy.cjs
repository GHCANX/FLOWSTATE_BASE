'use strict';

function groupBy(arr, fn) {
    const result = {};
    for (const item of arr) {
        const key = String(fn(item));
        if (result[key]) {
            result[key].push(item);
        }
        else {
            result[key] = [item];
        }
    }
    return result;
}

exports.groupBy = groupBy;
//# sourceMappingURL=groupBy.cjs.map
