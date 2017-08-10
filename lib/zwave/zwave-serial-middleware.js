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
    PROTOCOL = require('./protocol-constants'),
    ZWAVE = PROTOCOL.ZWAVE,
    SERVER = { Capabilities: "server.Capabilities" };

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

/*
 * Zwave Serial API Middleware
 * 
 * This middleware 
 *  - Coverts responses from Serial API into fields on the ZWAVE (IOPA) Context Record
 *  - Adds Serial API Functions to the server object when server is created
 * 
 * Usage: app.use(ZwaveMessageSerialApiMiddleware)
 * 
 * @class ZwaveMessageSerialApiMiddleware
 * @param app  IOPA AppBuilder App
 * @constructor
 * @public
 */
function ZwaveSerialApiMiddleware(app) {
    _classCallCheck(this, ZwaveSerialApiMiddleware);

    if (!app.properties[SERVER.Capabilities][ZWAVE.Capabilities][ZWAVE.Version])
        throw new Error("ZwaveSerialApiMiddleware requires embedded ZwaveServer");

    app.createServer = this.createServer_.bind(this, app.createServer || function () { throw new Error("no registered transport provider"); });

}

module.exports = ZwaveSerialApiMiddleware;

/**
 * @method createServer
 * Hook into createServer function to add additional Serial API Functions
 *
 * @param {String} Scheme, string that must be "zwave:" for hookup
 * @param {Object} Options dictionary that includes port url, baud rate etc. (see transport server)
 * @returns {Promise} 
 * @public
 */
ZwaveSerialApiMiddleware.prototype.createServer_ = function ZwaveMessageSerialApiMiddleware_createServer(next, scheme, options) {

    if (scheme != "zwave:")
        return next(scheme, options);

    var server = next(scheme, options);

    server.sendSerialRequest = this.sendSerialRequest_.bind(this, server);
    server.sendSerialApiSetTimeouts = this.sendSerialApiSetTimeouts_.bind(this, server);

    return server;
};

/**
 * @method invoke
 * Iopa Invoke Method, called for each inbound zwave response / event
 *
 * @param {Object} Context Iopa Context Method
 * @param {Object} next Next middleware in pipeline, prebound to context method
 * @returns {Promise} 
 * @public
 */
