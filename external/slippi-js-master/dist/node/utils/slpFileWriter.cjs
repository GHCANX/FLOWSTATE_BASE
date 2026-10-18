'use strict';

var dateFns = require('date-fns');
var path = require('path');
var stream = require('stream');
var types = require('../../common/types.cjs');
var slpStream = require('../../common/utils/slpStream.cjs');
var slpFile = require('./slpFile.cjs');

/**
 * The default function to use for generating new SLP files.
 */
function getNewFilePath(folder, date) {
    return path.join(folder, `Game_${dateFns.format(date, "yyyyMMdd")}T${dateFns.format(date, "HHmmss")}.slp`);
}
const defaultSettings = {
    outputFiles: true,
    folderPath: ".",
    consoleNickname: "unknown",
    newFilename: getNewFilePath,
};
exports.SlpFileWriterEvent = void 0;
(function (SlpFileWriterEvent) {
    SlpFileWriterEvent["NEW_FILE"] = "new-file";
    SlpFileWriterEvent["FILE_COMPLETE"] = "file-complete";
})(exports.SlpFileWriterEvent || (exports.SlpFileWriterEvent = {}));
/**
 * SlpFileWriter lets us not only emit events as an SlpStream but also
 * writes the data that is being passed in to an SLP file. Use this if
 * you want to process Slippi data in real time but also want to be able
 * to write out the data to an SLP file.
 *
 * @export
 * @class SlpFileWriter
 * @extends {Writable}
 */
class SlpFileWriter extends stream.Writable {
    currentFile;
    options;
    processor;
    /**
     * Creates an instance of SlpFileWriter.
     */
    constructor(options, opts) {
        super(opts);
        this.options = Object.assign({}, defaultSettings, options);
        this.processor = new slpStream.SlpStream(options);
        this._setupListeners();
    }
    /**
     * Access the underlying SlpStream processor for event listening
     */
    getProcessor() {
        return this.processor;
    }
    // Implement _write to handle incoming data
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _write(chunk, _encoding, callback) {
        try {
            this.processor.process(new Uint8Array(chunk));
            callback();
        }
        catch (err) {
            callback(err instanceof Error ? err : new Error(String(err)));
        }
    }
    _writePayload(payload) {
        // Write data to the current file
        if (this.currentFile) {
            // Convert Uint8Array to Buffer for Node.js fs operations
            const buffer = Buffer.from(payload);
            this.currentFile.write(buffer);
        }
    }
    _setupListeners() {
        this.processor.on(slpStream.SlpStreamEvent.RAW, (data) => {
            const { command, payload } = data;
            switch (command) {
                case types.Command.MESSAGE_SIZES:
                    // Create the new game first before writing the payload
                    this._handleNewGame();
                    this._writePayload(payload);
                    break;
                case types.Command.GAME_END:
                    // Write payload first before ending the game
                    this._writePayload(payload);
                    this._handleEndGame();
                    break;
                default:
                    this._writePayload(payload);
                    break;
            }
        });
    }
    /**
     * Return the name of the SLP file currently being written or undefined if
     * no file is being written to currently.
     *
     * @returns {(string | undefined)}
     * @memberof SlpFileWriter
     */
    getCurrentFilename() {
        if (this.currentFile != null) {
            return path.resolve(this.currentFile.path());
        }
        return undefined;
    }
    /**
     * Ends the current file being written to.
     *
     * @returns {(string | undefined)}
     * @memberof SlpFileWriter
     */
    endCurrentFile() {
        this._handleEndGame();
    }
    /**
     * Updates the settings to be the desired ones passed in.
     *
     * @param {Partial<SlpFileWriterOptions>} settings
     * @memberof SlpFileWriter
     */
    updateSettings(settings) {
        this.options = Object.assign({}, this.options, settings);
    }
    _handleNewGame() {
        // Only create a new file if we're outputting files
        if (this.options.outputFiles) {
            const filePath = this.options.newFilename(this.options.folderPath, new Date());
            // Pass the processor to SlpFile so it can listen to events
            this.currentFile = new slpFile.SlpFile(filePath, this.processor);
            // console.log(`Creating new file at: ${filePath}`);
            this.emit(exports.SlpFileWriterEvent.NEW_FILE, filePath);
        }
    }
    _handleEndGame() {
        // End the stream
        if (this.currentFile) {
            const filePath = this.currentFile.path();
            // Set the console nickname
            this.currentFile.setMetadata({
                consoleNickname: this.options.consoleNickname,
            });
            // Wait for the file to actually finish writing before emitting FILE_COMPLETE
            this.currentFile.once("finish", () => {
                this.emit(exports.SlpFileWriterEvent.FILE_COMPLETE, filePath);
            });
            this.currentFile.end();
            // Clear current file
            this.currentFile = undefined;
        }
    }
}

exports.SlpFileWriter = SlpFileWriter;
//# sourceMappingURL=slpFileWriter.cjs.map
