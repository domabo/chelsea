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

var SerialPort = require('serialport'),
  EventEmitter = require('events').EventEmitter,
  util = require('util'),
  PROTOCOL = require('./protocol-constants'),
  ZWAVE = PROTOCOL.ZWAVE,
  App = require('../iopa/appbuilder-slim');

const ZwaveMessageMiddleware = require('./zwave-message-middleware'),
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

  EventEmitter.call(this);

  this.options = options;
  this.controller = {};

  var app = new App();
  app.use(ZwaveTransportServer);
  app.use(ZwaveTransportMiddleware);
  app.use(ZwaveSerialApiMiddleware);
  app.use(ZwaveMessageMiddleware);
  app.build();

  this.app = app;

}

util.inherits(ZwaveBinding, EventEmitter);

ZwaveBinding.prototype.listen = function (port, options) {

  var server = this.app.createServer("zwave:", options);
  this.server = server;

  var self = this;
  server.listen(port, options)
    .then(function () {
      console.log("[ZWAVE] Zwave ready");
      self._initializeController();

    });
}

/*
    server.sendSerialRequest 
    server.sendSerialApiSetTimeouts 
*/

ZwaveBinding.prototype.disconnect = function () {
  this.server.close();
  this.server = null;
}

ZwaveBinding.prototype._initializeController = function () {
  var self = this;

  // GET ZWAVE VERSION
  this.server.sendSerialRequest(PROTOCOL.SerialFunctionClass.GetVersion)
    .then(function (response) {
      self.controller[ZWAVE.Version] = response[ZWAVE.Version];
      self.controller[ZWAVE.LibraryType] = response[ZWAVE.LibraryType];

      // SET API TIMEOUTS x10ms FOR ACK AND BTYES
      return self.server.sendSerialApiSetTimeouts(0x0f, 0x0a)

    }).then(function (response) {

      // SET RF POWER LEVEL
      return self.server.sendSerialRequest(PROTOCOL.SerialFunctionClass.RFPowerLevelSet, 0x00)
    }).then(function (response) {

      // GET SERIAL API CAPABILITIES
      return self.server.sendSerialRequest(PROTOCOL.SerialFunctionClass.SerialGetCapabilities)
    })
    .then(function (response) {
      self.controller[ZWAVE.SerialApiApplicationVersion] = response[ZWAVE.SerialApiApplicationVersion];
      self.controller[ZWAVE.ManufacturerId] = response[ZWAVE.ManufacturerId];
      self.controller[ZWAVE.DeviceType] = response[ZWAVE.DeviceType];
      self.controller[ZWAVE.DeviceId] = response[ZWAVE.DeviceId];
      self.controller[ZWAVE.SerialApiCapabilities] = response[ZWAVE.SerialApiCapabilities];

      // GET CONTROLLER CAPABILITIES
      return self.server.sendSerialRequest(PROTOCOL.SerialFunctionClass.GetControllerCapabilities)
    })
    .then(function (response) {
      self.controller[ZWAVE.IsSecondaryController] = response[ZWAVE.IsSecondaryController];
      self.controller[ZWAVE.IsOnOtherNetwork] = response[ZWAVE.IsOnOtherNetwork];
      self.controller[ZWAVE.IsSISPresent] = response[ZWAVE.IsSISPresent];
      self.controller[ZWAVE.IsRealPrimary] = response[ZWAVE.IsRealPrimary];
      self.controller[ZWAVE.IsStaticUpdateController] = response[ZWAVE.IsStaticUpdateController];

      // GET HOME ID
      return self.server.sendSerialRequest(PROTOCOL.SerialFunctionClass.GetHomeId)
    }).then(function (response) {
      self.controller[ZWAVE.HomeId] = response[ZWAVE.HomeId];
      self.controller[ZWAVE.OwnNodeId] = response[ZWAVE.OwnNodeId];

      // GET NODE DISCOVEY INFO AND REMAINING SERIAL API INFO
      return self.server.sendSerialRequest(PROTOCOL.SerialFunctionClass.SerialApiGetInitData)
    }).then(function (response) {
      self.controller[ZWAVE.IsSecondaryController] = response[ZWAVE.IsSecondaryController];
      self.controller[ZWAVE.IsSlaveApi] = response[ZWAVE.IsSlaveApi];
      self.controller[ZWAVE.HasTimerSupport] = response[ZWAVE.HasTimerSupport];
      self.controller[ZWAVE.IsStaticUpdateController] = response[ZWAVE.IsStaticUpdateController];
      self.controller[ZWAVE.SerialApiVersion] = response[ZWAVE.SerialApiVersion];
      if (response[ZWAVE.ChipType]) self.controller[ZWAVE.ChipType] = response[ZWAVE.ChipType];
      if (response[ZWAVE.ChipRevision]) self.controller[ZWAVE.ChipRevision] = response[ZWAVE.ChipRevision];

      self.nodes = response[ZWAVE.Nodes];
      return Promise.all(
        Object.keys(self.nodes).map(function (id) {

          return self.server.sendSerialRequest(PROTOCOL.SerialFunctionClass.GetNodeProtocolInfo, id)
            .then(function (response) {
              var node = self.nodes[id];
              node[ZWAVE.Listening] = response[ZWAVE.Listening];
              node[ZWAVE.Routing] = response[ZWAVE.Routing];
              node[ZWAVE.Version] = response[ZWAVE.Version];
              node[ZWAVE.FrequentlyListening] = response[ZWAVE.FrequentlyListening];
              node[ZWAVE.Beaming] = response[ZWAVE.Beaming];
              node[ZWAVE.Security] = response[ZWAVE.Security];
              node[ZWAVE.Reserved] = response[ZWAVE.Reserved];
              node[ZWAVE.BasicClass] = response[ZWAVE.BasicClass];
              node[ZWAVE.GenericClass] = response[ZWAVE.GenericClass];
              node[ZWAVE.SpecificClass] = response[ZWAVE.SpecificClass];
              if (response[ZWAVE.SupportedCmdClasses]) node[ZWAVE.SupportedCmdClasses] = response[ZWAVE.SupportedCmdClasses];
            })
        })
      )
    })
    .then(function () {
      return Promise.all(
        Object.keys(self.nodes).map(function (id) {
          if (id == self.controller[ZWAVE.OwnNodeId])
            return Promise.resolve();
          else
            return self.server.sendSerialRequest(PROTOCOL.SerialFunctionClass.RequestNodeInfo, id)
              .then(function (response) {
                var node = self.nodes[id];

                if (response[ZWAVE.Status].value == PROTOCOL.ApplicationUpdateFlags.NodeInfoReqFailed)
                  node[ZWAVE.Online] = false;
                else if (response[ZWAVE.Status].value == PROTOCOL.ApplicationUpdateFlags.NodeInfoReceived) {
                  if (response[ZWAVE.SupportedCmdClasses]) node[ZWAVE.SupportedCmdClasses] = response[ZWAVE.SupportedCmdClasses];
                  node[ZWAVE.Online] = true;
                  node[ZWAVE.BasicClass] = response[ZWAVE.BasicClass] || node[ZWAVE.BasicClass];
                  node[ZWAVE.GenericClass] = response[ZWAVE.GenericClass] || node[ZWAVE.GenericClass];
                  node[ZWAVE.SpecificClass] = response[ZWAVE.SpecificClass] || node[ZWAVE.SpecificClass];
                }

              })
        })
      );
    })
    .then(function () {
      // Omitted getting memory bytes 0, 1 and 2-9

      console.log(self.controller);
      console.log(self.nodes);
      self.emit('ready', self.controller, self.nodes);
    })
}

ZwaveBinding.prototype.send = function (message) {
  return this.server.send(message)
    .catch(function (er) {
      console.error(er);
    })
}

module.exports = ZwaveBinding;
