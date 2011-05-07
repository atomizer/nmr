var VERSION = '016n';

var fs = require('fs'),
	path = require('path'),
	im = require('imagemagick'),
	Canvas = require('canvas'),
	Image = Canvas.Image;

console.log('Using cairo', Canvas.cairoVersion);

var font = require('./font');

var IMAGE_ROOT = '/home/node/static/images';

var PI = Math.PI;
var FARAWAY = -1e4;
var COLS = 31, ROWS = 23;
// these two indicate which objects can change their 'r', 'xw', 'yw' properties
var RADIUS = { 0: 6.0, 2: 6.0, 4: 6.0, 5: 10.0, 6: 9.0, 11: 12.0, 12: 4.0 };
var WIDTH = { 1: 9.6, 8: 9.0 };
// polygons for tiles
var TILEPOLY = [[],
	[-1,-1, 1, 1,-1, 1],
	[], [],
	[ 1, 1,-1, 0,-1, 1],
	[-1,-1, 1, 0, 1, 1,-1, 1],
	[-1,-1, 0, 1,-1, 1],
	[-1,-1, 0,-1, 1, 1,-1, 1],
	[-1, 1, 1, 1, 1, 0,-1, 0]];

// ========================================================
// ============= pure functions

function rotate_pts(a, dir) {
	// 4-way array rotation
	var ra = [];
	while (dir > 3) dir -= 4;
	while (dir < 0) dir += 4;
	for (var i = 0, l = a.length; i < l; i += 2) {
		ra[i]   = dir % 2 ? a[i+1] : a[i];
		ra[i+1] = dir % 2 ? a[i] : a[i+1];
		if (dir > 1) {
			ra[i] = -ra[i]; ra[i+1] = -ra[i+1];
		}
	}
	return ra;
}

function clrTrans(color, tr) {
	// colorTransform, canvas way
	tr = tr.split('.');
	if (tr.length < 8) return color;
	for (var i = 0; i < 8; i++) {
		tr[i] = +tr[i];
		if (isNaN(tr[i])) return color;
	}
	var c = [];
	// step 1: deserialization from canvas-style color
	if (color[0] == '#') { // "#aabbcc"
		c[3] = 1;
		for (var i = 0; i < 3; i++) c[i] = +('0x' + color.substr(i*2+1, 2));
	}
	else { // "rgba(r,g,b,a)"
		c = color.match(/\((.+)\)/)[1].split(',');
		for (var i = 0; i < c.length; i++) c[i] = +c[i];
	}
	// step 2: transformation
	for (var i = 0; i < 3; i++) {
		c[i] = c[i] * tr[i * 2] / 100 + tr[i * 2 + 1];
		c[i] = c[i] > 255 ? 255 : (c[i] < 0 ? 0 : c[i]);
	}
	c[3] = c[3] * tr[6] / 100 + tr[7] / 255;
	c[3] = c[3] > 1 ? 1 : (c[3] < 0 ? 0 : c[3]);
	// step 3: serialization
	var s = 'rgba(';
	for (var i = 0; i < 3; i++) s += Math.round(c[i]) + ', ';
	s += c[3] + ')';
	return s;
}

function hashed(s) {
	// string -> string [6]
	hash = 100500;
	for (var i = 0, l = s.length; i < l; i++)
		hash = ((hash << 5) + hash) ^ s[i].charCodeAt();
	if (hash < 0) hash = -hash;
	hash = hash.toString(36);
	while (hash.length < 6) hash = '0' + hash;
	return hash;
}

// ========================================================
// ============= init

var NMR = exports.NMR = function(options) {
	options = options || {};
	this.tilesize = +options['tilesize'] || 24;
	this.printable = options['printable'] ? 1 : 0; // always 1px lines or not
	this.aa = +options['aa'] || 1; // antialiasing multiplier
	
	this.zooms = [];
	this.cz = 1; // current zoom (for size mods); x_real = x / cz
	
	this.mods = {};
	
	this.pending = 0; // how many images are not loaded yet
	this.images = {};
	
	this.rw = (COLS + 2) * this.tilesize;  // real dimensions
	this.rh = (ROWS + 2) * this.tilesize;
	this.ca = new Canvas(this.rw * this.aa, this.rh * this.aa);
	var c = this.ca.getContext('2d');
	c.lineCap = 'square';
	c.antialias = 'gray';
	c.patternQuality = 'best';
	this.c = c;
}

// ========================================================
// ============= zooming

