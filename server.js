var http = require('http'),
	paperboy = require('paperboy'),
	request = require('request'),
	spawn = require('spawn');

MAP_URI = 'http://www.nmaps.net/ID/data';

var ROOT = '/home/node/static';
var lock = {};

var s = http.createServer();

function tryToServe(req, res) {
	var ip = req.connection.remoteAddress;
	if (req.method != 'GET') {
		res.writeHead(405, {'Allow': 'GET'});
		res.end();
		console.log('405', ip, req.method)
	}
	// rewriting
	req.url = req.url.replace(/^\/(\d+)$/, '/$1-600');
	req.url = req.url.replace(/^\/full\/(\d+)$/, '/$1-600');
	req.url = req.url.replace(/^\/thumbs?\/(\d+)$/, '/$1-100');
	if (req.url.match(/^\/\d+-\d+$/)) req.url += '.png';
	// delivering
	paperboy
	.deliver(ROOT, req, res)
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
		if (!m || !(map_id = +m[1]) || (height = +m[2]) > 2400 || !height) {
			res.writeHead(404, {'Content-Type': 'text/plain'});
			res.end('there is no such thing, sorry.');
			console.log('404', ip, req.url);
		} else {
			if (lock[map_id]) {
				res.writeHead(503);
				res.end();
				return;
			}
			lock[map_id] = map_id;
			request({uri: MAP_URI.replace('ID', map_id)}, function(e, mres, body) {
				if (!e && mres.statusCode == 200) {
					var events = spawn(__dirname + '/worker.js');
					events.on('spawned', function() {
						console.log('spawned worker for', map_id);
					});
					events.emit('render', { map_data: body, height: height, root: ROOT, map_id: map_id });
					events.on('success', function() {
						res.writeHead(302, {'Location': '/' + map_id + '-' + height});
						res.end();
						events.emit('terminate');
					});
					events.on('terminated', function() {
						delete lock[map_id];
						console.log('terminated worker for', map_id);
					});
				} else {
					res.writeHead(404, {'Content-Type': 'text/plain'});
					res.end('NUMA returned ' + mres.statusCode + (e ? '\nError: ' + e : ''));
					delete lock[map_id];
				}
			});
		}
	});
}

s.on('request', tryToServe);

s.listen(80);
