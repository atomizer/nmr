var http = require('http'),
	util = require('util'),
	paperboy = require('paperboy'),
	request = require('request'),
	workerpool = require('./workerpool');

var MAP_URI = 'http://www.nmaps.net/ID/data';

var ROOT = require('path').join(__dirname, 'static');

var wp = new workerpool.WorkerPool('worker.js', {
	jobTimeout: 60e3,
	minWorkers: 1,
	maxWorkers: 10,
	poolTimeout: 300e3
});

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
			res.end('404 Not Found\n\nIf you think this is an error, contact me.');
			util.log('404 ' + ip + ' ' + req.url);
			return;
		}
		console.time('cycle');
		request({uri: MAP_URI.replace('ID', map_id)}, function(e, mres, body) {
			if (e || mres.statusCode != 200 || !body) {
				res.writeHead(404, {'Content-Type': 'text/plain'});
				return res.end('map source returned ' + mres.statusCode + (e ? '\nError: ' + e : ''));
			}
			if (Buffer.isBuffer(body)) body = body.toString();
			// strip everything non-ascii for good measure
			for (var i = 0, l = body.length, b = body, body = ''; i < l; i++) {
				var c = b.charCodeAt(i);
				if (c > 31 && c < 128) body += b[i];
			}
			wp.addJob('render', {
				map_data: body,
				height: height,
				root: ROOT,
				map_id: map_id
			}, function(err) {
				console.timeEnd('cycle');
				if (err) {
					res.writeHead(503);
					res.write('503 Internal Server Error\n\n');
					res.end();
					return;
				}
				res.writeHead(302, {'Location': req.original_url});
				res.end();
			}, map_id);
		});
	});
}

var s = http.createServer();
s.on('request', serve);
s.listen(80);