NMR.prototype.zoom = function(factor) {
	this.zooms.push(this.cz);
	this.c.save();
	this.c.scale(factor, factor);
	this.cz *= factor;
	this.c.lineWidth = this.printable ? 1 : this.aa/this.cz;
}

NMR.prototype.popzoom = function() {
	if (this.zooms.length) {
		this.c.restore();
		var pz = this.cz;
		this.cz = this.zooms.pop();
		return pz;
	} else {
		console.log('POPZOOM!!!11');
		return 1;
	}
}

// ========================================================
// ============= drawing

NMR.prototype.rnd = function(x, cross) {
	// round to the pixel's center
	var mul = this.cz / this.aa;
	return (Math.floor(x * mul) + (cross ? 0 : 0.5)) / mul;
}

NMR.prototype.clr = function(type, fill, stroke) {
	// set stroke and fill colors in one line, applying transformation if necessary
	var t;
	if (type != null && this.mods[type+3] && (t = this.mods[type+3]['_color'])) {
		if (fill) {
			this.c.fillStyle = fill;
			fill = clrTrans(this.c.fillStyle, t);
		}
		if (stroke) {
			this.c.strokeStyle = stroke;
			stroke = clrTrans(this.c.strokeStyle, t);
		}
	}
	if (fill) this.c.fillStyle = fill;
	if (stroke) this.c.strokeStyle = stroke;
}

NMR.prototype.line = function(x1, y1, x2, y2) {
	// sharp 1px line
	if (!isNaN(x2 + y2)) {
		this.c.moveTo(this.rnd(x1), this.rnd(y1));
		this.c.lineTo(this.rnd(x2), this.rnd(y2));
	} else {
		this.c.lineTo(this.rnd(x1), this.rnd(y1));
	}
}

NMR.prototype.rect = function(x, y, w, h, centered, fill, stroke, noclip) {
	if (centered) { x = x - w / 2; y = y - h / 2; }
	if (fill || stroke) this.c.beginPath();
	this.c.rect(x, y, w, h);
	if (fill) this.c.fill();
	if (stroke) {
		this.c.beginPath();
		this.line(x, y, x+w, y);
		this.line(x+w, y+h);
		this.line(x, y+h);
		this.c.closePath();
		this.c.stroke();
	}
}

NMR.prototype.circle = function(x, y, r, fill, stroke) {
	if (fill || stroke) this.c.beginPath();
	this.c.arc(x, y, r, 0, PI*2, false);
	if (fill) this.c.fill();
	if (stroke) this.c.stroke();
}

NMR.prototype.poly = function(a, fill, stroke, noclose) {
	// polygon from array [x1, y1, x2, y2, ...]
	if (!a || a.length < 4) return;
	if (fill || stroke) this.c.beginPath();
	this.c.moveTo(a[0], a[1]);
	for (var i = 2, l = a.length; i < l; i += 2) {
		this.c.lineTo(a[i], a[i+1]);
	}
	if (!noclose) this.c.closePath();
	if (fill) this.c.fill();
	if (stroke) this.c.stroke();
}

NMR.prototype.regularpoly = function(r, n, fill, stroke) {
	// regular polygon
	// used only for drones - do we really need it?
	if (fill || stroke) this.c.beginPath();
	var a = PI*2 / n;
	var R = r / Math.cos(a/2);
	this.c.save();
	this.c.rotate(-a/2);
	this.c.moveTo(R, 0);
	for (var i = 0; i < n - 1; i++) {
		this.c.rotate(a);
		this.c.lineTo(R, 0);
	}
	this.c.closePath();
	this.c.restore();
	if (fill) this.c.fill();
	if (stroke) this.c.stroke();
}

NMR.prototype.turret = function(type, r) {
	// 4 arcs around gauss & rocket
	this.clr(type, '', '#000');
	for (var i = 0; i < 6; i += PI/2) {
		this.c.beginPath();
		this.c.arc(0, 0, r, i + 0.2, PI/2 + i - 0.2, false);
		this.c.stroke();
	}
}

// ========================================================
// ============= handling external images