ZwaveSerialApiMiddleware.prototype.invoke = function (context, next) {

    switch (context[ZWAVE.SerialFunctionClass].value) {

        case PROTOCOL.SerialFunctionClass.RequestNodeInfo:
            //silently ignore as Application Update Coming Next
            return Promise.resolve();

        case PROTOCOL.SerialFunctionClass.ApplicationUpdate:

            var payload = context[ZWAVE.Payload];
            var nodeId;
            var result = true;
            var updateState = payload[0];

            context[ZWAVE.Status] = PROTOCOL.ApplicationUpdateFlags.properties[updateState] || {};
            context[ZWAVE.Status].value = updateState;

            switch (updateState) {
                case PROTOCOL.ApplicationUpdateFlags.NodeInfoReceived:
                    // We've received a NIF, and this contains the node ID.
                    nodeId = payload[1];
                    context[ZWAVE.NodeId] = nodeId;

                    var length = payload[2];

                    context[ZWAVE.BasicClass] = PROTOCOL.BasicClass.properties[payload[3]] || {};
                    context[ZWAVE.BasicClass].value = payload[3];

                    context[ZWAVE.GenericClass] = PROTOCOL.GenericClass.properties[payload[4]] || {};
                    context[ZWAVE.GenericClass].value = payload[4];

                    var specificClassGroup = PROTOCOL.SpecificClass[context[ZWAVE.GenericClass].value] || {};
                    var specificClass = specificClassGroup[payload[5]] || context[ZWAVE.GenericClass].name;

                    context[ZWAVE.SpecificClass] = {
                        name: specificClass,
                        genericClass: context[ZWAVE.GenericClass].value,
                        value: payload[5]
                    }

                    var nifClasses = {};

                    for (var i = 6; i < length + 3; i++) {
                        var data = payload[i];
                        var commandClass = PROTOCOL.CommandClass.properties[data];
                        // Check if this is the control marker
                        // TODO: Implement control command classes

                        nifClasses[data] = commandClass.name || "unknown";

                    }
                    context[ZWAVE.SupportedCmdClasses] = nifClasses;
                    break;
                case PROTOCOL.ApplicationUpdateFlags.NodeInfoReqFailed:
                    break;
                default:
                    console.log("TODO: Implement Application Update Request Handling of %s", context[ZWAVE.Status].name || context[ZWAVE.Status].value)
            }
            break;
        case PROTOCOL.SerialFunctionClass.GetVersion:
            var libraryType = context[ZWAVE.Payload][12];
            context[ZWAVE.LibraryType] = PROTOCOL.VersionLibraryType.properties[libraryType] || {};
            context[ZWAVE.LibraryType].value = libraryType;
            context[ZWAVE.Version] = context[ZWAVE.Payload].slice(0, 11).toString();
            break;

        case PROTOCOL.SerialFunctionClass.SerialGetCapabilities:
            var payload = context[ZWAVE.Payload];
            context[ZWAVE.SerialApiApplicationVersion] = payload[0] + "." + payload[1];
            context[ZWAVE.ManufacturerId] = toHex((payload[2] << 8) | payload[3])
            context[ZWAVE.DeviceType] = toHex((payload[4] << 8) | payload[5]);
            context[ZWAVE.DeviceId] = toHex((payload[6] << 8) | payload[7]);
            var apiCapabilities = [];

            for (var by = 8; by < payload.length; by++) {
                for (var bi = 0; bi < 8; bi++) {
                    if ((payload[by] & (0x01 << bi)) != 0) {
                        var msgClassid = (((by - 8) << 3) + bi + 1);
                        apiCapabilities.push(msgClassid);
                    }
                }
            }
            context[ZWAVE.SerialApiCapabilities] = apiCapabilities;
            break;

        case PROTOCOL.SerialFunctionClass.GetHomeId:
            var payload = context[ZWAVE.Payload];
            context[ZWAVE.HomeId] = toHex32(payload[0], payload[1], payload[2], payload[3]);
            context[ZWAVE.OwnNodeId] = payload[4];
            break;

        case PROTOCOL.SerialFunctionClass.GetControllerCapabilities:
            var payload = context[ZWAVE.Payload];
            context[ZWAVE.IsSecondaryController] = (payload[0] & PROTOCOL.GetControllerCapabilitiesFlags.IsSecondaryController) > 0;
            context[ZWAVE.IsOnOtherNetwork] = (payload[0] & PROTOCOL.GetControllerCapabilitiesFlags.IsOnOtherNetwork) != 0;
            context[ZWAVE.IsSISPresent] = (payload[0] & PROTOCOL.GetControllerCapabilitiesFlags.IsSISPresent) != 0;
            context[ZWAVE.IsRealPrimary] = (payload[0] & PROTOCOL.GetControllerCapabilitiesFlags.IsRealPrimary) != 0;
            context[ZWAVE.IsStaticUpdateController] = (payload[0] & PROTOCOL.GetControllerCapabilitiesFlags.IsStaticUpdateController) != 0;
            break;

        case PROTOCOL.SerialFunctionClass.SerialApiGetInitData:
            var payload = context[ZWAVE.Payload];
            context[ZWAVE.IsSecondaryController] = (payload[1] & PROTOCOL.GetInitDataFlags.IsSecondaryController) > 0;
            context[ZWAVE.IsSlaveApi] = (payload[1] & PROTOCOL.GetInitDataFlags.SlaveApi) != 0;
            context[ZWAVE.HasTimerSupport] = (payload[1] & PROTOCOL.GetInitDataFlags.TimerSupport) != 0;
            context[ZWAVE.IsStaticUpdateController] = (payload[1] & PROTOCOL.GetInitDataFlags.IsStaticUpdateController) != 0;
            context[ZWAVE.SerialApiVersion] = payload[0];
            var nodeBytes = payload[2];
            if (payload.Length > nodeBytes) {
                chipType = payload[3 + nodeBytes];
                chipRev = payload[4 + nodeBytes];
                context[ZWAVE.ChipType] = payload[3 + nodeBytes];
                context[ZWAVE.ChipRevision] = payload[4 + nodeBytes];
            }

            const NODE_BYTES = 29;

            if (nodeBytes != NODE_BYTES) {
                console.error("[ZWAVE] SerialApiGetInitData Invalid number of node bytes = {}", nodeBytes);
                break;
            }

            var nodeId = 1;
            var nodes = {};

            for (var i = 3; i < 3 + nodeBytes; i++) {
                var incomingByte = payload[i];
                for (var j = 0; j < 8; j++) {
                    var b1 = incomingByte & Math.pow(2.0, j);
                    var b2 = Math.pow(2.0, j);
                    if (b1 == b2) {
                        nodes[nodeId] = { available: true }
                    }
                    nodeId++;
                }
            }
            context[ZWAVE.Nodes] = nodes;
            break;

        case PROTOCOL.SerialFunctionClass.GetNodeProtocolInfo:
            var payload = context[ZWAVE.Payload];
            context[ZWAVE.Listening] = (payload[0] & PROTOCOL.NodeCapabilityFlags.Listening) != 0;
            context[ZWAVE.Routing] = (payload[0] & PROTOCOL.NodeCapabilityFlags.Routing) != 0;
            context[ZWAVE.Version] = (payload[0] & PROTOCOL.NodeCapabilityFlags.Version) + 1;
            context[ZWAVE.FrequentlyListening] = (payload[1] & PROTOCOL.NodeCapabilityFlags.FrequentlyListening) != 0;
            context[ZWAVE.Beaming] = (payload[1] & PROTOCOL.NodeCapabilityFlags.Beaming) != 0;
            context[ZWAVE.Security] = (payload[1] & PROTOCOL.NodeCapabilityFlags.Security) != 0;

            var maxBaudRate = 9600;
            if ((payload[0] & PROTOCOL.NodeCapabilityFlags.HighBaudRate) == 0x10) {
                maxBaudRate = 40000;
            }

            context[ZWAVE.Reserved] = payload[2];

            context[ZWAVE.BasicClass] = PROTOCOL.BasicClass.properties[payload[3]] || {};
            context[ZWAVE.BasicClass].value = payload[3];

            context[ZWAVE.GenericClass] = PROTOCOL.GenericClass.properties[payload[4]] || {};
            context[ZWAVE.GenericClass].value = payload[4];

            var specificClassGroup = PROTOCOL.SpecificClass[context[ZWAVE.GenericClass].value] || {};
            var specificClass = specificClassGroup[payload[5]] || context[ZWAVE.GenericClass].name;

            context[ZWAVE.SpecificClass] = {
                name: specificClass,
                genericClass: context[ZWAVE.GenericClass].value,
                value: payload[5]
            }

            if (payload.Length > 6) {
                context[ZWAVE.SupportedCmdClasses] = new byte[payload.Length - 6];
                for (i = 0; i < (payload.Length - 6); i++) {
                    context[ZWAVE.SupportedCmdClasses][i] = payload[i + 6];
                }
            }
            break;
    }

    return next();
}


