'use strict';

var actions = require('./stats/actions.cjs');
var combos = require('./stats/combos.cjs');
var conversions = require('./stats/conversions.cjs');
var inputs = require('./stats/inputs.cjs');
var overall = require('./stats/overall.cjs');
var stats = require('./stats/stats.cjs');
var stocks = require('./stats/stocks.cjs');
var targets = require('./stats/targets.cjs');
var types = require('./types.cjs');
var getWinners = require('./utils/getWinners.cjs');
var homeRunDistance = require('./utils/homeRunDistance.cjs');
var slpParser = require('./utils/slpParser.cjs');
var slpReader = require('./utils/slpReader.cjs');

/**
 * Slippi Game class that wraps a file
 */
class SlippiGameBase {
    input;
    metadata;
    finalStats;
    readPosition;
    parser;
    actionsComputer = new actions.ActionsComputer();
    conversionComputer = new conversions.ConversionComputer();
    comboComputer = new combos.ComboComputer();
    stockComputer = new stocks.StockComputer();
    inputComputer = new inputs.InputComputer();
    targetBreakComputer = new targets.TargetBreakComputer();
    statsComputer;
    constructor(input, opts) {
        this.input = input;
        // Set up stats calculation
        this.statsComputer = new stats.Stats(opts);
        this.statsComputer.register(this.actionsComputer, this.comboComputer, this.conversionComputer, this.inputComputer, this.stockComputer, this.targetBreakComputer);
        this.parser = new slpParser.SlpParser();
        this.parser.on(slpParser.SlpParserEvent.SETTINGS, (settings) => {
            this.statsComputer.setup(settings);
        });
        // Use finalized frames for stats computation
        this.parser.on(slpParser.SlpParserEvent.FINALIZED_FRAME, (frame) => {
            this.statsComputer.addFrame(frame);
        });
    }
    _process(shouldStop = () => false, file) {
        if (this.parser.getGameEnd() != null) {
            return;
        }
        this.input.open();
        const slpfile = file ?? slpReader.openSlpFile(this.input);
        // Generate settings from iterating through file
        this.readPosition = slpReader.iterateEvents(slpfile, (command, payload) => {
            if (!payload) {
                // If payload is falsy, keep iterating. The parser probably just doesn't know
                // about this command yet
                return false;
            }
            this.parser.handleCommand(command, payload);
            return shouldStop(command, payload);
        }, this.readPosition);
        if (!file) {
            this.input.close();
        }
    }
    /**
     * Gets the game settings, these are the settings that describe the starting state of
     * the game such as characters, stage, etc.
     */
    getSettings() {
        // Settings is only complete after post-frame update
        this._process(() => this.parser.getSettings() != null);
        return this.parser.getSettings();
    }
    getItems() {
        this._process();
        return this.parser.getItems();
    }
    getLatestFrame() {
        this._process();
        return this.parser.getLatestFrame();
    }
    getGameEnd(options = {}) {
        if (options?.skipProcessing) {
            // Read game end block directly
            this.input.open();
            const slpfile = slpReader.openSlpFile(this.input);
            const gameEnd = slpReader.getGameEnd(slpfile);
            this.input.close();
            return gameEnd;
        }
        this._process();
        return this.parser.getGameEnd();
    }
    getFrames() {
        this._process();
        return this.parser.getFrames();
    }
    getRollbackFrames() {
        this._process();
        return this.parser.getRollbackFrames();
    }
    getGeckoList() {
        this._process(() => this.parser.getGeckoList() != null);
        return this.parser.getGeckoList();
    }
    getStats() {
        if (this.finalStats) {
            return this.finalStats;
        }
        this._process();
        const settings = this.parser.getSettings();
        if (!settings) {
            return undefined;
        }
        // Finish processing if we're not up to date
        this.statsComputer.process();
        const inputs = this.inputComputer.fetch();
        const stocks = this.stockComputer.fetch();
        const conversions = this.conversionComputer.fetch();
        const playableFrameCount = this.parser.getPlayableFrameCount();
        const overall$1 = overall.generateOverallStats({ settings, inputs, conversions, playableFrameCount });
        const gameEnd = this.parser.getGameEnd();
        const gameComplete = gameEnd != null;
        const stats = {
            lastFrame: this.parser.getLatestFrameNumber(),
            playableFrameCount,
            stocks: stocks,
            conversions: conversions,
            combos: this.comboComputer.fetch(),
            actionCounts: this.actionsComputer.fetch(),
            overall: overall$1,
            gameComplete,
        };
        if (gameComplete) {
            // If the game is complete, store a cached version of stats because it should not
            // change anymore. Ideally the statsCompuer.process and fetch functions would simply do no
            // work in this case instead but currently the conversions fetch function,
            // generateOverallStats, and maybe more are doing work on every call.
            this.finalStats = stats;
        }
        return stats;
    }
    getStadiumStats() {
        this._process();
        const settings = this.parser.getSettings();
        if (!settings) {
            return undefined;
        }
        const latestFrame = this.parser.getLatestFrame();
        const players = latestFrame?.players;
        if (!players) {
            return undefined;
        }
        this.statsComputer.process();
        switch (settings.gameMode) {
            case types.GameMode.TARGET_TEST:
                return {
                    type: "target-test",
                    targetBreaks: this.targetBreakComputer.fetch(),
                };
            case types.GameMode.HOME_RUN_CONTEST:
                const distanceInfo = homeRunDistance.extractDistanceInfoFromFrame(settings, latestFrame);
                if (!distanceInfo) {
                    return undefined;
                }
                return {
                    type: "home-run-contest",
                    distance: distanceInfo.distance,
                    units: distanceInfo.units,
                };
            default:
                return undefined;
        }
    }
    getMetadata() {
        if (this.metadata) {
            return this.metadata;
        }
        this.input.open();
        const slpfile = slpReader.openSlpFile(this.input);
        this.metadata = slpReader.getMetadata(slpfile);
        this.input.close();
        return this.metadata;
    }
    getWinners() {
        this.input.open();
        const slpfile = slpReader.openSlpFile(this.input);
        this._process(() => this.parser.getSettings() != null, slpfile);
        const settings = this.parser.getSettings();
        if (!settings) {
            this.input.close();
            return [];
        }
        const finalPostFrameUpdates = slpReader.extractFinalPostFrameUpdates(slpfile);
        const gameEnd = slpReader.getGameEnd(slpfile) ?? {};
        this.input.close();
        return getWinners.getWinners(gameEnd, settings, finalPostFrameUpdates);
    }
}

exports.SlippiGameBase = SlippiGameBase;
//# sourceMappingURL=SlippiGameBase.cjs.map