NMR.prototype.prepImage = function(urlf, blend, cb) {
	var m, url;
	var url_re = /^(http:\/\/.+\.(gif|jpg|png))(?:\?(.+))?$/;
	
	if (!urlf || this.images[urlf] || !(m = urlf.match(url_re)) || !(url = m[1])) {
		if (--this.pending == 0) cb();
		return;
	}
	this.images[urlf] = {};
	blend = blend || +m[3] || 0;
	
	if (!cb) cb = function(){ console.log('!! generic callback on prepImage') };
	
	var that = this;
	var filename = path.join(IMAGE_ROOT, hashed(url) + '.png');
	
	function expandImages() {
		var img = new Image();
		img.onload = function () {
			that.images[urlf] = { data: img, blend: blend }
			if (--that.pending == 0) cb();
		}
		img.onerror = function (e) {
			console.log('!! image.onerror', filename, e.message)
			if (--that.pending == 0) cb();
		}
		img.src = filename;
	}
	var found = 1;
	try { fs.statSync(filename); }
	catch (e) { found = 0; }
	if (found) {
		expandImages();
		return;
	}
	im.convert([url, '-limit', 'memory', '1mb', filename],
	function(e, stdout, stderr){
		if (e) {
			console.log('!! convert', url, 'error:', e.message);
			if (--that.pending == 0) cb();
			return;
		}
		console.log('#', url, '=>', filename);
		expandImages();
	});
}

var blend_to_composite = ['over', 'over', 'over', 'multiply', 'screen',
	'ligther', 'darker', 'difference', 'add', 'substract',
	'invert', 'alpha', 'erase', 'overlay', 'hard-light']
	// TODO: implement add,substract,alpha,erase

NMR.prototype.drawImage = function(isrc, x, y) {
	var i = this.images[isrc];
	if (!i || !i.data) return;
	x = x || 0; y = y || 0;
	try {
		switch (i.blend) {
		case 10: // invert
			var ca = new Canvas(i.data.width, i.data.height);
			var ctx = ca.getContext('2d');
			ctx.drawImage(i.data, 0, 0);
			ctx.globalCompositeOperation = 'source-in';
			ctx.fillStyle = '#fff';
			ctx.fillRect(0, 0, ca.width, ca.height);
			this.c.globalCompositeOperation = 'difference';
			this.c.drawImage(ca, x, y);
		break;
		default:
			this.c.globalCompositeOperation = blend_to_composite[i.blend];
			this.c.drawImage(i.data, x, y);
		}
		this.c.globalCompositeOperation = 'over';
	}
	catch (e) {
		console.log('!! drawImage', i.data.src, ':', e.message);
	}
}

// ========================================================
// ============= serious stuff

NMR.prototype.addTile = function(x, y, type) {
	var sx = [1,-1,-1, 1], sy = [1, 1,-1,-1];
	this.c.translate(x * 2 + 3, y * 2 + 3);
	// clamp type to [0..33], like n does.
	// though tiles > 33 behave oddly, they show up as 33, and we should obey.
	type = (type < 0 ? 0 : (type > 33 ? 33 : type));
	if (type == 0) {  // empty
		return;
	} else if (type == 1) {  // full
		this.c.rect(-1,-1, 2, 2);
		return;
	} else type += 2;
	var T = Math.floor(type / 4), r = type % 4;
	if (T == 8) this.c.rotate(-r * PI/2); else this.c.scale(sx[r], sy[r]);
	
	if (T == 2 || T == 3) {  // round things
		this.c.moveTo(-1, 1);
		if (T == 2) this.c.arc( 1,-1, 2, PI/2, PI, false);
		if (T == 3) this.c.arc(-1, 1, 2,-PI/2, 0, false);
		this.c.closePath();
	} else {  // everything else
		this.poly(TILEPOLY[T]);
	}
}

