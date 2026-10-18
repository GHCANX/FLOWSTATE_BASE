import { aI as TypedEventEmitter, S as SlippiGameBase, B as BinaryLike, a as StatOptions, a4 as SlpStream, a7 as SlpStreamSettings } from './SlippiGameBase-DENGjRJa.js';
export { A as ActionCountsType, b as ActionsComputer, C as Character, c as ComboComputer, d as ComboType, e as Command, f as ControllerFixType, g as ConversionComputer, h as ConversionType, D as DamageType, i as DurationType, E as EnabledItemType, j as EventCallbackFunc, k as EventPayloadTypes, F as FodPlatformSide, l as FodPlatformType, m as FrameBookendType, n as FrameEntryType, o as FrameStartType, p as Frames, q as FramesType, G as GameEndMethod, r as GameEndType, s as GameInfoType, t as GameMode, u as GameStartType, v as GeckoCodeType, w as GeckoListType, H as HomeRunContestResultType, I as InputComputer, x as InputCountsType, y as ItemSpawnType, z as ItemUpdateType, L as Language, M as MAX_ROLLBACK_FRAMES, J as MessageSizes, K as MetadataType, N as MoveId, O as MoveLandedType, P as NETWORK_MESSAGE, Q as OverallType, R as PlacementType, T as PlayerIndexedType, U as PlayerType, V as PostFrameUpdateType, W as PreFrameUpdateType, X as RatioType, Y as RollbackFrames, Z as RollbackFramesType, _ as SelfInducedSpeedsType, $ as SlpCommandEventPayload, a0 as SlpParser, a1 as SlpParserEvent, a2 as SlpParserOptions, a3 as SlpRawEventPayload, a5 as SlpStreamEvent, a6 as SlpStreamMode, a8 as StadiumStatsType, a9 as StadiumTransformation, aa as StadiumTransformationEvent, ab as StadiumTransformationType, ac as Stage, ad as StageEventTypes, ae as StatComputer, af as State, ag as Stats, ah as StatsType, ai as StockComputer, aj as StockType, ak as TargetBreakComputer, al as TargetBreakType, am as TargetTestResultType, an as TimerType, ao as Timers, ap as WhispyBlowDirection, aq as WhispyType, ar as animations, as as calcDamageTaken, at as characters, au as didLoseStock, av as frameToGameTimer, aw as framedata, ax as generateOverallStats, ay as getSinglesPlayerPermutationsFromSettings, az as isCommandGrabbed, aA as isDamaged, aB as isDead, aC as isDown, aD as isGrabbed, aE as isInControl, aF as isTeching, aG as moves, aH as stages } from './SlippiGameBase-DENGjRJa.js';
import { Writable, WritableOptions } from 'stream';

declare enum CommunicationType {
    HANDSHAKE = 1,
    REPLAY = 2,
    KEEP_ALIVE = 3
}
type CommunicationMessage = {
    type: CommunicationType;
    payload: {
        cursor: Uint8Array;
        clientToken: Uint8Array;
        pos: Uint8Array;
        nextPos: Uint8Array;
        data: Uint8Array;
        nick: string | undefined;
        forcePos: boolean;
        nintendontVersion: string | undefined;
    };
};
declare class ConsoleCommunication {
    private receiveBuf;
    private messages;
    receive(data: Buffer): void;
    getReceiveBuffer(): Buffer;
    getMessages(): Array<CommunicationMessage>;
    genHandshakeOut(cursor: Uint8Array, clientToken: number, isRealtime?: boolean): Buffer;
}

