var fs = require('fs'),
	path = require('path'),
	Canvas = require('canvas'),
	Image = Canvas.Image;

var NMR = require('./nmr').NMR,
	blur = require('./stackblur'),
	workerpool = require('./workerpool');

function canvasToFile(ca, where, callback) {
	try {
		var out = fs.createWriteStream(where);
		var stream = ca.createPNGStream();
		stream.on('data', function(chunk){
			out.write(chunk);
		});
		stream.on('end', function(){
			out.destroySoon();
			out.on('close', function(){
				callback();
			});
		});
	}
	catch (e) {
		//console.log('!! failed to save', where, 'with error:', e);
		callback();
	}
}

function genThumb(srcpath, dstpath, height, cb) {
	if (!height) { cb(); return; }
	var img = new Image();
	img.onload = function () {
		var ca = new Canvas(img.width, img.height);
		var c = ca.getContext('2d');
		c.drawImage(img, 0, 0, ca.width, ca.height);
		blur.stackBlurCanvasRGB(ca, 0, 0, img.width, img.height, img.height / height - 1);
		c2 = new Canvas(img.width * height/img.height, height);
		var c = c2.getContext('2d');
		c.patternQuality = 'fast';
		c.drawImage(ca, 0, 0, c2.width, c2.height);
		canvasToFile(c2, dstpath, function() {
			//console.log('T', srcpath, '-->', dstpath);
			cb();
		});
		c = ca = null;
	}
	img.onerror = function (e) {
		//console.log('!! image.onerror', srcpath, e.message)
		cb();
	}
	img.src = srcpath;
}

function renderToFile(options, cb) {
	// options
	var map_data = options.map_data,
		root = options.root,
		map_id = options.map_id,
		height = options.height || 600;
	//if (!map_data || !map_id) return cb();
	
	var th = 0, r;
	var filepath = path.join(root, map_id + '-');
	var fullpath = filepath + '600.png';
	
	if (height > 600) { // render hi-res
		r = new NMR({tilesize: Math.round(height / 600 * 24), printable: 1});
		r.render(map_data, function(res) {
			canvasToFile(res, filepath + height + '.png', cb);
		});
	} else { // render default, generate thumbnail if needed
		height = height < 600 ? height : 0;
		if (!path.existsSync(fullpath)) {
			r = new NMR();
			r.render(map_data, function(res) {
				canvasToFile(res, fullpath, function() {
					genThumb(fullpath, filepath + height + '.png', height, cb);
				});
			});
		} else genThumb(fullpath, filepath + height + '.png', height, cb);
	}
}

var me = new workerpool.Worker(function(action, data) {
	var self = this;
	this.jobs = 0;
	if (action === 'render') renderToFile(data, function() {
		self.saveResult('yay'); // for some reason it doesnt work without this
		self.jobDone();
		self.jobs++;
		if (self.jobs > 5) process.exit(0);
	});
});

