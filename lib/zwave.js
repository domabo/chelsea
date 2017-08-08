'use strict';
var ZWave = require('openzwave-shared');
var zwave;

var constants = require('./constants');
var DEVICE = require('./constants').DEVICE;
var IOPA = require('./constants').IOPA;

const ZWAVE_COMMAND_CLASS_VERSION = 134;

var util = require('util');

var publish;
var config;
var nodes = [];
var devicePath;
var homeid;
var platformid;
var locationid;

var service = {
    connect: connect,
    disconnect: disconnect,
    invoke: invoke
};

var zwaveEvents = {
    'value added': onValueAddedChanged.bind(null, '[value added]'),
    'value changed': onValueAddedChanged.bind(null, '[value changed]'),
    'value refeshed': onValueAddedChanged.bind(null, '[value refreshed]'),
    'value removed': onValueRemoved,
    'node available': _zwaveLog.bind(null, '[node available]', 'info'),
    'node added': onNodeAdded,
    'node ready': onNodeReady,
    'node removed': onNodeRemoved,
    'node naming': _zwaveLog.bind(null, '[node naming]', 'info'),
    'node event': _zwaveLog.bind(null, '[node event]', 'info'),
    'polling disabled': _zwaveLog.bind(null, '[polling disabled]', 'info'),
    'polling enabled': _zwaveLog.bind(null, '[polling enabled]', 'info'),
    'scene event': _zwaveLog.bind(null, '[scene event]', 'info'),
    'create button': _zwaveLog.bind(null, '[create button]', 'info'),
    'delete button': _zwaveLog.bind(null, '[delete button]', 'info'),
    'button on': _zwaveLog.bind(null, '[button on]', 'info'),
    'button off': _zwaveLog.bind(null, '[button off]', 'info'),
    'driver ready': onDriverReady,
    'driver failed': onDriverFailed,

    'scan complete': onScanComplete,
    'node reset': _zwaveLog.bind(null, '[node reset]', 'info'),
    'controller command': _zwaveLog.bind(null, '[controller command]', 'info')
};

module.exports = function init(options) {
    locationid = options.locationid;
    platformid = options.platformid;
    config = options.config;
    publish = options.eventSink;

    zwave = new ZWave(config.zwave);

    for (var z in zwaveEvents) {
        zwave.on(z, zwaveEvents[z]);
    }

    return service;
};

function connect(deviceString) {
    _zwaveLog('connecting to ', 'log', deviceString);
    devicePath = deviceString;
    zwave.connect(deviceString);
}

function disconnect() {
    zwave.disconnect(devicePath);
}

function onScanComplete() {
    _zwaveLog('[scan complete]', 'info');
}

function onDriverReady(home_id) {
    _zwaveLog('driver ready', 'log', "homeid=" + home_id);
    homeid = home_id;
}

function onDriverFailed() {
    _zwaveLog('driver failed', 'error');
    process.exit();
}

function onNodeAdded(id) {
    nodes[id] = {
        "zwave.Properties": {},
        "zwave.Ready": false
    },
        _zwaveLog('node added', 'log', id);
}

function onNodeRemoved(id) {
    delete nodes[id];
    publishEvent_(id, { removed: { [DEVICE.Id]: homeid + "-" + id } });
    _zwaveLog('node removed', 'log', id);
}

function onValueAddedChanged(event, id, comClass, value) {

    if (!nodes[id]["zwave.Properties"][comClass]) {
        nodes[id]["zwave.Properties"][comClass] = {};
    }

    nodes[id]["zwave.Properties"][comClass][value.index] = value;


    if (nodes[id]['zwave.Ready']) {
        _zwaveLog(event, 'log', "node" + id, _commandClassString(comClass), value.label + "=" + value.value);
        nodes[id]["zwave.ChangePayload"] = nodes[id]["zwave.ChangePayload"] || {};
        nodes[id]["zwave.ChangePayload"]['zwave.' + _commandClassString(comClass)] = nodes[id]["zwave.ChangePayload"]['zwave.' + _commandClassString(comClass)] || {};
        nodes[id]["zwave.ChangePayload"]['zwave.' + _commandClassString(comClass)][value.label] = value.value;

        eventPublishDebounced(id);
    }

}

