import { byteLength, bufferCopy } from './bufferHelpers.esm.js';

class SlpBufferInputRef {
    buffer;
    constructor(buffer) {
        this.buffer = buffer;
    }
    open() {
        // Do nothing
    }
    size() {
        return byteLength(this.buffer);
    }
    close() {
        // Do nothing
    }
    read(targetBuffer, offset, length, position) {
        if (position >= this.size()) {
            return 0;
        }
        return bufferCopy(this.buffer, targetBuffer, offset, position, position + length);
    }
}

export { SlpBufferInputRef };
//# sourceMappingURL=slpInputRef.esm.js.map
