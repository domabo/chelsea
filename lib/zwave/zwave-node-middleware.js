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
 * Zwave Node Middleware
 * 
 * This middleware 
 * 
 * Usage: app.use(ZwaveNodeMiddleware)
 * 
 * @class ZwaveNodeMiddleware
 * @param app  IOPA AppBuilder App
 * @constructor
 * @public
 */
function ZwaveNodeMiddleware(app) {
    _classCallCheck(this, ZwaveSerialApiMiddleware);

    if (!app.properties[SERVER.Capabilities][ZWAVE.Capabilities][ZWAVE.Version])
        throw new Error("ZwaveNodeMiddleware requires embedded ZwaveServer");

    app.createServer = this.createServer_.bind(this, app.createServer || function () { throw new Error("no registered transport provider"); });

}

module.exports = ZwaveNodeMiddleware;

/**
 * @method createServer
 * Hook into createServer function to add additional Node Serial API Functions
 *
 * @param {String} Scheme, string that must be "zwave:" for hookup
 * @param {Object} Options dictionary that includes port url, baud rate etc. (see transport server)
 * @returns {Promise} 
 * @public
 */
ZwaveNodeMiddleware.prototype.createServer_ = function ZwaveNodeMiddleware_createServer(next, scheme, options) {

    if (scheme != "zwave:")
        return next(scheme, options);

    var server = next(scheme, options);

    server.sendNodeRequest = this.sendSerialRequest_.bind(this, server);
  
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
ZwaveNodeMiddleware.prototype.invoke = function (context, next) {

    switch (context[ZWAVE.SerialFunctionClass].value) {

    }
    console.log(context);
    return next();
}


ZwaveNodeMiddleware.prototype.sendNodeRequest = function (server, context, command, payload) {

    if (typeof context != 'object' && context > 0) {
        context = { [ZWAVE.NodeId]: context }
    }

    if (!context[ZWAVE.NodeId])
        return Promise.reject("Missing Node");

    command = command || context[ZWAVE.Commad];

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

public TXStatus ZwaveSendData(byte nodeId, byte[] data, TXOption txOptions)  
{  
    if (data == null)  
    {  
        throw new ArgumentNullException("data");  
    }  
    return ZwaveSendData(nodeId, data, txOptions, TIMEOUT);  
}  

public TXStatus ZwaveSendData(byte nodeId, byte[] data, TXOption txOptions, int timeout)  
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
    TXStatus rc = sessionLayer.RequestWithMultipleResponses(DataFrame.CommandType.CmdZwaveSendData, req, ref res, true, timeout);  
    if (rc == TXStatus.CompleteOk)  
    {  
        return (TXStatus)res[1].GetPayload()[0];  
    }  
    else  
    {  
        return rc;  
    }  
}  
  
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