function onValueRemoved(id, comClass, value) {
    if (nodes[id]["zwave.Properties"][comClass] && nodes[id]["zwave.Properties"][comClass][value.index]) {
        delete nodes[id]["zwave.Properties"][comClass][value.index];
        _zwaveLog('[value removed]', 'log', "node" + id, _commandClassString(comClass), util.inspect(value));

        if (nodes[id]['zwave.Ready']) {
            nodes[id]["zwave.ChangePayload"] = nodes[id]["zwave.ChangePayload"] || {};
            nodes[id]["zwave.ChangePayload"]['zwave.' + _commandClassString(comClass)] = nodes[id]["zwave.ChangePayload"]['zwave.' + _commandClassString(comClass)] || {};
            nodes[id]["zwave.ChangePayload"]['zwave.' + _commandClassString(comClass)][value.label] = null;

            eventPublishDebounced(id);
        }
    }
}

function onNodeReady(id, info) {
    if (id != 1 && !nodes[id]["zwave.Properties"][ZWAVE_COMMAND_CLASS_VERSION]) {
        _zwaveLog('[node ready without zwave version]', 'log', id, "requesting version");
        zwave.refreshNodeInfo(id);
        return;
    }

    nodes[id][DEVICE.Id] = homeid + "-" + id;
    nodes[id][DEVICE.ModelManufacturer] = info.manufacturer;
    nodes[id]['zwave.ManufacturerId'] = info.manufacturerid;
    nodes[id][DEVICE.ModelName] = info.product;
    nodes[id]['zwave.ProductType'] = info.producttype;
    nodes[id]['zwave.ProductId'] = info.productid;
    nodes[id][DEVICE.Type] = info.type;
    nodes[id][DEVICE.Name] = info.name;
    nodes[id][DEVICE.LocationName] = info.loc;
    nodes[id][DEVICE.Version] = getNodeValue_(id, ZWAVE_COMMAND_CLASS_VERSION, "Application Version");

    nodes[id]['zwave.Ready'] = true;

    _zwaveLog('[node ready]', 'log', "node" + id, "manufacturer=" + info.manufacturer, "product=" + info.product, "productid=" + info.productid, "type=" + info.producttype, "name=" + info.name, "location=" + info.loc);

    var payload = getDeviceStatePayload_(id);

    publishEvent_(id, { announce: payload });
}

// Command
function invoke(context, next) {
    var topics = context[IOPA.Path].split('/');
    var payload = JSON.parse(context[IOPA.Body].toString());
    var driver = topics[3];
    var home = topics[4];
    var id = topics[5];
    if (driver != 'zwave' ||  home != homeid)
          return next();

    return command(id, payload, next);
}

function command(id, payload, next) {
    _zwaveLog("[command received]", 'log', id, util.inspect(payload));
    if (payload.hasOwnProperty[DEVICE.Name])
        zwave.setNodeName(id, payload[DEVICE.Name]);

    if (payload.hasOwnProperty[DEVICE.Location])
        zwave.setDeviceLocation(id, payload[DEVICE.Location]);

    Object.keys(payload).forEach(function(key){

        if (key == DEVICE.Name)
              return zwave.setNodeName(id, payload[DEVICE.Name]);

        if (key == DEVICE.Location)
              return zwave.setNodeName(id, payload[DEVICE.Location]);

       var comClass = _commandClassFromString(key);

       if (comClass > -1)
         commandClass(id, comClass, payload[key]);

    });

    return next();
}


function commandClass(id, comClass, payload) {
    _zwaveLog("[command class received]", 'log', id, "zwave." + _commandClassString(comClass), util.inspect(payload));

}

// UTILITY FUNCTIONS

function getNodeValue_(id, comClass, label) {
    var versionObj = nodes[id]["zwave.Properties"][comClass] || {};
    nodes[id][DEVICE.Version] = (Object.keys(versionObj).map((k) => versionObj[k]).filter(function (value) { return (value.label == label) })[0] || {}).value;
}

function getDeviceStatePayload_(id) {
    var payloadLabels = [
        DEVICE.Id,
        DEVICE.ModelManufacturer,
        DEVICE.ModelName,
        DEVICE.Name,
        DEVICE.Type,
        DEVICE.LocationName,
        DEVICE.Version,
        'zwave.ManufacturerId',
        'zwave.ProductType',
        'zwave.ProductId'
    ];

    var payload = {};

    payloadLabels.forEach(function (label) {
        payload[label] = nodes[id][label];
    });

    for (var comClass in nodes[id]["zwave.Properties"]) {
        if (nodes[id]["zwave.Properties"].hasOwnProperty(comClass)) {
            switch (comClass) {
                case 0x25: // COMMAND_CLASS_SWITCH_BINARY
                case 0x26: // COMMAND_CLASS_SWITCH_MULTILEVEL
                    zwave.enablePoll(id, comClass);
                    break;
            }
            var values = nodes[id]["zwave.Properties"][comClass];
            payload['zwave.' + _commandClassString(comClass)] = {};
            for (var idx in values) {
                if (values.hasOwnProperty(idx) && values[idx]['value'] != undefined) {
                    payload['zwave.' + _commandClassString(comClass)][values[idx]['label']] = values[idx]['value'];
                }
            }
        }
    }

    return payload;
}