ZwaveSerialApiMiddleware.prototype.sendSerialRequest_ = function (server, context, payload) {

    if (typeof context != 'object' && context > 0) {
        context = { [ZWAVE.SerialFunctionClass]: context }
    }

    if (!context[ZWAVE.SerialFunctionClass])
        return Promise.reject("Missing function");

    payload = payload || context[ZWAVE.Payload];

    payload = payload ? (Array.isArray(payload) ? payload : [payload]) : [];

    var buffer = new Buffer([
        PROTOCOL.SerialFrameType.SOF,
        payload.length + 3,
        PROTOCOL.SerialMessageType.Request,
        context[ZWAVE.SerialFunctionClass],
        ...payload, 0x00]);

    return server.send(buffer);
}

ZwaveSerialApiMiddleware.prototype.sendSerialApiSetTimeouts_ = function (server, RXACKtimeout, RXBYTEtimeout) {
    return this.sendSerialRequest_(server, PROTOCOL.SerialFunctionClass.SerialApiSetTimeouts, [RXACKtimeout, RXBYTEtimeout])
}

// UTILITY METHODS

function toHex(d) {
    return "0x" + ("0000" + (+d).toString(16)).slice(-4);
}

function toHex32(b1, b2, b3, b4) {
    return toHex8(b1) + toHex8(b2) + toHex8(b3) + toHex8(b4);
}

function toHex8(b) {
    return ("00" + (+b).toString(16)).slice(-2);
}