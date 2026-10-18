import semver from 'semver';
import { Frames, Command, ItemSpawnType, GameMode } from '../types.esm.js';
import { exists } from './exists.esm.js';
import { keyBy } from './keyBy.esm.js';
import { RollbackCounter } from './rollbackCounter.esm.js';
import { TypedEventEmitter } from './typedEventEmitter.esm.js';

// There are 5 bytes of item bitfields that can be enabled
const ITEM_SETTINGS_BIT_COUNT = 40;
const MAX_ROLLBACK_FRAMES = 7;
const SlpParserEvent = {
    SETTINGS: "settings",
    END: "end",
    FRAME: "frame", // Emitted for every frame
    FINALIZED_FRAME: "finalized-frame", // Emitted for only finalized frames
    ROLLBACK_FRAME: "rollback-frame", // Emitted if a frame is being replaced
};
// If strict mode is on, we will do strict validation checking
// which could throw errors on invalid data.
// Default to false though since probably only real time applications
// would care about valid data.
const defaultSlpParserOptions = {
    strict: false,
};
class SlpParser extends TypedEventEmitter {
    frames = {};
    rollbackCounter = new RollbackCounter();
    settings;
    gameEnd;
    latestFrameIndex;
    settingsComplete = false;
    lastFinalizedFrame = Frames.FIRST - 1;
    options;
    geckoList;
    constructor(options) {
        super();
        this.options = Object.assign({}, defaultSlpParserOptions, options);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handleCommand(command, payload) {
        switch (command) {
            case Command.GAME_START:
                this._handleGameStart(payload);
                break;
            case Command.FRAME_START:
                this._handleFrameStart(payload);
                break;
            case Command.POST_FRAME_UPDATE:
                // We need to handle the post frame update first since that
                // will finalize the settings object, before we fire the frame update
                this._handlePostFrameUpdate(payload);
                this._handleFrameUpdate(command, payload);
                break;
            case Command.PRE_FRAME_UPDATE:
                this._handleFrameUpdate(command, payload);
                break;
            case Command.ITEM_UPDATE:
                this._handleItemUpdate(payload);
                break;
            case Command.FRAME_BOOKEND:
                this._handleFrameBookend(payload);
                break;
            case Command.GAME_END:
                this._handleGameEnd(payload);
                break;
            case Command.GECKO_LIST:
                this._handleGeckoList(payload);
                break;
            case Command.FOD_PLATFORM:
                this._handleStageEvent(payload);
                break;
            case Command.WHISPY:
                this._handleStageEvent(payload);
                break;
            case Command.STADIUM_TRANSFORMATION:
                this._handleStageEvent(payload);
                break;
        }
    }
    /**
     * Resets the parser state to their default values.
     */
    reset() {
        this.frames = {};
        this.settings = undefined;
        this.gameEnd = undefined;
        this.latestFrameIndex = undefined;
        this.settingsComplete = false;
        this.lastFinalizedFrame = Frames.FIRST - 1;
    }
    getLatestFrameNumber() {
        return this.latestFrameIndex ?? Frames.FIRST - 1;
    }
    getPlayableFrameCount() {
        if (this.latestFrameIndex == null) {
            return 0;
        }
        return this.latestFrameIndex < Frames.FIRST_PLAYABLE ? 0 : this.latestFrameIndex - Frames.FIRST_PLAYABLE;
    }
    getLatestFrame() {
        // return this.playerFrames[this.latestFrameIndex];
        // TODO: Modify this to check if we actually have all the latest frame data and return that
        // TODO: If we do. For now I'm just going to take a shortcut
        const allFrames = this.getFrames();
        const frameIndex = this.latestFrameIndex != null ? this.latestFrameIndex : Frames.FIRST;
        const indexToUse = this.gameEnd ? frameIndex : frameIndex - 1;
        return allFrames[indexToUse] || undefined;
    }
    getSettings() {
        return this.settingsComplete ? this.settings : undefined;
    }
    getItems() {
        if (this.settings?.itemSpawnBehavior === ItemSpawnType.OFF) {
            return undefined;
        }
        const itemBitfield = this.settings?.enabledItems;
        if (!exists(itemBitfield)) {
            return undefined;
        }
        const enabledItems = [];
        // Ideally we would be able to do this with bitshifting instead, but javascript
        // truncates numbers after 32 bits when doing bitwise operations
        for (let i = 0; i < ITEM_SETTINGS_BIT_COUNT; i++) {
            if (Math.floor(itemBitfield / 2 ** i) & 1) {
                enabledItems.push(2 ** i);
            }
        }
        return enabledItems;
    }
    getGameEnd() {
        return this.gameEnd;
    }
    getFrames() {
        return this.frames;
    }
    getRollbackFrames() {
        return {
            frames: this.rollbackCounter.getFrames(),
            count: this.rollbackCounter.getCount(),
            lengths: this.rollbackCounter.getLengths(),
        };
    }
    getFrame(num) {
        return this.frames[num] || undefined;
    }
    getGeckoList() {
        return this.geckoList;
    }
    _handleGeckoList(payload) {
        this.geckoList = payload;
    }
    _handleGameEnd(payload) {
        // Finalize remaining frames if necessary
        if (this.latestFrameIndex != null && this.latestFrameIndex !== this.lastFinalizedFrame) {
            this._finalizeFrames(this.latestFrameIndex);
        }
        this.gameEnd = payload;
        this.emit(SlpParserEvent.END, this.gameEnd);
    }
    _handleGameStart(payload) {
        this.settings = payload;
        const players = payload.players;
        this.settings.players = players.filter((player) => player.type !== 3);
        // Check to see if the file was created after the sheik fix so we know
        // we don't have to process the first frame of the game for the full settings
        if (payload.slpVersion && semver.gte(payload.slpVersion, "1.6.0")) {
            this._completeSettings();
        }
    }
    _handleFrameStart(payload) {
        const currentFrameNumber = payload.frame;
        set(this.frames, [currentFrameNumber, "start"], payload);
    }
    _handlePostFrameUpdate(payload) {
        if (this.settingsComplete) {
            return;
        }
        // Finish calculating settings
        if (payload.frame <= Frames.FIRST) {
            const playerIndex = payload.playerIndex;
            const playersByIndex = keyBy(this.settings.players, (p) => p.playerIndex);
            switch (payload.internalCharacterId) {
                case 0x7:
                    playersByIndex[playerIndex].characterId = 0x13; // Sheik
                    break;
                case 0x13:
                    playersByIndex[playerIndex].characterId = 0x12; // Zelda
                    break;
            }
        }
        if (payload.frame > Frames.FIRST) {
            this._completeSettings();
        }
    }
    _handleFrameUpdate(command, payload) {
        const location = command === Command.PRE_FRAME_UPDATE ? "pre" : "post";
        const field = payload.isFollower ? "followers" : "players";
        const currentFrameNumber = payload.frame;
        this.latestFrameIndex = currentFrameNumber;
        if (location === "pre" && !payload.isFollower) {
            const currentFrame = this.frames[currentFrameNumber];
            const wasRolledback = this.rollbackCounter.checkIfRollbackFrame(currentFrame, payload.playerIndex);
            if (wasRolledback && currentFrame) {
                // frame is about to be overwritten
                this.emit(SlpParserEvent.ROLLBACK_FRAME, currentFrame);
            }
        }
        set(this.frames, [currentFrameNumber, field, payload.playerIndex, location], payload);
        set(this.frames, [currentFrameNumber, "frame"], currentFrameNumber);
        // If file is from before frame bookending, add frame to stats computer here. Does a little
        // more processing than necessary, but it works
        const settings = this.getSettings();
        if (settings && (!settings.slpVersion || semver.lte(settings.slpVersion, "2.2.0"))) {
            const frame = this.frames[currentFrameNumber];
            if (frame) {
                this.emit(SlpParserEvent.FRAME, frame);
            }
            // Finalize the previous frame since no bookending exists
            this._finalizeFrames(currentFrameNumber - 1);
        }
        else {
            set(this.frames, [currentFrameNumber, "isTransferComplete"], false);
        }
    }
    _handleItemUpdate(payload) {
        const currentFrameNumber = payload.frame;
        const items = this.frames[currentFrameNumber]?.items ?? [];
        items.push(payload);
        // Set items with newest
        set(this.frames, [currentFrameNumber, "items"], items);
    }
    _handleFrameBookend(payload) {
        const latestFinalizedFrame = payload.latestFinalizedFrame;
        const currentFrameNumber = payload.frame;
        set(this.frames, [currentFrameNumber, "isTransferComplete"], true);
        // Fire off a normal frame event
        const frame = this.frames[currentFrameNumber];
        if (frame) {
            this.emit(SlpParserEvent.FRAME, frame);
        }
        // Finalize frames if necessary
        const validLatestFrame = this.settings.gameMode === GameMode.ONLINE;
        if (validLatestFrame && latestFinalizedFrame >= Frames.FIRST) {
            // Ensure valid latestFinalizedFrame
            if (this.options.strict && latestFinalizedFrame < currentFrameNumber - MAX_ROLLBACK_FRAMES) {
                throw new Error(`latestFinalizedFrame should be within ${MAX_ROLLBACK_FRAMES} frames of ${currentFrameNumber}`);
            }
            this._finalizeFrames(latestFinalizedFrame);
        }
        else {
            // Since we don't have a valid finalized frame, just finalize the frame based on MAX_ROLLBACK_FRAMES
            this._finalizeFrames(currentFrameNumber - MAX_ROLLBACK_FRAMES);
        }
    }
    _handleStageEvent(payload) {
        const currentFrameNumber = payload.frame;
        const stageEvents = this.frames[currentFrameNumber]?.stageEvents ?? [];
        stageEvents.push(payload);
        // Set stageEvents with newest
        set(this.frames, [currentFrameNumber, "stageEvents"], stageEvents);
    }
    /**
     * Fires off the FINALIZED_FRAME event for frames up until a certain number
     * @param num The frame to finalize until
     */
    _finalizeFrames(num) {
        while (this.lastFinalizedFrame < num) {
            const frameToFinalize = this.lastFinalizedFrame + 1;
            const frame = this.getFrame(frameToFinalize);
            // If the frame doesn't exist, we can't finalize it yet
            // This can happen when trying to finalize frames that haven't been received
            if (!frame) {
                break;
            }
            // Check that we have all the pre and post frame data for all players if we're in strict mode
            if (this.options.strict) {
                for (const player of this.settings.players) {
                    const playerFrameInfo = frame.players[player.playerIndex];
                    // Allow player frame info to be empty in non 1v1 games since
                    // players which have been defeated will have no frame info.
                    if (this.settings.players.length > 2 && !playerFrameInfo) {
                        continue;
                    }
                    const { pre, post } = playerFrameInfo;
                    if (!pre || !post) {
                        const preOrPost = pre ? "pre" : "post";
                        throw new Error(`Could not finalize frame ${frameToFinalize} of ${num}: missing ${preOrPost}-frame update for player ${player.playerIndex}`);
                    }
                }
            }
            // Our frame is complete so finalize the frame
            this.emit(SlpParserEvent.FINALIZED_FRAME, frame);
            this.lastFinalizedFrame = frameToFinalize;
        }
    }
    _completeSettings() {
        if (!this.settingsComplete) {
            this.settingsComplete = true;
            if (this.settings) {
                this.emit(SlpParserEvent.SETTINGS, this.settings);
            }
        }
    }
}
function set(obj, path, value) {
    let current = obj;
    for (let i = 0; i < path.length - 1; i++) {
        const key = path[i];
        if (!(key in current)) {
            current[key] = {};
        }
        current = current[key];
    }
    current[path[path.length - 1]] = value;
}

export { MAX_ROLLBACK_FRAMES, SlpParser, SlpParserEvent };
//# sourceMappingURL=slpParser.esm.js.map
