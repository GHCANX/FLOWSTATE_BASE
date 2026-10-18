function keyBy(arr, fn) {
    const result = {};
    for (const item of arr) {
        result[String(fn(item))] = item;
    }
    return result;
}

export { keyBy };
//# sourceMappingURL=keyBy.esm.js.map