NMR.prototype.drawObject = function(str) {
	var t;
	var osp = str.split('^');
	if (osp.length < 2 || isNaN(t = +osp[0]) || t < 0) return false;
	
	var params = osp[1].split(',');
	if (osp[2]) params = params.concat(osp[2].split(','));
	if (params.length < 2) return false; // we need coordinates at least
	
	// --------- coordinate correction
	
	var x = +params[0], y = +params[1];
	// this is a way to hide door without hiding switch
	// and without if () {...} madness, which we have plenty of already
	if (isNaN(x+y)) x = y = FARAWAY;
	
	if (t == 6) { // drone
		var dt = +params[4];
		if (params[4] == '' || isNaN(dt)) dt = -1; // do not default to zap
		var seeking = +params[3];
		if (seeking && dt == 1) { // seeking laser -> rotolaser
			seeking = 0;
			dt = 131;
		}
		// clamp coordinates to the grid
		x = Math.round((x - 12) / 24) * 24 + 12;
		y = Math.round((y - 12) / 24) * 24 + 12;
	}
	
	if (t == 4) { // floorguard
		var gx = Math.floor(x / 24) * 24;
		var gy = Math.floor(y / 24) * 24;
		var wtype = +params[3] || 0;
		var r = RADIUS[4];
		if (this.mods[7] && !isNaN(this.mods[7]['r'])) r = +this.mods[7]['r'];
		switch(wtype) {
			case 1: y = gy + r; break;
			case 2: x = gx + r; break;
			case 3: x = gx + 24 - r; break;
			default: y = gy + 24 - r; // normal
		}
	}
	
	if (t == 9) { // door
		var sw = 0, locked = 0, door = 1;
		if (+params[6]) {  // locked
			sw = 7.5; locked = 1;
		}
		else if (+params[3]) {  // trap
			sw = 5;	door = 0;
		}
		var r = 0;
		var sx = x, sy = y;
		x = (+params[4] + +params[7])*24 + 12;
		y = (+params[5] + +params[8])*24 + 12;
		if (isNaN(x+y)) x = y = FARAWAY;
		
		if (door) {  // door
			if (+params[2]) {  // horisontal ?
				if (+params[8]) {  // Y shift
					r = 3; y += 24;
				} else r = 1;
			} else {
				if (+params[7]) {  // X shift
					r = 2; x += 24;
				} else r = 0;
			}
			
			// dirty hacks for thin locked doors
			if (locked && r > 1 && this.tilesize == 24) {
				x -= r == 2 ? 1 : 0; y -= r == 3 ? 1 : 0;
			}
		}
	}
	
	if (osp[4]) { // custom path
		var cm = osp[4].split(',');
		if (cm[1] == 7) {  // circular motion
			var a = +cm[4] * PI * 2 / 360;
			var r = +cm[5];
			if (!isNaN(r+a)) {
				x += r * Math.cos(a);
				y += r * Math.sin(a);
			}
		}
		if (cm[1] == 8 && t != 11) {  // coordinate motion - advance 1 frame along the way
			var speed = +cm[3];
			var p = cm[0].split(':')[0].split('.');
			p[0] = +p[0]; p[1] = +p[1];
			if (!isNaN(p[0] + p[1] + speed)) {
				var d = Math.sqrt((p[0]-x)*(p[0]-x) + (p[1]-y)*(p[1]-y));
				if (d) {
					x += (p[0]-x) * speed / d;
					y += (p[1]-y) * speed / d;
				}
			}
		}
	}
	
	////////// THE CODE ABOVE THIS LINE IS SAFE
	// maybe there is a point to make it another pure function,
	// because this function is HUMONGOUS
	
	this.c.save();
	this.c.translate(this.rnd(x, 1), this.rnd(y, 1));
	
	// --------- apply mods, if any
	
	var cmods = this.mods[t == 6 ? dt : t + 3];
	var mod;
	if (cmods) {
		// icon mod
		mod = cmods['_icon'];
		if (mod) {
			if (zoomed) this.popzoom();
			this.drawImage(mod.img, mod.x, mod.y);
			this.c.translate(FARAWAY, FARAWAY);
		}
		// size mods
		mod = +cmods['r'];
		if (!isNaN(mod) && RADIUS[t]) {
			mod = +mod? +mod : 1e-3;
			this.zoom(mod/RADIUS[t]);
			var zoomed = 1;
		}
		mod = +cmods['_xscale'];
		if (!isNaN(mod)) {
			mod = +mod ? +mod : 0.1;
			this.c.scale(mod/100, 1);
		}
		mod = +cmods['_yscale'];
		if (!isNaN(mod)) {
			mod = +mod ? +mod : 0.1;
			this.c.scale(1, mod/100);
		}
		mod = +cmods['xw'];
		if (!isNaN(mod) && WIDTH[t]) this.c.scale(mod/WIDTH[t], 1);
		mod = +cmods['yw'];
		if (!isNaN(mod) && WIDTH[t]) this.c.scale(1, mod/WIDTH[t]);
		// alpha
		mod = cmods['_alpha'];
		if (!isNaN(mod)) this.c.globalAlpha = mod/100;
	}
	
	// --------- render object
	
	switch (t) {
	case 0: // gold
		this.clr(t, '#c90', '#a67c00');
		this.rect(0, 0, 6, 6, 1, 1, 1);
		this.clr(t, '#dbbd11');
		this.rect(0, 0, 3.6, 3.6, 1, 1);
		this.clr(t, '#e2e200');
		this.rect(0, 0, 1.8, 1.8, 1, 1);
		this.clr(t, '#ffc');
		this.rect(0.6, -2.1, 1.5, 1.5, 0, 1);
	break;
	case 1: // bounceblock
		this.clr(t, '#ccc', '#666');
		this.rect(0, 0, 19.2, 19.2, 1, 1, 1);
	break;
	case 2: // launchpad
		var p = [-4.35, 0, -1.8, -5.1, 1.8, -5.1, 4.8, 0, 0, -2.5, 15, 5];
		var vx = +params[2] || 0, vy = +params[3] || 0;
		var r = Math.atan2(vx, -vy);
		var nc = 1;
		if (vx == 0 || vy == 0) {
			nc = 0;
			p = rotate_pts(p, Math.round(-r * 2 / PI));
		} else {
			r = r * 2 / PI - 0.5;
			r = Math.round(r);
			r = (r + 0.5) * PI / 2;
			this.c.rotate(r);
		}
		this.clr(t, '#b0b0b9', '#4b4b54');
		this.rect(p[8], p[9], p[10], p[11], 1, 1);
		this.clr(t, '#878794');
		this.poly(p.slice(0,8), 1);
		if (nc && this.tilesize == 24) this.c.lineWidth *= 0.8;
		this.rect(p[8], p[9], p[10], p[11], 1, 0, 1, nc);
	break;
	case 3: // gauss
		this.turret(t, 5.75);
		this.clr(t, '', '#7f335a');
		if (this.tilesize == 24) this.c.lineWidth *= 1.3; // trying to compensate weird lightness
		this.circle(0, 0, 3.05, 0, 1);
	break;
	case 4: // floorguard
		switch(wtype) {
			case 1: this.c.scale(1, -1); break;
			case 2: this.c.rotate(PI/2); break;
			case 3:	this.c.rotate(-PI/2); break;
		}
		this.clr(t, '#484848', '#09c');
		this.c.beginPath();
		r = 6 - 0.21;
		this.c.lineWidth = 0.42;
		this.c.moveTo(-r, 0); this.c.lineTo(-r, r);
		this.c.lineTo( r, r); this.c.lineTo( r, 0);
		this.c.arc(0, 0.21, r, 0, PI, true);
		this.c.fill(); this.c.stroke();
		this.clr(t, '#0cf');
		this.rect(-2.4, -1.23, 1.2, 1.2, 0, 1);
		this.clr(t, '#09c');
		this.rect( 1.2, -2.55, 1.2, 1.2, 0, 1);
	break;
	case 5: // player
		this.c.lineJoin = 'bevel';
		this.clr(t, '#333', '#000');
		var g = [  // too much effort for basically nothing
			-3.247, -10.670, 0.340, -9.959, 0.093, -7.918,
			-2.969, -4.392, -3.402, -0.402, -2.165, -0.433,
			0.340, -3.588, 0.711, 0.402, 1.887, 0.124,
			-2.010, 4.021, -3.464, 9.959, -1.052, 10.052,
			1.175, 4.082, -0.093, 10.082, 2.320, 10.113,
			-0.433, -7.515, -0.711, -4.546, -0.773, -1.515];
		this.poly(g.slice( 0, 6), 1, 1); // head
		this.poly(g.slice( 6,12), 1, 1); // arms
		this.poly(g.slice(12,18), 1, 1);
		this.poly(g.slice(18,24), 1, 1); // legs
		this.poly(g.slice(24,30), 1, 1);
		this.poly(g.slice(30,36), 0, 1, 1); // body
		this.poly([g[6], g[7],  g[30],g[31], g[12],g[13]], 0, 1, 1); // arm-to-arm
		this.poly([g[18],g[19], g[34],g[35], g[24],g[25]], 0, 1, 1); // leg-to-leg
	break;
	case 6: // drone
		if (seeking) {
			this.c.beginPath();
			this.clr(dt-3, '#000', '#000');
			this.line(-6.36, -6.36, -6.36, -14.5);
			this.c.stroke();
			this.rect(-6.84, -13.64, 1.8, 1.8, 0, 1);
		}
		var bodyC = '#000', bodyF = '#79cbe3', eyeF = '#000', eye_turret = 0;
		switch (dt) {
			case 0: // zap
			break;
			case 1: // laser
				bodyF = 'rgba(0,0,0,0)';
			break;
			case 2: // chaingun
				bodyF = '#666';
				eye_turret = 1;
			break;
			case 16: // forcefield
				bodyF = '#5eb46d';
				eyeF = '#e40000';
			break;
			case 101: // ghost 1
				bodyF = '#fff';
				bodyC = eyeF = '#86341c';
			break;
			case 102: // ghost 2
				bodyF = '#fff';
				bodyC = '#86341c';
				eyeF = '#ff341c';
			break;
			case 103: // ghost 3
				bodyF = '#373737';
				eyeF = '#bd6b53';
			break;				
			case 121: // rock
				bodyF = '#373737';
			break;
			case 131: // rotolaser
				bodyF = '#333a7e';
			break;
			case 132: // circular laser
				bodyF = '#600';
				eye_turret = 1;
				var r = (params[8] && !isNaN(params[8])) ? +params[8] : 30;
				this.c.lineWidth = r / 100;
				this.clr(null, '', 'rgba(255,0,0,0.6)');
				this.circle(0, 0, r*0.985, 0, 1);
				this.clr(null, '', 'rgba(255,0,0,0.4)');
				this.circle(0, 0, r*0.955, 0, 1);
			break;
			case 141: // gold
				bodyC = eyeF = '#860100';
				bodyF = '#ffcc00';
			break;
			case 201: // text
				eyeF = 'rgba(0,0,0,0)';
				/* // TODO: figure out how the hell Flash does this
				function parse_clr(s) {
					s = parseInt(s, 16) || 0;
					s = s.toString(16);
					while (s.length < 6) s = '0'+s;
					return '#' + s;
				}
				var txt = params[6].split(':')[0];
				var dx = +params[7] || 0, dy = +params[8] || 0;
				
				var a = 'left';
				switch (+params[9]) {
					case 1: a = 'center'; break;
					case 2: a = 'right'; break;
				}
				c.textAlign = a;
				
				var font = '';
				if (+params[15]) font += 'bold ';
				if (+params[16]) font += ' italic ';
				if (+params[13]) font += params[13] + 'px ';
				font += params[14] || 'serif';
				c.font = font;
				
				c.fillStyle = parse_clr(params[11]);
				if (+params[10]) {
					c.strokeStyle = c.fillStyle;
					rect(dx, dy, c.measureText(txt).width, +params[13] || 3, 0, 1);
				}
				c.textBaseline = 'middle';
				c.fillText(txt, dx, dy, c.measureText(txt).width);
				*/
			default: // everything else - eye only. tiler (122) falls here too
				bodyC = bodyF = 'rgba(0,0,0,0)';
		}
		this.clr(dt-3, bodyF, bodyC);
		this.c.lineWidth = 1.62;
		this.regularpoly(8.19, 8, 1, 1);
		
		if (dt == 122) { // tiler's body
			this.clr(122-3, '#797988');
			this.rect(0, 0, 24, 24, 1, 1);
		}
		
		var r = +params[5];
		if (isNaN(r) || r > 2 || r < 0) r = -1;
		this.c.rotate(r * PI * 0.15);
		
		this.clr(dt-3, eyeF);
		if (eye_turret) {
			this.rect(0.95, 0, 8, 3.87, 1, 1);
		} else {
			this.circle(4.5, 0, 2.16, 1);
		}
	break;
	case 7: // one-way
		var r = +params[2];
		if (isNaN(r) || r < 0 || r > 3 || Math.floor(r) != r) r = 3;
		var p = rotate_pts([12, 12, 12, -12, 7, -7, 7, 7], r);
		this.clr(t, '#b4b7c2', '#8f94a7');
		this.c.beginPath();
		this.line(p[0], p[1], p[2], p[3]);
		this.line(p[4], p[5]);
		this.line(p[6], p[7]);
		this.c.closePath();
		this.c.fill();
		this.c.stroke();
		this.clr(t, '', '#383838');  // top side
		this.c.beginPath();
		p = rotate_pts([12, 11.5, 12, -11.5], r);
		this.line(p[0], p[1], p[2], p[3]);
		this.c.stroke();
	break;
	case 8: // thwump
		this.clr(t, '#838383', '#484848');
		this.rect(0, 0, 18, 18, 1, 1);
		var r = +params[2];
		if (isNaN(r) || r < 0 || r > 3 || Math.floor(r) != r) r = 1;
		var p = rotate_pts([7.2, -9, 7.2, 9, 9, 9, 9, -9], r);
		this.c.beginPath();
		this.line(p[0], p[1], -p[4], -p[5]);
		this.line(-p[6], -p[7]);
		this.line(p[2], p[3]);
		this.c.stroke();
		this.clr(t, '', '#00ccff');  // zappy side
		this.c.beginPath();
		this.line(p[0], p[1], p[2], p[3]);
		this.line(p[4], p[5], p[6], p[7]);
		this.c.stroke();
	break;
	case 9: // door
		var p = [10.08, 0, 1.92, 24, 10, 0, 4, 10.44];
		// dirty hacks for thin locked doors
		if (locked && r > 1 && this.tilesize == 24) p[2] = 1;
		p = rotate_pts(p, r);
		if (door) {  // door
			this.clr(t, '#797988', '#333');
			this.rect(p[0], p[1], p[2], p[3], 1, 1, 1);
			if (locked) {
				this.clr(t, '#666673', '#000');
				this.rect(p[4], p[5], p[6], p[7], 1, 1, 1);		
			}
		}
		if (sw) {  // key
			this.c.restore(); this.c.save();
			this.c.translate(this.rnd(x, 1), this.rnd(y, 1));
			this.clr(null, '#acacb5', '#5f5f6b');
			this.rect(0, 0, sw, sw, 1, 1, 1);
			this.clr(null, '#666', '#000');
			this.rect(0, -sw/8, sw/2, sw/4, 1, 1, 1, (+params[3] && this.tilesize==24) ? 1 : 0);
		}
	break;
	case 10: // rocket launcher
		this.turret(t, 5.75);
		this.clr(t, '#490024');
		this.circle(0, 0, 3.05, 1);
	break;
	case 11: // exit
		this.clr(t, '#b0b0b9', '#333');
		this.rect(0, 0, 24.36, 24, 1, 1, 1);
		this.rect(0, -12, 12.18, 24, 0, 0, 1);
		this.clr(t, '', '#ccc');
		this.rect(0, 0, 17, 17, 1, 0, 1);
		this.rect(0, -8.5, 8.5, 17, 0, 0, 1);
		// exit key
		x = +params[2]; y = +params[3];
		if (isNaN(x+y)) x = y = FARAWAY;
		this.c.restore(); this.c.save();
		this.c.translate(this.rnd(x, 1), this.rnd(y, 1));
		this.clr(null, '#b3b3bb', '#585863');
		this.rect(0, 0, 12, 7.5, 1, 1, 1);
		this.clr(null, '#b5cae1', '#34343a');
		this.rect(0, 0, 7.5, 4.5, 1, 1, 1);
		this.clr(null, '', '#6d97c3');
		this.c.beginPath();
		this.line(-3.75, -2.25, 3.75, 2.25);
		this.line(3.75, -2.25, -3.75, 2.25);
		this.c.stroke();
	break;
	case 12: // mine
		this.clr(t, '#000', '#900');
		this.c.lineCap = 'butt';
		this.c.lineWidth *= 0.9;
		this.c.translate(0, 0.22);
		this.c.scale(1, 1.05);
		this.c.beginPath();
		var p = [3.84, 3.84, 5, 4.8, 3.6, 4.08, 4.56, 4.512];
		for (var i = 0; i < 8; i += 2) {
			var a = i * PI/8;
			this.c.moveTo(p[i] * Math.cos(a), p[i] * Math.sin(a));
			this.c.lineTo(-p[i+1] * Math.cos(a), -p[i+1] * Math.sin(a));
		}
		this.c.stroke();
		this.circle(0, 0, 2.4, 1, 1);
	break;
	default: // unhandled object type
		this.c.fillStyle = 'rgba(255,255,255,0.5)';
		this.rect(0,0,18,18,1,1);
		this.c.fillStyle = '#000';
		this.c.textAlign = 'center';
		this.c.textBaseline = 'middle';
		this.c.font = '16px sans-serif';
		this.c.fillText(type,0,0);
	}
	// don't forget to pop ur zooms
	if (zoomed) this.popzoom();
	this.c.restore();
	return true;
}

