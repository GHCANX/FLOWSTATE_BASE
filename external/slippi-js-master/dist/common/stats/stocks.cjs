'use strict';

var common = require('./common.cjs');

class StockComputer {
    state = new Map();
    playerPermutations = [];
    stocks = [];
    setup(settings) {
        // Reset state
        this.state = new Map();
        this.playerPermutations = common.getSinglesPlayerPermutationsFromSettings(settings);
        this.stocks = [];
        this.playerPermutations.forEach((indices) => {
            const playerState = {
                stock: undefined,
            };
            this.state.set(indices, playerState);
        });
    }
    processFrame(frame, allFrames) {
        this.playerPermutations.forEach((indices) => {
            const state = this.state.get(indices);
            if (state) {
                handleStockCompute(allFrames, state, indices, frame, this.stocks);
            }
        });
    }
    fetch() {
        return this.stocks;
    }
}
function handleStockCompute(frames, state, indices, frame, stocks) {
    const playerFrame = frame.players[indices.playerIndex].post;
    const currentFrameNumber = playerFrame.frame;
    const prevFrameNumber = currentFrameNumber - 1;
    const prevPlayerFrame = frames[prevFrameNumber]
        ? frames[prevFrameNumber].players[indices.playerIndex].post
        : undefined;
    // If there is currently no active stock, wait until the player is no longer spawning.
    // Once the player is no longer spawning, start the stock
    if (!state.stock) {
        const isPlayerDead = common.isDead(playerFrame.actionStateId);
        if (isPlayerDead) {
            return;
        }
        state.stock = {
            playerIndex: indices.playerIndex,
            startFrame: currentFrameNumber,
            endFrame: undefined,
            startPercent: 0,
            endPercent: undefined,
            currentPercent: 0,
            count: playerFrame.stocksRemaining,
            deathAnimation: undefined,
        };
        stocks.push(state.stock);
    }
    else if (prevPlayerFrame && common.didLoseStock(playerFrame, prevPlayerFrame)) {
        state.stock.endFrame = playerFrame.frame;
        state.stock.endPercent = prevPlayerFrame.percent ?? 0;
        state.stock.deathAnimation = playerFrame.actionStateId;
        state.stock = undefined;
    }
    else {
        state.stock.currentPercent = playerFrame.percent ?? 0;
    }
}

exports.StockComputer = StockComputer;
//# sourceMappingURL=stocks.cjs.map
