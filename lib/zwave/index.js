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

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var SerialPort = require('serialport'),
  EventEmitter = require('events').EventEmitter,
  util = require('util'),
  PROTOCOL = require('./protocol-constants'),
  ZWAVE = PROTOCOL.ZWAVE,
  App = require('../iopa-slim').App;

const
  ZwaveDatabaseMiddleware = require('./zwave-database-middleware'),
  ZwaveMessageMiddleware = require('./zwave-message-middleware'),
  ZwaveNodeMiddleware = require('./zwave-node-middleware'),
  ZwaveSerialApiMiddleware = require('./zwave-serial-middleware'),
  ZwaveTransportMiddleware = require('./zwave-transport-middleware'),
  ZwaveTransportServer = require('./zwave-transport-server');

/*
 * Zwave IOT Binding
 * 
 * This binding provides a self-contained ZWave Gateway:
 * 
 * Events:
 *    ready(controller, nodes):   Provides
 *  
 * Usage: 
 *    var binding = new ZwaveBinding();
 *    binding.listen("/dev/cu.usbmodem1431");
 *    binding.on("ready", function(controller, nodes) {   });
 * 
 * @class ZwaveBinding
 * @param options optional Options, not currently used
 * @constructor
 * @public
 */
function ZwaveBinding(options) {

  _classCallCheck(this, ZwaveBinding);

  EventEmitter.call(this);

  this.options = options;

  var app = new App();
  app.use("zwave:", ZwaveTransportServer);
  app.use(ZwaveTransportMiddleware);
  app.use(ZwaveSerialApiMiddleware);
  app.use(ZwaveNodeMiddleware);
  app.use(ZwaveMessageMiddleware);
  app.use(ZwaveDatabaseMiddleware)
  app.build();

  this.app = app;
}

util.inherits(ZwaveBinding, EventEmitter);

ZwaveBinding.prototype.listen = function (port, options) {

  var server = this.app.createServer("zwave:", options);
  this.server = server;

  var self = this;
  server.listen(port, options)
    .then(() => this._initializeController() )
    .then(() => {
      console.log(util.inspect(server.db, false, 100));
      console.log("[ZWAVE] Ready")
      this.emit('ready', server.db);
    });
}

ZwaveBinding.prototype.disconnect = function () {
  this.server.close();
  this.server = null;
}

ZwaveBinding.prototype._initializeController = function () {

  var server = this.server;
  var db = server.db;
  db[ZWAVE.Nodes] = {};
  var self = this;

  return this.run([
    () => server.sendSerialRequest(PROTOCOL.SerialFunctionClass.GetVersion),
    () => server.sendSerialApiSetTimeouts(0x0f, 0x0a),
    () => server.sendSerialRequest(PROTOCOL.SerialFunctionClass.RFPowerLevelSet, 0x00),
    () => server.sendSerialRequest(PROTOCOL.SerialFunctionClass.SerialGetCapabilities),
    () => server.sendSerialRequest(PROTOCOL.SerialFunctionClass.GetControllerCapabilities),
    () => server.sendSerialRequest(PROTOCOL.SerialFunctionClass.GetHomeId),
    () => server.sendSerialRequest(PROTOCOL.SerialFunctionClass.SerialApiGetInitData),
    () => server.sendGetNodeProtocolInfo(db.allNodes()),
    () => server.sendRequestNodeInfo(db.allNodesButSelf()),
    () => server.sendNodeSequence(db.onlineNodes(), PROTOCOL.CommandClass.ManufacturerSpecific, PROTOCOL.ManufacturerSpecificCommand.DeviceSpecificGet),
    () => server.sendNodeSequence(db.onlineNodes(), PROTOCOL.CommandClass.ManufacturerSpecific, PROTOCOL.ManufacturerSpecificCommand.Get),
    () => server.sendNodeSequence(db.onlineNodes(), PROTOCOL.CommandClass.ZwaveplusInfo, PROTOCOL.ZwaveplusInfoCommand.Get)
  ]).then(() => {     
    db = null;     
    server = null;  
   });
  
}

ZwaveBinding.prototype.run = function (tasks) {
  var current = Promise.resolve();
  for (var k = 0; k < tasks.length; ++k) {
    current = current.then(tasks[k]);
  }
  return current;
}

ZwaveBinding.prototype.send = function (context) {
  return this.server.send(context)
}

module.exports = ZwaveBinding;

