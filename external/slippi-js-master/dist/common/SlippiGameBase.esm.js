import { ActionsComputer } from './stats/actions.esm.js';
import { ComboComputer } from './stats/combos.esm.js';
import { ConversionComputer } from './stats/conversions.esm.js';
import { InputComputer } from './stats/inputs.esm.js';
import { generateOverallStats } from './stats/overall.esm.js';
import { Stats } from './stats/stats.esm.js';
import { StockComputer } from './stats/stocks.esm.js';
import { TargetBreakComputer } from './stats/targets.esm.js';
import { GameMode } from './types.esm.js';
import { getWinners } from './utils/getWinners.esm.js';
import { extractDistanceInfoFromFrame } from './utils/homeRunDistance.esm.js';
import { SlpParser, SlpParserEvent } from './utils/slpParser.esm.js';
import { openSlpFile, iterateEvents, getGameEnd, getMetadata, extractFinalPostFrameUpdates } from './utils/slpReader.esm.js';

/**
 * Slippi Game class that wraps a file
 */
class SlippiGameBase {
    input;
    metadata;
    finalStats;
    readPosition;
    parser;
    actionsComputer = new ActionsComputer();
    conversionComputer = new ConversionComputer();
    comboComputer = new ComboComputer();
    stockComputer = new StockComputer();
    inputComputer = new InputComputer();
    targetBreakComputer = new TargetBreakComputer();
    statsComputer;
    constructor(input, opts) {
        this.input = input;
        // Set up stats calculation
        this.statsComputer = new Stats(opts);
        this.statsComputer.register(this.actionsComputer, this.comboComputer, this.conversionComputer, this.inputComputer, this.stockComputer, this.targetBreakComputer);
        this.parser = new SlpParser();
        this.parser.on(SlpParserEvent.SETTINGS, (settings) => {
            this.statsComputer.setup(settings);
        });
        // Use finalized frames for stats computation
        this.parser.on(SlpParserEvent.FINALIZED_FRAME, (frame) => {
            this.statsComputer.addFrame(frame);
        });
    }
    _process(shouldStop = () => false, file) {
        if (this.parser.getGameEnd() != null) {
            return;
        }
        this.input.open();
        const slpfile = file ?? openSlpFile(this.input);
        // Generate settings from iterating through file
        this.readPosition = iterateEvents(slpfile, (command, payload) => {
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
            const slpfile = openSlpFile(this.input);
            const gameEnd = getGameEnd(slpfile);
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
        const overall = generateOverallStats({ settings, inputs, conversions, playableFrameCount });
        const gameEnd = this.parser.getGameEnd();
        const gameComplete = gameEnd != null;
        const stats = {
            lastFrame: this.parser.getLatestFrameNumber(),
            playableFrameCount,
            stocks: stocks,
            conversions: conversions,
            combos: this.comboComputer.fetch(),
            actionCounts: this.actionsComputer.fetch(),
            overall: overall,
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
            case GameMode.TARGET_TEST:
                return {
                    type: "target-test",
                    targetBreaks: this.targetBreakComputer.fetch(),
                };
            case GameMode.HOME_RUN_CONTEST:
                const distanceInfo = extractDistanceInfoFromFrame(settings, latestFrame);
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
        const slpfile = openSlpFile(this.input);
        this.metadata = getMetadata(slpfile);
        this.input.close();
        return this.metadata;
    }
    getWinners() {
        this.input.open();
        const slpfile = openSlpFile(this.input);
        this._process(() => this.parser.getSettings() != null, slpfile);
        const settings = this.parser.getSettings();
        if (!settings) {
            this.input.close();
            return [];
        }
        const finalPostFrameUpdates = extractFinalPostFrameUpdates(slpfile);
        const gameEnd = getGameEnd(slpfile) ?? {};
        this.input.close();
        return getWinners(gameEnd, settings, finalPostFrameUpdates);
    }
}

export { SlippiGameBase };
//# sourceMappingURL=SlippiGameBase.esm.js.map
