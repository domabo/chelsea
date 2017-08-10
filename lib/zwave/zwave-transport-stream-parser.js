'use strict';
/*
 * Copyright (c) 2017 Internet of Protocols Alliance (IOPA)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const util = require('util'),
    Buffer = require('safe-buffer').Buffer,
    Transform = require('stream').Transform,
    PROTOCOL = require('./protocol-constants');

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

/*
 * Zwave Transport Stream Parser
 * 
 * Node Stream Transform Function that is used as a parser for Zwave Serial or Network Streams
 * 
 * It reads the underlying stream event chunks, inspect for frame boundaries,
 * and passes on complete Zwave frames as each frame boundary is reached
 * 
 * @class ZwaveTransportStreamParser
 * @constructor
 * @implements Node.js Stream Transform Interface
 * @public 
 */
function ZwaveTransportStreamParser() {
    _classCallCheck(this, ZwaveTransportStreamParser);
    Transform.call(this);
    this.buffer = Buffer.alloc(0);
}

util.inherits(ZwaveTransportStreamParser, Transform);

ZwaveTransportStreamParser.prototype._transform = function (chunk, encoding, cb) {
   // console.log("T: " + util.inspect(chunk));

    var data = Buffer.concat([this.buffer, chunk]);

    var nextByte;
    var loop = true;

    while (loop) {
        nextByte = data[0];
        loop = false;
        switch (nextByte) {
            case PROTOCOL.SerialFrameType.ACK:
            case PROTOCOL.SerialFrameType.CAN:
            case PROTOCOL.SerialFrameType.NAK:
                this.push(data.slice(0, 1));
                data = data.slice(1);
                loop = (data.length > 0);
                break;
            case PROTOCOL.SerialFrameType.SOF:
                if (data.length >= 5) {
                    nextByte = data[1];
                    if (nextByte < 4 || nextByte > 64) {
                        console.error("Frame length is out of limits (%d)", nextByte);
                        break;
                    }
                    var messageLength = (nextByte & 0xff) + 2;

                    if (data.length >= messageLength) {
                        this.push(data.slice(0, messageLength));
                        data = data.slice(messageLength);
                    }
                }
                break;
            default:
                console.error("Invalid start of frame (%d)", nextByte);
                data = Buffer.alloc(0);
        }
        this.buffer = data;
    }
    cb();
}

ZwaveTransportStreamParser.prototype._flush = function (cb) {
    this.push(this.buffer);
    this.buffer = Buffer.alloc(0);
    cb();
}

module.exports = ZwaveTransportStreamParser;