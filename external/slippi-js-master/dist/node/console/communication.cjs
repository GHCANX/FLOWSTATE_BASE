'use strict';

var ubjson = require('@shelacek/ubjson');

exports.CommunicationType = void 0;
(function (CommunicationType) {
    CommunicationType[CommunicationType["HANDSHAKE"] = 1] = "HANDSHAKE";
    CommunicationType[CommunicationType["REPLAY"] = 2] = "REPLAY";
    CommunicationType[CommunicationType["KEEP_ALIVE"] = 3] = "KEEP_ALIVE";
})(exports.CommunicationType || (exports.CommunicationType = {}));
// This class is responsible for handling the communication protocol between the Wii and the
// desktop app
class ConsoleCommunication {
    receiveBuf = Buffer.from([]);
    messages = [];
    receive(data) {
        this.receiveBuf = Buffer.concat([this.receiveBuf, data]);
        while (this.receiveBuf.length >= 4) {
            // First get the size of the message we are expecting
            const msgSize = this.receiveBuf.readUInt32BE(0);
            if (this.receiveBuf.length < msgSize + 4) {
                // If we haven't received all the data yet, let's wait for more
                return;
            }
            // Here we have received all the data, so let's decode it
            const ubjsonArrayBuffer = this.receiveBuf.buffer.slice(this.receiveBuf.byteOffset + 4, this.receiveBuf.byteOffset + msgSize + 4);
            this.messages.push(ubjson.decode(ubjsonArrayBuffer));
            // Remove the processed data from receiveBuf
            this.receiveBuf = this.receiveBuf.subarray(msgSize + 4);
        }
    }
    getReceiveBuffer() {
        return this.receiveBuf;
    }
    getMessages() {
        const toReturn = this.messages;
        this.messages = [];
        return toReturn;
    }
    genHandshakeOut(cursor, clientToken, isRealtime = false) {
        const clientTokenBuf = Buffer.from([0, 0, 0, 0]);
        clientTokenBuf.writeUInt32BE(clientToken, 0);
        const message = {
            type: exports.CommunicationType.HANDSHAKE,
            payload: {
                cursor: cursor,
                clientToken: Uint8Array.from(clientTokenBuf), // TODO: Use real instance token
                isRealtime: isRealtime,
            },
        };
        const buf = ubjson.encode(message, {
            optimizeArrays: true,
        });
        const msg = Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from(buf)]);
        msg.writeUInt32BE(buf.byteLength, 0);
        return msg;
    }
}

exports.ConsoleCommunication = ConsoleCommunication;
//# sourceMappingURL=communication.cjs.map
