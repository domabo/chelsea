var express = require('express');
var app = express();

// reply to request with "Hello World!"
app.get('/', function (req, res) {
  res.send('Hello World!');
});

const PORT=8080;
//start a server on port 80 and log its start to our console
var server = app.listen(PORT, function () {

  var port = server.address().port;
  console.log('Example app listening on port ', port);

});

const DEVICE="/dev/cu.usbmodem1431";
//const DEVICE="/dev/ttyACM0";

var Zwave = require('./lib/openzwave.js');

function main(){
	var zwave = new Zwave();
	zwave.open(DEVICE,false,function(){
	var encender =false;
	/*setInterval(function(){
		if(encender){
			zwave.swichOn(2);
		} else {
			zwave.swichOff(2);
		}
		encender=!encender;
	},500);*/

		zwave.swichOff(2);
		/*zwave.swichOff(2);
		zwave.swichOn(2);
		zwave.swichOff(2);
		zwave.swichOn(2);
		zwave.swichOff(2);
		zwave.swichOn(2);
		zwave.swichOff(2);
		zwave.swichOn(2);
		zwave.swichOff(2);
		zwave.swichOn(2);
*/
});
}
// main();