var http = require('http')
var paperboy = require('paperboy')
var request = require('request')

MAP_URI = 'http://www.nmaps.net/ID/data'

var nmr = require('./nmr');
var ROOT = '/tmp';

var s = http.createServer();

function tryToServe(req, res, second_try) {
	var ip = req.connection.remoteAddress;
	if (req.method != 'GET') {
		res.writeHead(400, {'Content-Type': 'text/plain'});
		res.end('Bad Request');
		console.log(400, ip, req.method)
	}
	// rewriting
	req.url = req.url.replace(/^\/(\d+)$/, '/$1-600');
	req.url = req.url.replace(/^\/full\/(\d+)$/, '/$1-600');
	req.url = req.url.replace(/^\/thumb\/(\d+)$/, '/$1-100');
	if (req.url.match(/^\/\d+-\d+$/)) req.url += '.png';
	// delivering
	paperboy
	.deliver(ROOT, req, res)
	.before(function() {
		// console.log('req', req.url);
	})
	.after(function(statCode) {
		console.log(statCode + '', ip, req.url);
	})
	.error(function(statCode, msg) {
		res.writeHead(statCode, {'Content-Type': 'text/plain'});
		res.end("Something went very wrong.\nError " + statCode);
		console.log('!!', statCode, ip, req.url, msg);
	})
	.otherwise(function(err) {
		var m = req.url.match(/^\/(\d+)-(\d+)/);
		var height, map_id;
		if (second_try || !m || !(map_id = +m[1]) || ((height = +m[2]) >= 2400) ) {
			res.writeHead(404, {'Content-Type': 'text/plain'});
			res.end('there is no such thing, sorry.');
			console.log('404', ip, req.url);
		} else {
			request({uri: MAP_URI.replace('ID', map_id)}, function(e, mres, body) {
				if (!e && mres.statusCode == 200) {
					nmr.renderToFile(body, height, ROOT, map_id, function() {
						tryToServe(req, res, true);
					});
				} else {
					res.writeHead(mres.statusCode, {'Content-Type': 'text/plain'});
					res.end('NUMA returned ' + mres.statusCode + (e ? '\nError: ' + e : ''));
				}
			});
		}
	});
}

s.on('request', tryToServe);

s.listen(80);
