var http = require('http')
var paperboy = require('paperboy')
var request = require('request')

MAP_URI = 'http://www.nmaps.net/ID/data'

var nmr = require('./nmr');
var ROOT = '/tmp';

var s = http.createServer();

function tryToServe(req, res, second_try) {
	if (req.method != 'GET') {
		res.writeHead(400, {'Content-Type': 'text/plain'});
		res.end('Bad Request');
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
		console.log(statCode, req.url);
	})
	.error(function(statCode, msg) {
		res.writeHead(statCode, {'Content-Type': 'text/plain'});
		res.end("Something went very wrong. Error " + statCode);
		console.log('!!', statCode, req.url, msg);
	})
	.otherwise(function(err) {
		var m = req.url.match(/^\/(\d+)-(\d+)/);
		if (second_try || !m) {
			res.writeHead(404, {'Content-Type': 'text/plain'});
			res.write('File not found. Error: ' + err);
			res.write('\n\nThis is all your fault.');
			res.end('\n'+second_try);
			console.log(404, req.url, err);
		} else {
			var height = m[2], map_id = m[1];
			request({uri: MAP_URI.replace('ID', map_id)}, function(e, mres, body) {
				if (!e && mres.statusCode == 200) {
					nmr.renderToFile(body, height, ROOT, map_id, function() {
						tryToServe(req, res, true);
					});
				} else {
					res.writeHead(mres.statusCode, {'Content-Type': 'text/plain'});
					res.end('Received bad status from NUMA: ' + mres.statusCode + '\nError: ' + e);
				}
			});
		}
	});
}

s.on('request', tryToServe);

s.listen(80);
