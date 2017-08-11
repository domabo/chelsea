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
    IopaServer = require('../iopa-slim').IopaServer,
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
}

module.exports = ZwaveSerialApiMiddleware;

ZwaveSerialApiMiddleware.prototype.invoke = function (context, next) {

    switch (context[ZWAVE.SerialFunctionClass].value) {

        case PROTOCOL.SerialFunctionClass.RequestNodeInfo:
        case PROTOCOL.SerialFunctionClass.SendData:
            //silently ignore as Application Update / Command Coming Next
            return Promise.resolve();

        case PROTOCOL.SerialFunctionClass.ApplicationCommandHandler:
            var payload = context[ZWAVE.Payload];
            context[ZWAVE.NodeId] = payload[1];
            context[ZWAVE.CommandClass] = payload[3];
            context[ZWAVE.Command] = payload[4];
            context[ZWAVE.Payload] = context[ZWAVE.Payload].slice(5);
            break;

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
                    var node = {};
                    context[ZWAVE.Nodes][nodeId] = node;

                    node[ZWAVE.NodeId] = nodeId;
                    node[ZWAVE.Online] = true;

                    var length = payload[2];

                    node[ZWAVE.BasicClass] = PROTOCOL.BasicClass.properties[payload[3]] || {};
                    node[ZWAVE.BasicClass].value = payload[3];

                    node[ZWAVE.GenericClass] = PROTOCOL.GenericClass.properties[payload[4]] || {};
                    node[ZWAVE.GenericClass].value = payload[4];

                    var specificClassGroup = PROTOCOL.SpecificClass[node[ZWAVE.GenericClass].value] || {};
                    var specificClass = specificClassGroup[payload[5]] || node[ZWAVE.GenericClass].name;

                    node[ZWAVE.SpecificClass] = {
                        name: specificClass,
                        genericClass: node[ZWAVE.GenericClass].value,
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
                    node[ZWAVE.SupportedCmdClasses] = nifClasses;
                    break;
                case PROTOCOL.ApplicationUpdateFlags.NodeInfoReqFailed:
                    context[ZWAVE.Nodes] = { 0: { [ZWAVE.Online]: false } };
                    console.log("Node Info failed");
                    break;
                default:
                    console.log("TODO: Implement Application Update Request Handling of %s", context[ZWAVE.Status].name || context[ZWAVE.Status].value)
            }
            break;
        case PROTOCOL.SerialFunctionClass.GetVersion:
            var payload = context[ZWAVE.Payload];
            var controller = context[ZWAVE.Controller];

            controller[ZWAVE.Version] = payload.slice(0, 11).toString();
            controller[ZWAVE.LibraryType] = PROTOCOL.VersionLibraryType.properties[payload[12]] || {};
            controller[ZWAVE.LibraryType].value = payload[12];
            break;

        case PROTOCOL.SerialFunctionClass.SerialGetCapabilities:
            var payload = context[ZWAVE.Payload];
            var controller = context[ZWAVE.Controller];

            controller[ZWAVE.SerialApiApplicationVersion] = payload[0] + "." + payload[1];
            controller[ZWAVE.ManufacturerId] = toHex((payload[2] << 8) | payload[3])
            controller[ZWAVE.DeviceType] = toHex((payload[4] << 8) | payload[5]);
            controller[ZWAVE.DeviceId] = toHex((payload[6] << 8) | payload[7]);
            var apiCapabilities = [];

            for (var by = 8; by < payload.length; by++) {
                for (var bi = 0; bi < 8; bi++) {
                    if ((payload[by] & (0x01 << bi)) != 0) {
                        var msgClassid = (((by - 8) << 3) + bi + 1);
                        apiCapabilities.push(msgClassid);
                    }
                }
            }
            controller[ZWAVE.SerialApiCapabilities] = apiCapabilities;
            break;

        case PROTOCOL.SerialFunctionClass.GetHomeId:
            var payload = context[ZWAVE.Payload];
            var controller = context[ZWAVE.Controller];

            controller[ZWAVE.HomeId] = toHex32(payload[0], payload[1], payload[2], payload[3]);
            controller[ZWAVE.OwnNodeId] = payload[4];
            break;

        case PROTOCOL.SerialFunctionClass.GetControllerCapabilities:
            var payload = context[ZWAVE.Payload];
            var controller = context[ZWAVE.Controller];

            controller[ZWAVE.IsSecondaryController] = (payload[0] & PROTOCOL.GetControllerCapabilitiesFlags.IsSecondaryController) > 0;
            controller[ZWAVE.IsOnOtherNetwork] = (payload[0] & PROTOCOL.GetControllerCapabilitiesFlags.IsOnOtherNetwork) != 0;
            controller[ZWAVE.IsSISPresent] = (payload[0] & PROTOCOL.GetControllerCapabilitiesFlags.IsSISPresent) != 0;
            controller[ZWAVE.IsRealPrimary] = (payload[0] & PROTOCOL.GetControllerCapabilitiesFlags.IsRealPrimary) != 0;
            controller[ZWAVE.IsStaticUpdateController] = (payload[0] & PROTOCOL.GetControllerCapabilitiesFlags.IsStaticUpdateController) != 0;
            break;

        case PROTOCOL.SerialFunctionClass.SerialApiGetInitData:
            var payload = context[ZWAVE.Payload];
            var controller = context[ZWAVE.Controller];

            controller[ZWAVE.IsSecondaryController] = (payload[1] & PROTOCOL.GetInitDataFlags.IsSecondaryController) > 0;
            controller[ZWAVE.IsSlaveApi] = (payload[1] & PROTOCOL.GetInitDataFlags.SlaveApi) != 0;
            controller[ZWAVE.HasTimerSupport] = (payload[1] & PROTOCOL.GetInitDataFlags.TimerSupport) != 0;
            controller[ZWAVE.IsStaticUpdateController] = (payload[1] & PROTOCOL.GetInitDataFlags.IsStaticUpdateController) != 0;
            controller[ZWAVE.SerialApiVersion] = payload[0];
            var nodeBytes = payload[2];
            if (payload.Length > nodeBytes) {
                chipType = payload[3 + nodeBytes];
                chipRev = payload[4 + nodeBytes];
                controller[ZWAVE.ChipType] = payload[3 + nodeBytes];
                controller[ZWAVE.ChipRevision] = payload[4 + nodeBytes];
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

            var node = {};
            context[ZWAVE.Nodes][0] = node;

            node[ZWAVE.Listening] = (payload[0] & PROTOCOL.NodeCapabilityFlags.Listening) != 0;
            node[ZWAVE.Routing] = (payload[0] & PROTOCOL.NodeCapabilityFlags.Routing) != 0;
            node[ZWAVE.Version] = (payload[0] & PROTOCOL.NodeCapabilityFlags.Version) + 1;
            node[ZWAVE.FrequentlyListening] = (payload[1] & PROTOCOL.NodeCapabilityFlags.FrequentlyListening) != 0;
            node[ZWAVE.Beaming] = (payload[1] & PROTOCOL.NodeCapabilityFlags.Beaming) != 0;
            node[ZWAVE.Security] = (payload[1] & PROTOCOL.NodeCapabilityFlags.Security) != 0;

            var maxBaudRate = 9600;
            if ((payload[0] & PROTOCOL.NodeCapabilityFlags.HighBaudRate) == 0x10) {
                maxBaudRate = 40000;
            }

            node[ZWAVE.Reserved] = payload[2];

            node[ZWAVE.BasicClass] = PROTOCOL.BasicClass.properties[payload[3]] || {};
            node[ZWAVE.BasicClass].value = payload[3];

            node[ZWAVE.GenericClass] = PROTOCOL.GenericClass.properties[payload[4]] || {};
            node[ZWAVE.GenericClass].value = payload[4];

            var specificClassGroup = PROTOCOL.SpecificClass[node[ZWAVE.GenericClass].value] || {};
            var specificClass = specificClassGroup[payload[5]] || node[ZWAVE.GenericClass].name;

            node[ZWAVE.SpecificClass] = {
                name: specificClass,
                genericClass: node[ZWAVE.GenericClass].value,
                value: payload[5]
            }

            if (payload.Length > 6) {
                node[ZWAVE.SupportedCmdClasses] = new byte[payload.Length - 6];
                for (i = 0; i < (payload.Length - 6); i++) {
                    node[ZWAVE.SupportedCmdClasses][i] = payload[i + 6];
                }
            }
            break;
    }

    return next();
}

// HELPER METHODS ADDED TO  SERVER PROTOTYPE

IopaServer.prototype.sendSerialRequest = function (context, payload) {

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

    var message = { [ZWAVE.RawPayload]: buffer };

    // Stash NodeId for payloads that have it as first byte
    if ([PROTOCOL.SerialFunctionClass.GetNodeProtocolInfo,
    PROTOCOL.SerialFunctionClass.RequestNodeInfo].indexOf(context[ZWAVE.SerialFunctionClass]) > -1)
        message[ZWAVE.NodeId] = payload[0];

    return this.send(message);

}

IopaServer.prototype.sendGetNodeProtocolInfo = function (nodes) {
    var server = this;

    if (Array.isArray(nodes)) {
        return Promise.all(
            nodes.map(function (id) {
                return server.sendSerialRequest(PROTOCOL.SerialFunctionClass.GetNodeProtocolInfo, id)
            })
        );
    } else {
        return server.sendSerialRequest(PROTOCOL.SerialFunctionClass.GetNodeProtocolInfo, id);
    }
}

IopaServer.prototype.sendRequestNodeInfo = function (nodes) {
    var server = this;

    if (Array.isArray(nodes)) {
        return Promise.all(
            nodes.map(function (id) {
                return server.sendSerialRequest(PROTOCOL.SerialFunctionClass.RequestNodeInfo, id)
            })
        );
    } else {
        return server.sendSerialRequest(PROTOCOL.SerialFunctionClass.RequestNodeInfo, nodes);
    }
}

IopaServer.prototype.sendNodeSequence = function (nodes, CmdClass, Cmd) {
    var server = this;

    return Promise.all(
        nodes.map(function (id) {
            return server.send({
                [ZWAVE.NodeId]: id,
                [ZWAVE.CommandClass]: CmdClass,
                [ZWAVE.Command]: Cmd
            })
        })
    );
    
}

IopaServer.prototype.sendSerialApiSetTimeouts = function (RXACKtimeout, RXBYTEtimeout) {
    return this.sendSerialRequest(PROTOCOL.SerialFunctionClass.SerialApiSetTimeouts, [RXACKtimeout, RXBYTEtimeout])
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