var http = require('http');
var request = require('request');
var util = require('util');

var s = http.createServer();
s.on('request', function(req, res) {
	res.writeHead('200', {'content-type': 'text/plain'});
	res.end(util.inspect(request));
});

s.listen(8080);