const eventPublishDebounced = debounce_(function (id) {
    var payload = nodes[id]["zwave.ChangePayload"];
    nodes[id]["zwave.ChangePayload"] = undefined;
    publishEvent(id, payload);
}, 2);

function publishEvent_(id, payload) {
    Object.keys(payload).forEach(function (key) {
        var topic = config.root + "/" + locationid + "/" + platformid + "/" + "zwave" + "/" + homeid + "/" + id + "/" + key;
        var subpayload = payload[key];
        subpayload["device.Timestamp"] = Date.now();
        subpayload["device.Source"] = "urn:io.iopa:zwave";

        console.log(topic);
        console.log(util.inspect(subpayload));
        publish(topic, JSON.stringify(subpayload));
    })
}

function debounce_(func, wait, immediate) {
    var timeout;
    return function () {
        var context = this, args = arguments;
        var later = function () {
            timeout = null;
            if (!immediate) func.apply(context, args);
        };
        var callNow = immediate && !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        if (callNow) func.apply(context, args);
    };
};

function _commandClassString(id) {
    var ret = constants.commandClass[id] || 'class' + id;
    return ret.charAt(0).toUpperCase() + ret.slice(1);
}

function _commandClassFromString(key) {
    var key = key.charAt(0).toLowerCase() + key.slice(1);

    if (key.startsWith("zwave."))
        {
            key = key.charAt(6).toLowerCase() + key.slice(7);
        }

    var id = constants.commandClass.indexOf(key);

    
}

function _zwaveLog(event, logLevel, ...args) {
    var args = args.filter(function (n) { return n != undefined });

    if (args.length == 2) {
        console[logLevel]('[ZWAVE] ' + event + ' node' + args[0] + " " + util.inspect(args[1]));
    } else
        if (args.length > 0) {
            console[logLevel]('[ZWAVE] ' + event + ' ' + args.join(', '));
        } else {
            console[logLevel]('[ZWAVE] ' + event);
        }
}

/* manufacturer: 'Dragon Tech/HomeSeer',
  manufacturerid: '0x0315',
  product: 'WS100+ Wall Switch',
  producttype: '0x4447',
  productid: '0x3033',
  type: 'On/Off Power Switch',
  name: '',
  loc: '' }*/

/*
 // Model
      ModelManufacturer: "device.ModelManufacturer",    // e.g., "Domabo"
      ModelManufacturerUrl: "device.ModelManufacturerUrl",   // e.g., "http://domabo.com"
      ModelName: "device.ModelName",  // e.g., "HomeKit Stick"
      ModelNumber: "device.ModelNumber",  // e.g., "HK100"
      ModelUrl: "device.ModelUrl",  // e.g., "http://domabo.com/support/HK100"

      // Physical Platform Instance
      PlatformId: "device.PlatformId",
      PlatformName: "device.PlatformName",   // e.g., "HomeKit Stick Primary"
      PlatformFirmware: "device.PlatformFirmware",   // e.g., "1.3.5"
      PlatformOS: "device.PlatformOS",  // e.g., "14.10.1"
      PlatformHardware: "device.PlatformHardware",  // e.g. "1.0B"
      PlatformDate: "device.PlatformDate",  // e.g., 2016-12-23

      // IOPA Logical Device (can be >1 per physical platform
      Id: "device.Id",   // e.g., "23424-22423-63653-2424-26262"
      Type: "device.Type", // e.g., "urn:com.domabo:Lightswitch"
      Version: "device.Version",  // e.g., "1.3.5"
      Location: "device.Location",   // e.g., {37.7833, 122.4167}
      LocationName: "device.LocationName", // e.g., "The Bellevue"
      Currency: "device.Currency", // e.g., "USD"
      Region: "device.Region",  // e.g., "Home"
      SystemTime: "device.SystemTime",
      Uri: "device.Uri", //e.g, "coap://locahost:23200/homestick"
      Resources: "device.Resources",
*/