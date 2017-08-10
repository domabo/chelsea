const config = require('./config'),
  util = require('util'),
  SerialPort = require('serialport'),
  Zwave = require('./lib/zwave'),
  platformid = "urn:io.resin:" + (process.env.RESIN_DEVICE_UUID || "localhost"),
  locationid = process.env.RESIN_LOCATION_ID || "home",
  mqtt = require('./lib/mqtt-binding/mqtt')({ locationid: locationid, platformid: platformid, config: config }),
  zwave = new Zwave({ locationid: locationid, platformid: platformid, config: config, eventSink: mqtt.publish });

//  mqtt.onmessage(zwave.invoke);

process.removeAllListeners('SIGINT');

process.on('SIGINT', function () {
  console.log('disconnecting...');
  zwave.disconnect();

  mqtt.end(function () {
    process.exit();
  });
});

findZwavePort(function (error, port) {
  if (!error) {
    console.log("Connecting to " + port.comName)
    zwave.listen(port.comName);
  }
});

function isZwavePort(port) {
  return ((port.vendorId == '0x0658' &&
    port.productId == '0x0200') ||  // Aeotech Z-Stick Gen-5
    (port.vendorId == '0x0658' &&
      port.productId == '0x0280') ||  // UZB1
    (port.vendorId == '0x10c4' &&
      port.productId == '0xea60'));   // Aeotech Z-Stick S2
}

function findZwavePort(callback) {
  SerialPort.list(function listPortsCallback(error, ports) {
    if (error) {
      console.error(error);
      callback(error);
    }

    for (var port of ports) {
      if (isZwavePort(port)) {
        callback(null, port);
        return;
      }
    }
    callback('No Zwave port found');
  });
}