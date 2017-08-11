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
 * Zwave Node Middleware
 * 
 * This middleware sends and receives Node-specifgic messages
 * 
 * Usage: app.use(ZwaveNodeMiddleware)
 * 
 * @class ZwaveNodeMiddleware
 * @param app  IOPA AppBuilder App
 * @constructor
 * @public
 */
function ZwaveNodeMiddleware(app) {
    _classCallCheck(this, ZwaveNodeMiddleware);

    if (!app.properties[SERVER.Capabilities][ZWAVE.Capabilities][ZWAVE.Version])
        throw new Error("ZwaveSerialApiMiddleware requires embedded ZwaveServer");

    app.use(ZwaveNodeSerialApi);
}

module.exports = ZwaveNodeMiddleware;

/*
 * Zwave Node Serial API Middleware
 * 
 * This middleware sends and receives Node-specific messages using the Zwave Serial API
 * 
 * Usage: app.use(ZwaveNodeSerialApi)
 * 
 * @class ZwaveNodeSerialApi
 * @param app  IOPA AppBuilder App
 * @constructor
 * @public
 */
function ZwaveNodeSerialApi(app) {
    _classCallCheck(this, ZwaveNodeSerialApi);
}

ZwaveNodeSerialApi.prototype.send = function (server, next, context) {

    if (typeof context !== 'object' || !context[ZWAVE.NodeId])
        return next(context);

    if (!context[ZWAVE.CommandClass] ||
        !context[ZWAVE.Command])
        throw new Error("[ZWAVE] Missing CommandClass or Command on sending a message to a specified Node");

    server[ZWAVE.CallbackId] = (server[ZWAVE.CallbackId] + 1) % 0xFF;

    var payload = context[ZWAVE.Payload];
    payload = payload ? (Array.isArray(payload) ? payload : [payload]) : [];

    var txOptions = context[ZWAVE.TransmitOptions] || PROTOCOL.TransmitOptions.None;

    var buffer = new Buffer([
        PROTOCOL.SerialFrameType.SOF,
        payload.length + 9,
        PROTOCOL.SerialMessageType.Request,
        PROTOCOL.SerialFunctionClass.SendData,
        context[ZWAVE.NodeId],
        payload.length + 2,
        context[ZWAVE.CommandClass],
        context[ZWAVE.Command],
        ...payload, txOptions, server[ZWAVE.CallbackId], 0x00]);

    return server.send({
    [ZWAVE.RawPayload]: buffer,
        [ZWAVE.DoNotCache]: true,
        [ZWAVE.NodeId]: context[ZWAVE.NodeId]
    });
    
}

/**
 * @method invoke
 * Iopa Invoke Method, called for each inbound zwave response / event
 *
 * @param {Object} Context Iopa Context Method
 * @param {Object} next Next middleware in pipeline, prebound to context method
 * @returns {Promise} 
 * @public
 */
ZwaveNodeSerialApi.prototype.invoke = function (context, next) {

    if (context[ZWAVE.SerialFunctionClass].value !== PROTOCOL.SerialFunctionClass.ApplicationCommandHandler)
        return next();

    var payload = context[ZWAVE.Payload];
    var node = {};
    context[ZWAVE.Nodes][context[ZWAVE.NodeId]] = node;

    switch (context[ZWAVE.CommandClass]) {
        case PROTOCOL.CommandClass.ManufacturerSpecific:
            switch (context[ZWAVE.Command]) {
                case PROTOCOL.ManufacturerSpecificCommand.Report:
                    node[ZWAVE.ManufacturerId] = toHex((payload[0] << 8) | payload[1])
                    node[ZWAVE.DeviceType] = toHex((payload[2] << 8) | payload[3]);
                    node[ZWAVE.DeviceId] = toHex((payload[4] << 8) | payload[5]);
                    break;
                case PROTOCOL.ManufacturerSpecificCommand.DeviceSpecificReport:
                    var dataType = payload[0] & 0x07;
                    var dataFormat = (payload[1] & 0xe0) >> 0x05;
                    var dataLength = payload[1] & 0x1f;

                    var data;

                    if (dataFormat == 0)
                        data = payload.slice(2, dataLength + 2).toString();
                    else
                        data = Array.prototype.slice.call(payload, 2, dataLength + 2).map(
                            function (i) { return toHex8(i) }
                        ).join(" ");

                    if (dataType == 1)
                        node[ZWAVE.ManufacturerSerialNumber] = data;
                    else
                        node[ZWAVE.ManufacturerDefault] = data;

                    break;
                default:
                    console.log("Unknown ManufacturerSpecific report");
            }
            break;
    }

    return next();
}

