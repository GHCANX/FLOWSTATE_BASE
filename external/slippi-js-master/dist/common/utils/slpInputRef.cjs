'use strict';

var bufferHelpers = require('./bufferHelpers.cjs');

class SlpBufferInputRef {
    buffer;
    constructor(buffer) {
        this.buffer = buffer;
    }
    open() {
        // Do nothing
    }
    size() {
        return bufferHelpers.byteLength(this.buffer);
    }
    close() {
        // Do nothing
    }
    read(targetBuffer, offset, length, position) {
        if (position >= this.size()) {
            return 0;
        }
        return bufferHelpers.bufferCopy(this.buffer, targetBuffer, offset, position, position + length);
    }
}

exports.SlpBufferInputRef = SlpBufferInputRef;
//# sourceMappingURL=slpInputRef.cjs.map