NMR.prototype.drawObjectTypes = function(objects, types) {
 	objects = objects.filter(function(o) {
		return types.some(function(i) { return +o.split('^')[0] == i });
	});
	var r = 0;
	for (var i = 0, l = objects.length; i < l; i++)
		if (this.drawObject(objects[i])) r++;
	return r;
}

NMR.prototype.render = function(s, cb) {
	this.timer = new Date;
	
	if (!s) return;
	if (s[0] == '$') {
		s = s.slice(1).split('#');
		if (s.length < 4) return;
		this.title = s[0];
		this.author = s[1];
		this.type = s[2];
		this.nrt = s[4];
		s = s[3];
	}
	s = s.split('|');
	if (s.length < 2 || !s[0].length) return;
	
	var iq = [];
	
	this.bg = s[2];
	this.fg = s[3];
	iq.push([this.bg, 0]);
	iq.push([this.fg]);
	
	var ms = [];
	if (s[5]) { // object mod
		ms = ms.concat(s[5].split(';'));
	}
	if (s[6]) { // player mod, essentially the same thing
		ms = ms.concat(s[6].split(';').map(function(o) { return '8,' + o }));
	}
	for (var i = 0; i < ms.length; i++) {
		var mod = ms[i].split(',');
		if (mod.length > 2 && !isNaN(+mod[0])) {
			var id = +mod[0];
			this.mods[id] = this.mods[id] || {};
			mod[1] = mod[1].toLowerCase();
			if (mod[1] == '_icon') {
				var mi = mod[2];
				mi = mi.split('^');
				if (mi.length == 3) {
					iq.push([mi[2]]);
					mod[2] = { x: +mi[0], y: +mi[1], img: mi[2] };
				} else mod[2] = null;
			}
			this.mods[id][mod[1]] = mod[2];
		}
	}
	
	this.pending = iq.length;
	var that = this;
	for (var i = 0; i < iq.length; i++)
		this.prepImage(iq[i][0], iq[i][1], function() {that._render.apply(that, [s, cb])} );
	if (this.pending == 0) { // there were no valid images in queue
		this._render(s, cb);
	}
}