ZwaveNodeSerialApi.prototype.send = function (server, next, context) {

    if (typeof context !== 'object' || !context[ZWAVE.NodeId] || context[ZWAVE.RawPayload])
        return next(context);

    if (!context[ZWAVE.CommandClass] ||
        !context[ZWAVE.Command])
        throw new Error("[ZWAVE] Missing CommandClass or Command on sending a message to a specified Node");

    server[ZWAVE.CallbackId] = (server[ZWAVE.CallbackId] + 1) % 0xFF;

    var payload = context[ZWAVE.Payload];
    payload = payload ? (Array.isArray(payload) ? payload : [payload]) : [];

    var txOptions = context[ZWAVE.TransmitOptions] || PROTOCOL.TransmitOptions.None;

    var buffer = new Buffer([
        PROTOCOL.SerialFrameType.SOF,
        payload.length + 9,
        PROTOCOL.SerialMessageType.Request,
        PROTOCOL.SerialFunctionClass.SendData,
        context[ZWAVE.NodeId],
        payload.length + 2,
        context[ZWAVE.CommandClass],
        context[ZWAVE.Command],
        ...payload, txOptions, server[ZWAVE.CallbackId], 0x00]);

    return server.send({ [ZWAVE.RawPayload]: buffer, [ZWAVE.DoNotCache]: true, [ZWAVE.NodeId]: context[ZWAVE.NodeId] });
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



/*
  
///   
public TXStatus ZwaveSendDataMeta(byte nodeId, byte[] data, TXOption txOptions, int timeout)  
{  
    if (data == null)  
    {  
        throw new ArgumentNullException("data");  
    }  
    DataPacket[] res = new DataPacket[2]; // We are receiving 2 responses...  
    DataPacket req = new DataPacket();  
    req.AddPayload(nodeId);  
    req.AddPayload((byte)data.Length);  
    req.AddPayload(data);  
    req.AddPayload((byte)txOptions);  
    TXStatus rc = sessionLayer.RequestWithMultipleResponses(DataFrame.CommandType.CmdZwaveSendDataMeta, req, ref res, true, timeout);  
    if (rc != TXStatus.CompleteOk)  
    {  
        return rc;  
    }  
    return (TXStatus)res[1].GetPayload()[0];  
}  
  
  
  
public TXStatus ZwaveSendDataMulti(ArrayList nodeIdList, byte[] data, TXOption txOptions)  
{  
    if (nodeIdList == null || data == null)  
    {  
        throw new ArgumentNullException("nodeIdList");  
    }  
    DataPacket[] res = new DataPacket[2];  
    DataPacket req = new DataPacket();  
  
    req.AddPayload((byte)nodeIdList.Count);  
    req.AddPayload((byte[])nodeIdList.ToArray(typeof(byte)));  
    req.AddPayload((byte)data.Length);  
    req.AddPayload(data);  
    req.AddPayload((byte)txOptions);  
    TXStatus rc = sessionLayer.RequestWithMultipleResponses(DataFrame.CommandType.CmdZwaveSendDataMulti, req, ref res, true);  
    if (rc == TXStatus.CompleteOk)  
    {  
        return (TXStatus)res[1].GetPayload()[0];  
    }  
    else  
    {  
        return rc;  
    }  
}  */

