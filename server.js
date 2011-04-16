var http = require('http');
var request = require('request');
var util = require('util');
var canvas = require('canvas');

var s = http.createServer();
s.on('request', function(req, res) {
	res.writeHead('200', {'content-type': 'text/plain'});
	res.end(util.inspect(canvas) + '\n');
});

s.listen(80);
