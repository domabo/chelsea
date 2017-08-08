const mqtt = require('mqtt'),
    util = require('util'),
    IOPA = require('./constants').IOPA;

const rejectEvents = {
    'reconnect': 'info',
    'close': 'warn',
    'offline': 'warn',
    'error': 'error'
};

var invoke;

module.exports = function mqttInit(options) {

    var config = options.config;

    config.mqtt.options.will = {
        topic: config.root + "/" + options.locationid + "/" + options.platformid + "/" + "offline",
        payload: 'connection closed abnormally',
        qos: 0,
        retain: false
    };

    var client = mqtt.connect(config.mqtt.uri, config.mqtt.options)

    // MQTT Connection
    client.on('connect', function () {
        _mqttLog("[connected to broker]", 'log');
        client.subscribe(config.root + "/" + options.locationid + "/" + options.platformid + "/+/+/+");
    });

    // On message received on node	
    client.on('message', function (topic, message) {
        var topics = topic.split('/');
        var command = JSON.parse(message.toString());
        _mqttLog("[command received]", 'log', util.inspect({ driver: topics[3], home: topics[4], node: topics[5] }), util.inspect(command));
        invoke({ [IOPA.Path]: topic, [IOPA.Body]: message }, function(){ return Promise.resolve(true); });
    });

    for (var r in rejectEvents) {
        if (rejectEvents.hasOwnProperty(r)) {
            var lg = r;
            var logEvent = rejectEvents[r];
            client.on(r, function (arguments) {
                _mqttLog(lg, logEvent, arguments);
            });
        }
    }

    return {
        "publish": function (topic, payload) { client.publish(topic, payload) },
        "onmessage": function (_onmessage) { invoke = _onmessage; },
        "end": function (cb) {
            var topic = config.root + "/" + options.locationid + "/" + options.platformid + "/" + "offline";
            var payload = 'connection closed';

            client.publish(topic, payload);
            client.end(cb);
        }
    };

};

function _mqttLog(event, logLevel, ...args) {
    var args = args.filter(function (n) { return n != undefined });

    if (args.length > 0) {
        console[logLevel]('[MQTT] ' + event + ' ' + args.join(', '));
    } else {
        console[logLevel]('[MQTT] ' + event);
    }

}