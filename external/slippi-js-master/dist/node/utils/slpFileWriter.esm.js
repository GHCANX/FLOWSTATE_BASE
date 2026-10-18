import { format } from 'date-fns';
import path from 'path';
import { Writable } from 'stream';
import { Command } from '../../common/types.esm.js';
import { SlpStream, SlpStreamEvent } from '../../common/utils/slpStream.esm.js';
import { SlpFile } from './slpFile.esm.js';

/**
 * The default function to use for generating new SLP files.
 */
function getNewFilePath(folder, date) {
    return path.join(folder, `Game_${format(date, "yyyyMMdd")}T${format(date, "HHmmss")}.slp`);
}
const defaultSettings = {
    outputFiles: true,
    folderPath: ".",
    consoleNickname: "unknown",
    newFilename: getNewFilePath,
};
var SlpFileWriterEvent;
(function (SlpFileWriterEvent) {
    SlpFileWriterEvent["NEW_FILE"] = "new-file";
    SlpFileWriterEvent["FILE_COMPLETE"] = "file-complete";
})(SlpFileWriterEvent || (SlpFileWriterEvent = {}));
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
class SlpFileWriter extends Writable {
    currentFile;
    options;
    processor;
    /**
     * Creates an instance of SlpFileWriter.
     */
    constructor(options, opts) {
        super(opts);
        this.options = Object.assign({}, defaultSettings, options);
        this.processor = new SlpStream(options);
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
        this.processor.on(SlpStreamEvent.RAW, (data) => {
            const { command, payload } = data;
            switch (command) {
                case Command.MESSAGE_SIZES:
                    // Create the new game first before writing the payload
                    this._handleNewGame();
                    this._writePayload(payload);
                    break;
                case Command.GAME_END:
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
            this.currentFile = new SlpFile(filePath, this.processor);
            // console.log(`Creating new file at: ${filePath}`);
            this.emit(SlpFileWriterEvent.NEW_FILE, filePath);
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
                this.emit(SlpFileWriterEvent.FILE_COMPLETE, filePath);
            });
            this.currentFile.end();
            // Clear current file
            this.currentFile = undefined;
        }
    }
}

export { SlpFileWriter, SlpFileWriterEvent };
//# sourceMappingURL=slpFileWriter.esm.js.map