NMR.prototype._render = function(s, cb) {
	if (this.rendering) return;
	this.rendering = 1;
	
	var t = s[0];  // tiles
	var o = s[1].split('!');  // objects
	
	// paint background (walls)
	this.clr(null, '#ccc');
	this.c.fillRect(0, 0, this.ca.width, this.ca.height);
	
	this.zoom(this.aa);
		
	// paint objects
	var totalo = 0;
	this.zoom(this.tilesize / 24); // scaling object coordinates for custom tile sizes
	this.drawImage(this.bg);
	totalo += this.drawObjectTypes(o, [2,3,7,9,10,11]); // background objects - always behind
	totalo += this.drawObjectTypes(o, [0,1,4,6,8,12]); // normal objects
	totalo += this.drawObjectTypes(o, [5]); // player - always in front
	this.popzoom();
	
	// paint foreground (tiles)
	this.zoom(this.tilesize / 2);
	this.c.beginPath();
	for (var i = -1; i <= ROWS; i++) {
		for (var j = -1; j <= COLS; j++) {
			this.c.save();
			if (i==-1 || j==-1 || i==ROWS || j==COLS)
				this.addTile(j, i, 1);
			else
				this.addTile(j, i, t.charCodeAt(i + j * ROWS) - 48);
			this.c.restore();
		}
	}
	this.popzoom();
	this.clr(null, '#797988');
	this.c.fill();
	
	this.zoom(this.tilesize / 24);
	this.drawImage(this.fg);
	// put up some fancy text
	this.c.fillStyle = '#000';
	if (typeof this.title != 'undefined') {
		font.putStr(this.c, 410, 586, (this.title ? this.title : '') +
			'  ( by ' + this.author + ' )' +
			((this.type && this.type != 'none') ? '  ::  ' + this.type : '') +
			(this.nrt ? '  #  ' + this.nrt : ''));
	}
	// info
	this.c.fillStyle = 'rgba(0,0,0,0.3)';
	font.putStr(this.c, 2, 592, 'nmr v' + VERSION + '   ' +
		totalo + 'objects in ' + (new Date - this.timer) + 'ms   ' + new Date);
	this.popzoom();
	
	// back to normal
	this.popzoom();
	
	// apply antialiasing
	if (this.aa > 1) {
		this.c.drawImage(this.ca, 0, 0, this.rw, this.rh);
		var iData = this.c.getImageData(0, 0, this.rw, this.rh);
		this.ca.width = this.rw; this.ca.height = this.rh;
		this.c.putImageData(iData, 0, 0);
	}
	
	console.log('render', new Date - this.timer, 'ms');
	cb(this.ca);
}

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
				console.log('saved', where);
				callback();
			});
		});
	}
	catch (e) {
		console.log('!! failed to save', where, 'with error:', e);
		callback();
	}
}

function genThumb(srcpath, dstpath, height, callback) {
	if (!height) { callback(); return; }
	im.resize({
		srcPath: srcpath,
		dstPath: dstpath,
		width: height*2,
		height: height,
		format: 'png'
	}, function(e, stdout, stderr){
		if (e) {
			console.log('!! failed to resize', srcpath, 'error:', e);
		} else {
			console.log('T', srcpath, '-->', dstpath);
		}
		callback();
	});
}

exports.renderToFile = function(map_data, height, root, map_id, cb) {
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
		try {
			fs.statSync(fullpath);
		}
		catch (e) {
			r = new NMR();
			r.render(map_data, function(res) {
				canvasToFile(res, fullpath, function() {
					genThumb(fullpath, filepath + height + '.png', height, cb);
				});
			});
			return;
		}
		// if full is already there
		genThumb(fullpath, filepath + height + '.png', height, cb);
	}
}

