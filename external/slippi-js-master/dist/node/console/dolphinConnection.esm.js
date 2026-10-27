import enet from 'enet';
import { TypedEventEmitter } from '../../common/utils/typedEventEmitter.esm.js';
import { ConnectionStatus, Ports, ConnectionEvent } from './types.esm.js';

const MAX_PEERS = 32;
const DolphinMessageType = {
    CONNECT_REPLY: "connect_reply",
    GAME_EVENT: "game_event",
    START_GAME: "start_game",
    END_GAME: "end_game",
};
class DolphinConnection extends TypedEventEmitter {
    ipAddress;
    port;
    connectionStatus = ConnectionStatus.DISCONNECTED;
    gameCursor = 0;
    nickname = "unknown";
    version = "";
    peer;
    client;
    constructor() {
        super();
        this.ipAddress = "0.0.0.0";
        this.port = Ports.DEFAULT;
    }
    /**
     * @returns The current connection status.
     */
    getStatus() {
        return this.connectionStatus;
    }
    /**
     * @returns The IP address and port of the current connection.
     */
    getSettings() {
        return {
            ipAddress: this.ipAddress,
            port: this.port,
        };
    }
    getDetails() {
        return {
            consoleNick: this.nickname,
            gameDataCursor: this.gameCursor,
            version: this.version,
        };
    }
    async connect(ip, port) {
        // console.log(`Connecting to: ${ip}:${port}`);
        this.ipAddress = ip;
        this.port = port;
        // Create the enet client
        let client = this.client;
        if (!client) {
            client = enet.createClient({ peers: MAX_PEERS, channels: 3, down: 0, up: 0 }, (err) => {
                if (err) {
                    console.error(err);
                    return;
                }
            });
            this.client = client;
        }
        const peer = client.connect({
            address: this.ipAddress,
            port: this.port,
        }, 3, 1337, // Data to send, not sure what this is or what this represents
        (err, newPeer) => {
            if (err) {
                console.error(err);
                return;
            }
            newPeer.ping();
            this.emit(ConnectionEvent.CONNECT, undefined);
            this._setStatus(ConnectionStatus.CONNECTED);
        });
        peer.on("connect", () => {
            // Reset the game cursor to the beginning of the game. Do we need to do this or
            // should it just continue from where it left off?
            this.gameCursor = 0;
            const request = {
                type: "connect_request",
                cursor: this.gameCursor,
            };
            const packet = new enet.Packet(JSON.stringify(request), enet.PACKET_FLAG.RELIABLE);
            peer.send(0, packet);
        });
        peer.on("message", (packet) => {
            const data = packet.data();
            if (data.length === 0) {
                return;
            }
            const dataString = data.toString("ascii");
            const message = JSON.parse(dataString);
            const { dolphin_closed } = message;
            if (dolphin_closed) {
                // We got a disconnection request
                this.disconnect();
                return;
            }
            this.emit(ConnectionEvent.MESSAGE, message);
            switch (message.type) {
                case DolphinMessageType.CONNECT_REPLY:
                    this.connectionStatus = ConnectionStatus.CONNECTED;
                    this.gameCursor = message.cursor;
                    this.nickname = message.nick;
                    this.version = message.version;
                    this.emit(ConnectionEvent.HANDSHAKE, this.getDetails());
                    break;
                case DolphinMessageType.GAME_EVENT: {
                    const { payload } = message;
                    this._updateCursor(message, dataString);
                    const gameData = Buffer.from(payload, "base64");
                    this._handleReplayData(gameData);
                    break;
                }
                case DolphinMessageType.START_GAME: {
                    this._updateCursor(message, dataString);
                    break;
                }
                case DolphinMessageType.END_GAME: {
                    this._updateCursor(message, dataString);
                    break;
                }
            }
        });
        peer.on("disconnect", () => {
            this.onPeerDisconnected();
        });
        this.peer = peer;
        this._setStatus(ConnectionStatus.CONNECTING);
    }
    destroyClient() {
        if (this.client) {
            this.client.destroy();
            this.client = undefined;
        }
    }
    onPeerDisconnected() {
        this._setStatus(ConnectionStatus.DISCONNECTED);
        if (this.peer) {
            this.peer = undefined;
        }
        this.destroyClient();
    }
    disconnect() {
        if (this.peer) {
            this.peer.disconnectLater();
        }
        else {
            this._setStatus(ConnectionStatus.DISCONNECTED);
            this.destroyClient();
        }
    }
    _handleReplayData(data) {
        this.emit(ConnectionEvent.DATA, data);
    }
    _setStatus(status) {
        // Don't fire the event if the status hasn't actually changed
        if (this.connectionStatus !== status) {
            this.connectionStatus = status;
            this.emit(ConnectionEvent.STATUS_CHANGE, this.connectionStatus);
        }
    }
    _updateCursor(message, dataString) {
        const { cursor, next_cursor } = message;
        if (this.gameCursor !== cursor) {
            const err = new Error(`Unexpected game data cursor. Expected: ${this.gameCursor} but got: ${cursor}. Payload: ${dataString}`);
            console.warn(err);
            this.emit(ConnectionEvent.ERROR, err);
        }
        this.gameCursor = next_cursor;
    }
}

export { DolphinConnection, DolphinMessageType };
//# sourceMappingURL=dolphinConnection.esm.js.map
