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
 * Zwave Message Middleware
 * 
 * This middleware is composed the following functions:
 * 
 * 1. ZwaveTransactionMatcher
 *  - caches outgoing messages and matches to incoming response
 *  - hooks into send pipeline to provide a promise-based send response
 *  
 * Usage: app.use(ZwaveMessageMiddleware)
 * 
 * @class ZwaveMessageMiddleware
 * @param app  IOPA AppBuilder App
 * @constructor
 * @public
 */
function ZwaveMessageMiddleware(app) {
    _classCallCheck(this, ZwaveMessageMiddleware);

    app.use(ZwaveTransactionMatcher);
    app.use(ZwaveMessageThrottler);
}

ZwaveMessageMiddleware.prototype.invoke = function (context, next) {

    console.log("UNKNOWN EVENT");
    // console.log(context);
    return next();
}

module.exports = ZwaveMessageMiddleware;


/*
 * Zwave Message Throttler Middleware
 * 
 * This middleware 
 *  - hooks into server send to block further sends until response is received from zwave controller
 * 
 * @class ZwaveMessageThrottler
 * @param app  IOPA AppBuilder App
 * @constructor
 * @private
 */
function ZwaveMessageThrottler(app) {

    _classCallCheck(this, ZwaveMessageThrottler);

    this.messageQueue = new Array();
    this.messageQueueEvents = new EventEmitter();
    this.block = false;
    this.lastMessage = null;

    var self = this;

    this.messageQueueEvents.on("queue_modified", function () {
        if (self.messageQueue.length > 0) {
            if (!self.block) {
                self.block = true;
                var item = self.messageQueue.shift();
                item.send(item.message).then(function (response) {
                    item.resolve(response);
                    self.block = false;
                    self.messageQueueEvents.emit('queue_modified');
                })
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
ZwaveMessageThrottler.prototype.createServer_ = function ZwaveMessageThrottler_createServer(next, scheme, options) {

    if (scheme != "zwave:")
        return next(scheme, options);

    var server = next(scheme, options);

    var _send = server.send;
    server.send = this.send_.bind(this, _send.bind(server));

    return server;
};

ZwaveMessageThrottler.prototype.send_ = function (send, message) {
    var self = this;
    return new Promise(function (resolve, reject) {
        self.messageQueue.push({ resolve: resolve, reject: reject, send: send, message: message });
        self.messageQueueEvents.emit('queue_modified');
    })
}

/*
 * Zwave Transaction Matcher Middleware 
 * 
 * This Middleware
 *  - caches outgoing messages and matches to incoming response
 *  - hooks into send pipeline to provide a promise-based send response
 * 
 * @class ZwaveTransactionMatcher
 * @param app  IOPA AppBuilder App
 * @constructor
 * @private
 */
function ZwaveTransactionMatcher(app) {
    _classCallCheck(this, ZwaveTransactionMatcher);

    app.createServer = this.createServer_.bind(this, app.createServer || function () { throw new Error("no registered transport provider"); });
}

const ZWAVETRANSACTIONMATCHER = "_ZwaveTransactionMatcher";


/**
 * @method createServer
 * Hook into createServer function to add transaction matching per server
 *
 * @param {String} Scheme, string that must be "zwave:" for hookup
 * @param {Object} Options dictionary that includes port url, baud rate etc. (see transport server)
 * @returns {Promise} 
 * @public
 */
ZwaveTransactionMatcher.prototype.createServer_ = function ZwaveTransactionMatcher_createServer(next, scheme, options) {

    if (scheme != "zwave:")
        return next(scheme, options);

    var server = next(scheme, options)

    server[ZWAVE.Capabilities] = server[ZWAVE.Capabilities] || {};

    server[ZWAVE.Capabilities][ZWAVETRANSACTIONMATCHER] =
        {
            requestQueue: [],
            lastRequestFunctionClass: null
        }

    var _send = server.send;
    server.send = this.send_.bind(this, server, _send);

    return server;

};

ZwaveTransactionMatcher.prototype.invoke = function (context, next) {

    var server = context[ZWAVE.Server];
    var self = server[ZWAVE.Capabilities][ZWAVETRANSACTIONMATCHER];

    if (context[ZWAVE.MessageType] == PROTOCOL.SerialMessageType.Response
        && (context[ZWAVE.SerialFunctionClass].value == self.lastRequestFunctionClass
            && context[ZWAVE.SerialFunctionClass].value != PROTOCOL.SerialFunctionClass.RequestNodeInfo)
        || context[ZWAVE.SerialFunctionClass].value == PROTOCOL.SerialFunctionClass.ApplicationUpdate) {
        var lastRequest = self.requestQueue.shift() || {};
        self.lastRequestFunctionClass = lastRequest[ZWAVE.SerialFunctionClass];
        return Promise.resolve().then(function () {
            lastRequest.resolve(context);
        });
    } else {
        delete context[ZWAVE.Server];
        console.log(context);
        var lastRequest = self.requestQueue.shift() || {};
        self.lastRequestFunctionClass = lastRequest[ZWAVE.SerialFunctionClass];
        console.error("[ZWAVE] ZwaveTransactionMatcher Unknown response received");
    }

    return next();
}

ZwaveTransactionMatcher.prototype.send_ = function (server, nextSend, message) {

    var self = server[ZWAVE.Capabilities][ZWAVETRANSACTIONMATCHER];

    self.lastRequestFunctionClass = message[3];

    return nextSend(message).then(function () {
        return new Promise(function (resolve, reject) {
            self.requestQueue.push({
                [ZWAVE.SerialFunctionClass]: message[3],
                resolve: resolve,
                reject: reject
            });
        });
    });

}