declare const ConnectionEvent: {
    readonly CONNECT: "connect";
    readonly MESSAGE: "message";
    readonly HANDSHAKE: "handshake";
    readonly STATUS_CHANGE: "statusChange";
    readonly DATA: "data";
    readonly ERROR: "error";
};
type ConnectionEvent = (typeof ConnectionEvent)[keyof typeof ConnectionEvent];
type ConnectionEventMap = {
    [ConnectionEvent.CONNECT]: undefined;
    [ConnectionEvent.MESSAGE]: unknown;
    [ConnectionEvent.HANDSHAKE]: ConnectionDetails;
    [ConnectionEvent.STATUS_CHANGE]: ConnectionStatus;
    [ConnectionEvent.DATA]: Uint8Array;
    [ConnectionEvent.ERROR]: unknown;
};
declare enum ConnectionStatus {
    DISCONNECTED = 0,
    CONNECTING = 1,
    CONNECTED = 2,
    RECONNECT_WAIT = 3
}
declare enum Ports {
    DEFAULT = 51441,
    LEGACY = 666,
    RELAY_START = 53741
}
type ConnectionDetails = {
    consoleNick: string;
    gameDataCursor: number | Uint8Array;
    version: string;
    clientToken?: number;
};
type ConnectionSettings = {
    ipAddress: string;
    port: number;
};
interface Connection extends TypedEventEmitter<ConnectionEventMap> {
    getStatus(): ConnectionStatus;
    getSettings(): ConnectionSettings;
    getDetails(): ConnectionDetails;
    connect(ip: string, port: number): void;
    disconnect(): void;
}

declare const consoleConnectionOptions: {
    autoReconnect: boolean;
};
type ConsoleConnectionOptions = typeof consoleConnectionOptions;
/**
 * Responsible for maintaining connection to a Slippi relay connection or Wii connection.
 * Events are emitted whenever data is received.
 *
 * Basic usage example:
 *
 * ```javascript
 * const { ConsoleConnection } = require("@slippi/slippi-js");
 *
 * const connection = new ConsoleConnection();
 * connection.connect("localhost", 667); // You should set these values appropriately
 *
 * connection.on("data", (data) => {
 *   // Received data from console
 *   console.log(data);
 * });
 *
 * connection.on("statusChange", (status) => {
 *   console.log(`status changed: ${status}`);
 * });
 * ```
 */
declare class ConsoleConnection extends TypedEventEmitter<ConnectionEventMap> implements Connection {
    private ipAddress;
    private port;
    private isRealtime;
    private connectionStatus;
    private connDetails;
    private client?;
    private connection?;
    private options;
    private shouldReconnect;
    constructor(options?: Partial<ConsoleConnectionOptions>);
    /**
     * @returns The current connection status.
     */
    getStatus(): ConnectionStatus;
    /**
     * @returns The IP address and port of the current connection.
     */
    getSettings(): ConnectionSettings;
    /**
     * @returns The specific details about the connected console.
     */
    getDetails(): ConnectionDetails;
    /**
     * Initiate a connection to the Wii or Slippi relay.
     * @param ip   The IP address of the Wii or Slippi relay.
     * @param port The port to connect to.
     * @param isRealtime Optional. A flag to tell the Wii to send data as quickly as possible
     * @param timeout Optional. The timeout in milliseconds when attempting to connect
     *                to the Wii or relay.
     */
    connect(ip: string, port: number, isRealtime?: boolean, timeout?: number): Promise<void>;
    private _connectOnPort;
    /**
     * Terminate the current connection.
     */
    disconnect(): void;
    private _getInitialCommState;
    private _processMessage;
    private _handleReplayData;
    private _setStatus;
}

declare const DolphinMessageType: {
    readonly CONNECT_REPLY: "connect_reply";
    readonly GAME_EVENT: "game_event";
    readonly START_GAME: "start_game";
    readonly END_GAME: "end_game";
};
type DolphinMessageType = (typeof DolphinMessageType)[keyof typeof DolphinMessageType];
declare class DolphinConnection extends TypedEventEmitter<ConnectionEventMap> implements Connection {
    private ipAddress;
    private port;
    private connectionStatus;
    private gameCursor;
    private nickname;
    private version;
    private peer?;
    private client?;
    constructor();
    /**
     * @returns The current connection status.
     */
    getStatus(): ConnectionStatus;
    /**
     * @returns The IP address and port of the current connection.
     */
    getSettings(): ConnectionSettings;
    getDetails(): ConnectionDetails;
    connect(ip: string, port: number): Promise<void>;
    private destroyClient;
    private onPeerDisconnected;
    disconnect(): void;
    private _handleReplayData;
    private _setStatus;
    private _updateCursor;
}

