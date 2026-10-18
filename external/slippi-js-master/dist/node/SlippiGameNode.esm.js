import { SlippiGameBase } from '../common/SlippiGameBase.esm.js';
import { isBufferLike } from '../common/utils/bufferHelpers.esm.js';
import { SlpBufferInputRef } from '../common/utils/slpInputRef.esm.js';
import { SlpFileInputRef } from './utils/slpFileInputRef.esm.js';

class SlippiGameNode extends SlippiGameBase {
    filePath;
    constructor(input, opts) {
        if (typeof input === "string") {
            super(new SlpFileInputRef(input), opts);
            this.filePath = input;
        }
        else if (isBufferLike(input)) {
            super(new SlpBufferInputRef(input), opts);
        }
        else {
            throw new Error("Cannot create SlippiGame with input of that type");
        }
    }
    getFilePath() {
        return this.filePath;
    }
}

export { SlippiGameNode };
//# sourceMappingURL=SlippiGameNode.esm.js.map
