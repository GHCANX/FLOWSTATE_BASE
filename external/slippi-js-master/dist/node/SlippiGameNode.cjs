'use strict';

var SlippiGameBase = require('../common/SlippiGameBase.cjs');
var bufferHelpers = require('../common/utils/bufferHelpers.cjs');
var slpInputRef = require('../common/utils/slpInputRef.cjs');
var slpFileInputRef = require('./utils/slpFileInputRef.cjs');

class SlippiGameNode extends SlippiGameBase.SlippiGameBase {
    filePath;
    constructor(input, opts) {
        if (typeof input === "string") {
            super(new slpFileInputRef.SlpFileInputRef(input), opts);
            this.filePath = input;
        }
        else if (bufferHelpers.isBufferLike(input)) {
            super(new slpInputRef.SlpBufferInputRef(input), opts);
        }
        else {
            throw new Error("Cannot create SlippiGame with input of that type");
        }
    }
    getFilePath() {
        return this.filePath;
    }
}

exports.SlippiGameNode = SlippiGameNode;
//# sourceMappingURL=SlippiGameNode.cjs.map