declare class SlippiGameNode extends SlippiGameBase {
    private readonly filePath?;
    constructor(input: string | BinaryLike, opts?: StatOptions);
    getFilePath(): string | undefined;
}

type SlpFileMetadata = {
    startTime: Date;
    lastFrame: number;
    players: {
        [playerIndex: number]: {
            characterUsage: {
                [internalCharacterId: number]: number;
            };
            names: {
                netplay: string;
                code: string;
            };
        };
    };
    consoleNickname?: string;
};
/**
 * SlpFile is a class that wraps a Writable stream. It handles the writing of the binary
 * header and footer, and also handles the overwriting of the raw data length.
 *
 * @class SlpFile
 * @extends {Writable}
 */
declare class SlpFile extends Writable {
    private filePath;
    private metadata;
    private fileStream?;
    private rawDataLength;
    private slpStream;
    private usesExternalStream;
    /**
     * Creates an instance of SlpFile.
     * @param {string} filePath The file location to write to.
     * @param {WritableOptions} [opts] Options for writing.
     * @memberof SlpFile
     */
    constructor(filePath: string, slpStream?: SlpStream, opts?: WritableOptions);
    /**
     * Get the current file path being written to.
     *
     * @returns {string} The location of the current file path
     * @memberof SlpFile
     */
    path(): string;
    /**
     * Sets the metadata of the Slippi file, such as consoleNickname, lastFrame, and players.
     * @param metadata The metadata to be written
     */
    setMetadata(metadata: Partial<SlpFileMetadata>): void;
    _write(chunk: Uint8Array, encoding: string, callback: (error?: Error | null) => void): void;
    /**
     * Here we define what to do on each command. We need to populate the metadata field
     * so we keep track of the latest frame, as well as the number of frames each character has
     * been used.
     *
     * @param data The parsed data from a SlpStream
     */
    private _onCommand;
    private _setupListeners;
    private _initializeNewGame;
    _final(callback: (error?: Error | null) => void): void;
}

type SlpFileWriterOptions = Partial<SlpStreamSettings> & {
    outputFiles: boolean;
    folderPath: string;
    consoleNickname: string;
    newFilename: (folder: string, startTime: Date) => string;
};
declare enum SlpFileWriterEvent {
    NEW_FILE = "new-file",
    FILE_COMPLETE = "file-complete"
}
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
declare class SlpFileWriter extends Writable {
    private currentFile?;
    private options;
    private processor;
    /**
     * Creates an instance of SlpFileWriter.
     */
    constructor(options?: Partial<SlpFileWriterOptions>, opts?: WritableOptions);
    /**
     * Access the underlying SlpStream processor for event listening
     */
    getProcessor(): SlpStream;
    _write(chunk: Buffer, _encoding: string, callback: (error?: Error | null) => void): void;
    private _writePayload;
    private _setupListeners;
    /**
     * Return the name of the SLP file currently being written or undefined if
     * no file is being written to currently.
     *
     * @returns {(string | undefined)}
     * @memberof SlpFileWriter
     */
    getCurrentFilename(): string | undefined;
    /**
     * Ends the current file being written to.
     *
     * @returns {(string | undefined)}
     * @memberof SlpFileWriter
     */
    endCurrentFile(): void;
    /**
     * Updates the settings to be the desired ones passed in.
     *
     * @param {Partial<SlpFileWriterOptions>} settings
     * @memberof SlpFileWriter
     */
    updateSettings(settings: Partial<SlpFileWriterOptions>): void;
    private _handleNewGame;
    private _handleEndGame;
}

export { CommunicationType, ConnectionEvent, ConnectionStatus, ConsoleCommunication, ConsoleConnection, DolphinConnection, DolphinMessageType, Ports, SlippiGameNode as SlippiGame, SlpFile, SlpFileWriter, SlpFileWriterEvent, SlpStream, SlpStreamSettings, StatOptions };
export type { CommunicationMessage, Connection, ConnectionDetails, ConnectionEventMap, ConnectionSettings, ConsoleConnectionOptions, SlpFileMetadata, SlpFileWriterOptions };
//# sourceMappingURL=index.node.d.ts.map
