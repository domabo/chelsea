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
 * 2. ZwaveTransportFlowControl
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

    app.use(ZwaveLogger);
    app.use(ZwaveTransportFlowControl);
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


ZwaveMessageSerialFramer.prototype.send = function (server, next, context) {
  
    var message = context[ZWAVE.RawPayload] || context[ZWAVE.Payload];

    if (message.length > 1)
        message[message.length - 1] = PROTOCOL.generateChecksum(message);;

    context[ZWAVE.RawPayload] = message;

    return next(context);
}

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
function ZwaveLogger(app) {
    _classCallCheck(this, ZwaveLogger);
}

ZwaveLogger.prototype.invoke = function (context, next) {
   var data = context[ZWAVE.RawPayload];

    if (data.length  < 5)
        console.log("R: " + util.inspect(data));
    else
        console.log("R: "
            + PROTOCOL.SerialFunctionClass.properties[data[3]].name
            + " "
            + (data[3] == 0x04 ? "Node " + data[5] + " " + PROTOCOL.CommandClass.properties[data[7]].name + " " : "")
            + ((data[3] == 0x49 && data[5] !== 0) ? "Node " + data[5] + " " : "")
            + util.inspect(data));

    return next();
}

ZwaveLogger.prototype.send = function (server, next, context) {
  
    var data = context[ZWAVE.RawPayload] || context[ZWAVE.Payload];

    console.log("W: "
        + ((data.length > 1) ? PROTOCOL.SerialFunctionClass.properties[data[3]].name + " " : "")
        + (data[3] == 0x13 ? "Node " + data[4] + " " + PROTOCOL.CommandClass.properties[data[6]].name + " " : "")
        + util.inspect(data));

    return next(context);
}

/*
 * Zwave Transport Flow Control Middleware
 * 
 * This middleware 
 *  - hooks into server write to block further writes until ACK is received from zwave controller
 *  - hooks into invoke to autorespond with ACKs to SOF messages
 *  - hooks into invoke to ignore duplicate messages received
 * 
 * @class ZwaveTransportFlowControl
 * @param app  IOPA AppBuilder App
 * @constructor
 * @private
 */
function ZwaveTransportFlowControl(app) {

    _classCallCheck(this, ZwaveTransportFlowControl);

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
                    item.send(item.context);
                });
            }
        }
    });

}

// PUBLIC METHODS

ZwaveTransportFlowControl.prototype.invoke = function (context, next) {

    if (this.lastMessage && messageMatches(context, this.lastMessage)) {
        this.lastMessage = context;
        console.log("R: dropping duplicate");
        return Promise.resolve();
    }

    this.lastMessage = context;
    var response = context[ZWAVE.RawPayload]

    if (response[0] == PROTOCOL.SerialFrameType.SOF) {
        context[ZWAVE.Capabilities][ZWAVE.Server].stream.write(new Buffer([PROTOCOL.SerialFrameType.ACK]));
        this._blockWriting(false);
        this.messageQueueEvents.emit('queue_modified');
        return next();
    }
    
    // silently drop ACK etc.
    return Promise.resolve();
}

ZwaveTransportFlowControl.prototype.send = function (server, next, context) {  
    if (context[ZWAVE.RawPayload].length < 2) 
        return next(context);

    this.messageQueue.push({ send: next, context: context });
    this.messageQueueEvents.emit('queue_modified');
    return Promise.resolve();
}

// PRIVATE METHODS
ZwaveTransportFlowControl.prototype._blockWriting = function (block) {
    this.block = block;
    if (block)
        this.messageQueueEvents.emit('writing_blocked')
    else
        this.messageQueueEvents.emit('writing_enabled');
}

ZwaveTransportFlowControl.prototype._pushMessage = function (item) {
    this.messageQueue.push(item);
    this.messageQueueEvents.emit('queue_modified');
}

ZwaveTransportFlowControl.prototype._popMessage = function (callback) {
    callback(this.messageQueue.shift());
    this.messageQueueEvents.emit('queue_modified');
}

// UTILITY METHODS
function messageMatches(response1, response2) {
    var payload1 = response1[ZWAVE.RawPayload];
    var payload2 = response2[ZWAVE.RawPayload];
   
    return ((payload1[2] == payload2[2])
        && (payload1[1] == payload2[1])
        && (payload1[3] == payload2[3])
        && (payload1[3] !== PROTOCOL.SerialFunctionClass.GetNodeProtocolInfo)
        && payload1.slice(4, -1).equals(payload2.slice(4, -1)))

}
