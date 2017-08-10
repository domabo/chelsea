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
    EventEmitter = require('events').EventEmitter,
    PROTOCOL = require('./protocol-constants'),
    ZWAVE = PROTOCOL.ZWAVE,
    SERVER = { Capabilities: "server.Capabilities" };

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

/*
 * Zwave Transport Middleware
 * 
 * This middleware is composed of the following functions:
 * 
 * 1. ZwaveMessageSerialFramer
 *  - converts raw zwave payload into frame
 * 
 * 2. ZwaveTransportThrottler
 *  - hooks into write to block further writes until ACK is received from zwave controller
 *  - hooks into invoke to autorespond with ACKs to SOF messages
 *  - hooks into invoke to ignore duplicate messages received
 *  
 * Usage: app.use(ZwaveTransportMiddleware)
 * 
 * @class ZwaveTransportMiddleware
 * @param app  IOPA AppBuilder App
 * @constructor
 * @public
 */
function ZwaveTransportMiddleware(app) {
    _classCallCheck(this, ZwaveTransportMiddleware);

    if (!app.properties[SERVER.Capabilities][ZWAVE.Capabilities][ZWAVE.Version])
        throw new Error("ZwaveTransportMiddleware requires embedded ZwaveServer");

    app.use(ZwaveTransportThrottler);
    app.use(ZwaveMessageSerialFramer);
}

module.exports = ZwaveTransportMiddleware;

/*
 * Zwave Transport Serial Framer Middleware 
 * 
 * This middleware 
 *  - converts raw zwave payload into frame
 * 
 * @class ZwaveMessageSerialFramer
 * @param app  IOPA AppBuilder App
 * @constructor
 * @private
 */
function ZwaveMessageSerialFramer(app) {
    _classCallCheck(this, ZwaveMessageSerialFramer);

}

ZwaveMessageSerialFramer.prototype.invoke = function (context, next) {
    var response = context[ZWAVE.RawPayload];
    context[ZWAVE.FrameType] = response[0];
    context[ZWAVE.Length] = response[1];
    context[ZWAVE.MessageType] = response[2];
    context[ZWAVE.SerialFunctionClass] = PROTOCOL.SerialFunctionClass.properties[response[3]] || {};
    context[ZWAVE.SerialFunctionClass].value = response[3];
    context[ZWAVE.Payload] = response.slice(4, response[1] + 1);
    return next();
}

/*
 * Zwave Transport Throttler Middleware
 * 
 * This middleware 
 *  - hooks into server write to block further writes until ACK is received from zwave controller
 *  - hooks into invoke to autorespond with ACKs to SOF messages
 *  - hooks into invoke to ignore duplicate messages received
 * 
 * @class ZwaveTransportThrottler
 * @param app  IOPA AppBuilder App
 * @constructor
 * @private
 */
function ZwaveTransportThrottler(app) {

    _classCallCheck(this, ZwaveTransportThrottler);

    this.messageQueue = new Array();
    this.messageQueueEvents = new EventEmitter();
    this._blockWriting(false);
    this.lastMessage = null;

    var self = this;

    this.messageQueueEvents.on("queue_modified", function () {
        if (self.messageQueue.length > 0) {
            if (!self.block) {
                self._blockWriting(true);
                self._popMessage(function (item) {
                    item.send(item.message);
                });
            }
        }
    });

   app.createServer = this.createServer_.bind(this, app.createServer || function () { throw new Error("no registered transport provider"); });
}


/**
 * @method createServer
 * Hook into createServer function to add additional Serial API Functions
 *
 * @param {String} Scheme, string that must be "zwave:" for hookup
 * @param {Object} Options dictionary that includes port url, baud rate etc. (see transport server)
 * @returns {Promise} 
 * @public
 */
ZwaveTransportThrottler.prototype.createServer_ = function ZwaveTransportThrottler_createServer(next, scheme, options) {

    if (scheme != "zwave:")
        return next(scheme, options);

    var server = next(scheme, options);

    var _send = server.send;
    server.send = this.send_.bind(this, _send.bind(server));

    return server;
};


ZwaveTransportThrottler.prototype.invoke = function (context, next) {

    var response = context[ZWAVE.RawPayload];
     //console.log("R: " + util.inspect(response));


    if (this.lastMessage && messageMatches(response, this.lastMessage)) {
        this.lastMessage = response;
        console.log("R: dropping duplicate");
        return Promise.resolve();
    }

    this.lastMessage = response;

    if (response[0] == PROTOCOL.SerialFrameType.SOF) {
        context[ZWAVE.Server].stream.write(new Buffer([PROTOCOL.SerialFrameType.ACK]));
          console.log("W: 06");
 
        this._blockWriting(false);
        this.messageQueueEvents.emit('queue_modified');
        return next();
    }
    
    // silently drop ACK etc.
    return Promise.resolve();
}

// HOOKED (PRIVATE) METHODS

ZwaveTransportThrottler.prototype.send_ = function (send, message) {    
    this.messageQueue.push({ send: send, message: message });
    this.messageQueueEvents.emit('queue_modified');
    return Promise.resolve();
}

// PRIVATE METHODS

ZwaveTransportThrottler.prototype._blockWriting = function (block) {
    this.block = block;
    if (block)
        this.messageQueueEvents.emit('writing_blocked')
    else
        this.messageQueueEvents.emit('writing_enabled');
}

ZwaveTransportThrottler.prototype._pushMessage = function (message) {
    this.messageQueue.push(message);
    this.messageQueueEvents.emit('queue_modified');
}

ZwaveTransportThrottler.prototype._popMessage = function (callback) {
    callback(this.messageQueue.shift());
    this.messageQueueEvents.emit('queue_modified');
}

// UTILITY METHODS

function contextMatches(context1, context2) {

    return (context1[ZWAVE.MessageType] == context2[ZWAVE.MessageType])
        && (context1[ZWAVE.Length] == context2[ZWAVE.Length])
        && (context1[ZWAVE.SerialFunctionClass] == context2[ZWAVE.SerialFunctionClass])
}

function messageMatches(response1, response2) {
    return ((response1[2] == response2[2])
        && (response1[1] == response2[1])
        && (response1[3] == response2[3])
        && (response1[3] !== PROTOCOL.SerialFunctionClass.GetNodeProtocolInfo)
        && response1.slice(4, -1).equals(response2.slice(4, -1)))

}
