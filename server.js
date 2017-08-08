const config = require('./config'),
    platformid = "urn:io.resin:" + (process.env.RESIN_DEVICE_UUID || "localhost"),
    locationid = process.env.RESIN_LOCATION_ID || "home",
    mqtt = require('./lib/mqtt')({ locationid: locationid, platformid: platformid, config: config }),
    zwave = require('./lib/zwave')({ locationid: locationid, platformid: platformid, config: config, eventSink: mqtt.publish });
    mqtt.onmessage(zwave.invoke);

var os = require('os');

zwavedriverpaths = {
    "darwin": '/dev/cu.usbmodem1431',
    "linux": '/dev/ttyACM0',
    "windows": '\\\\.\\COM3'
}

process.removeAllListeners('SIGINT');

process.on('SIGINT', function () {
    console.log('disconnecting...');
    zwave.disconnect();

    mqtt.end(function () {
        process.exit();
    });
});

zwave.connect(zwavedriverpaths[os.platform()]);