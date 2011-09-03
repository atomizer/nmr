var http = require('http'),
	util = require('util'),
	paperboy = require('paperboy'),
	request = require('request'),
	spawn = require('spawn');

var MAP_URI = 'http://www.nmaps.net/ID/data';

var ROOT = require('path').join(__dirname, 'static');
var lock = {};

function serve(req, res) {
	var ip = req.connection.remoteAddress;
	if (req.method != 'GET') {
		res.writeHead(405, {'Allow': 'GET', 'Connection': 'Close'});
		res.end();
		util.log('405 ' + ip + ' bad method: ' + req.method);
		return;
	}
	// rewriting
	req.original_url = req.url;
	req.url = req.url.replace(/^\/(\d+)$/, '/$1-600');
	req.url = req.url.replace(/^\/full\/(\d+)$/, '/$1-600');
	req.url = req.url.replace(/^\/thumbs?\/(\d+)$/, '/$1-100');
	if (req.url.match(/^\/\d+-\d+$/)) req.url += '.png';
	// delivering
	paperboy
	.deliver(ROOT, req, res)
	.after(function(statCode) {
		util.log(statCode + ' ' + ip + ' ' + req.url);
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
			util.log('404 ' + ip + ' ' + req.url);
			return;
		}
		if (lock[map_id]) {
			res.writeHead(503);
			res.end();
			return;
		}
		lock[map_id] = map_id;
		var timeout = setTimeout(function() {
			res.writeHead(500);
			res.end();
			delete lock[map_id];
			console.log('!! BUG', map_id);
		}, 60000);
		console.time('cycle');
		request({uri: MAP_URI.replace('ID', map_id)}, function(e, mres, body) {
			if (e || mres.statusCode != 200 || !body) {
				clearTimeout(timeout);
				delete lock[map_id];
				res.writeHead(404, {'Content-Type': 'text/plain'});
				return res.end('NUMA returned ' + mres.statusCode + (e ? '\nError: ' + e : ''));
			}
			if (Buffer.isBuffer(body)) body = body.toString();
			// strip everything non-ascii for good measure
			for (var i = 0, l = body.length, b = body, body = ''; i < l; i++) {
				var c = b.charCodeAt(i);
				if (c > 31 && c < 128) body += b[i];
			}
			generate(body);
		});
		
		function generate(data) {
			// spawn worker process
			var events = spawn(__dirname + '/worker.js');
			events.on('spawned', function() {
				console.log('spawned worker for', map_id);
			});
			events.emit('render', {
				map_data: data,
				height: height,
				root: ROOT,
				map_id: map_id
			});
			events.on('success', function() {
				res.writeHead(302, {'Location': req.original_url});
				res.end();
				events.emit('terminate');
			});
			events.on('terminated', function() {
				delete lock[map_id];
				clearTimeout(timeout);
				console.timeEnd('cycle');
			});
		}
	});
}

var s = http.createServer();
s.on('request', serve);
s.listen(80);
