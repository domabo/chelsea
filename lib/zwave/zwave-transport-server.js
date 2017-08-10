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
    SerialPort = require('serialport'),
    PROTOCOL = require('./protocol-constants'),
    SERVER = {Capabilities:  "server.Capabilities" },
    ZWAVE = PROTOCOL.ZWAVE,
    ZwaveStreamParser = require('./zwave-transport-stream-parser');

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

/*
 * Zwave Transport Server
 * 
 * This IOPA Middleware function should be one of the first middleware to be added to the App pipeline.
 * It adds a createServer function to the app (or hooks into one if already exists) to 
 * create Zwave server objects on demand.
 * 
 * Usage: app.use(ZwaveTransportServer)
 * 
 * One Transport Server can create multiple servers using the same pipeline for the use case
 * where multiple Zwave sticks or IP Gateways are available.
 * 
 * @class ZwaveTransportServer
 * @param app  IOPA AppBuilder App
 * @constructor
 * @public
 */
function ZwaveTransportServer(app) {

    _classCallCheck(this, ZwaveTransportServer);

    this._app = app;

    const packageVersion = require('../../package.json').version;

    app.properties[SERVER.Capabilities][ZWAVE.Capabilities] = {};
    app.properties[SERVER.Capabilities][ZWAVE.Capabilities][ZWAVE.Version] = packageVersion;

    app.createServer = this.createServer_.bind(this, app.createServer || function () { throw new Error("no registered transport provider"); });

}

module.exports = ZwaveTransportServer;

/**
 * @method createServer
 * Create server object with listen and close methods
 *
 * @param {Object} Options dictionary that includes port num, address string
 * @returns {Promise} 
 * @public
 */
ZwaveTransportServer.prototype.createServer_ = function ZwaveTransportServer_createServer(next, scheme, options) {
    if (scheme != "zwave:")
        return next(scheme, options);

    options = options || {};

    if (!this._app.properties[SERVER.IsBuilt])
        this._app.build();
    var server = {};

    server["zwave.TransportServer"] = true;
    server.listen = this.listen_.bind(this, server);
    server.close = this.close_.bind(this, server);
    server.send = this.send_.bind(this, server);

    return server;
};


/**
 * @method listen_
 * Create socket and bind to local port to listen for incoming requests
 *
 * @param {Object} Options dictionary that includes port device url or Node stream
 * @returns {Promise} 
 * @public
 */
ZwaveTransportServer.prototype.listen_ = function ZwaveTransportServer_listen(server, port, options) {

    server.port = port;
    server.options = options || { baudRate: 115200, dataBits: 8, stopBits: 1, parity: "none" };

    server._rawstream = new SerialPort(port, options);

    var parser = new ZwaveStreamParser();
    server._rawstream.pipe(
        parser);

    server.stream = server._rawstream;

    parser.on("data", this.onData_.bind(this, server));

    return new Promise(function (resolve, reject) {
        server._rawstream.on('open', function () {
            server.isOpen = true;

            console.log("[ZWAVE] Serial port ready");
            resolve(server);
        });
    });

};

ZwaveTransportServer.prototype.onData_ = function ZwaveTransportServer_onData(server, data) {
 
    console.log("R: " + util.inspect(data));

    var context = this._app.createContext();

    context[ZWAVE.RawPayload] = data;
    context[ZWAVE.Server] = server;

    this._app.invoke(context).then(function () {
        context = null;
    }).catch(function(er){
        throw er;
    })
}

ZwaveTransportServer.prototype.write_ = function ZwaveTransportServer_write(server, data) {
   console.log("W: " + util.inspect(data));
  
    return new Promise(function (resolve, reject) {
        server._rawstream.write(data);
        server._rawstream.drain(resolve);
    });
}

ZwaveTransportServer.prototype.send_ = function (server, message) {

    if (message.length > 1)
        message[message.length - 1] = PROTOCOL.generateChecksum(message);;

    return this.write_(server, message);

}

ZwaveTransportServer.prototype.close_ = function ZwaveTransportServer_write(server) {

    return new Promise(function (resolve, reject) {
        server._rawstream.close(resolve)
    });
}