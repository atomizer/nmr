var VERSION = '018n';

var fs = require('fs'),
	path = require('path'),
	request = require('request'),
	Canvas = require('canvas'),
	Image = Canvas.Image;

var font = require('./font');

var PI = Math.PI;
var FARAWAY = -1e4;
var COLS = 31, ROWS = 23;
// gold = 0
// bounceblock = 1
// launchpad = 2
// turret = 3
// floorguard = 4
// player = 5
// drone = 6
// onewayplatform = 7
// thwump = 8
// testdoor = 9
// hominglauncher = 10
// exit = 11
// mine = 12
// initial radius (if applicable)
var RADIUS = { 0: 6.0, 2: 6.0, 4: 6.0, 5: 10.0, 6: 9.0, 11: 12.0, 12: 4.0 };
// initial xw, yw (if applicable)
var WIDTH = { 1: 9.6, 7: 12, 8: 9 };
// initial _xscale, _yscale
var SCALE = [6, 19.2, 15, 12, 12, 20, 18, 24, 18, 24, 12, 24, 8];
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
		tr[i] = +tr[i] || 0;
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
// ============= nmr constructor

exports.NMR = function(options) {

var self = this;

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
this.c = this.ca.getContext('2d');
this.c.lineCap = 'square';
this.c.antialias = 'gray';
this.c.patternQuality = 'best';

// ========================================================
// ============= zooming

this.zoom = function(factor) {
	self.zooms.push(self.cz);
	self.c.save();
	self.c.scale(factor, factor);
	self.cz *= factor;
	self.c.lineWidth = self.printable ? 1 : self.aa/self.cz;
}

this.popzoom = function() {
	if (!self.zooms.length) return 1;
	self.c.restore();
	var pz = self.cz;
	self.cz = self.zooms.pop();
	return pz;
}

// ========================================================
// ============= drawing

this.rnd = function(x, cross) {
	// round to the pixel's center
	var mul = self.cz / self.aa;
	if (self.printable) {
		lw = (self.tilesize / 24) % 2; // projected line width
		if (lw > 1) lw -= 2;
		if (lw <= 0.5 && lw > -0.5) cross = 1;
	}
	return (Math.floor(x * mul) + (cross ? 0 : 0.5)) / mul;
}

this.clr = function(type, fill, stroke) {
	// set stroke and fill colors in one line, applying transformation if necessary
	var t;
	if (type != null && self.mods[type+3] && (t = self.mods[type+3]['_color'])) {
		if (fill && fill != 'transparent') {
			self.c.fillStyle = fill;
			fill = clrTrans(self.c.fillStyle, t);
		}
		if (stroke && stroke != 'transparent') {
			self.c.strokeStyle = stroke;
			stroke = clrTrans(self.c.strokeStyle, t);
		}
	}
	if (fill) self.c.fillStyle = fill;
	if (stroke) self.c.strokeStyle = stroke;
}

this.line = function(x1, y1, x2, y2) {
	// sharp 1px line
	if (!isNaN(x2 + y2)) {
		self.c.moveTo(self.rnd(x1), self.rnd(y1));
		self.c.lineTo(self.rnd(x2), self.rnd(y2));
	} else {
		self.c.lineTo(self.rnd(x1), self.rnd(y1));
	}
}

this.rect = function(x, y, w, h, centered, fill, stroke, noclip) {
	if (centered) { x = x - w / 2; y = y - h / 2; }
	if (fill || stroke) self.c.beginPath();
	self.c.rect(x, y, w, h);
	if (fill) self.c.fill();
	if (stroke) {
		self.c.beginPath();
		self.line(x, y, x+w, y);
		self.line(x+w, y+h);
		self.line(x, y+h);
		self.c.closePath();
		self.c.stroke();
	}
}

this.circle = function(x, y, r, fill, stroke) {
	if (fill || stroke) self.c.beginPath();
	self.c.arc(x, y, r, 0, PI*2, false);
	if (fill) self.c.fill();
	if (stroke) self.c.stroke();
}

this.poly = function(a, fill, stroke, noclose) {
	// polygon from array [x1, y1, x2, y2, ...]
	if (!a || a.length < 4) return;
	if (fill || stroke) self.c.beginPath();
	self.c.moveTo(a[0], a[1]);
	for (var i = 2, l = a.length; i < l; i += 2) {
		self.c.lineTo(a[i], a[i+1]);
	}
	if (!noclose) self.c.closePath();
	if (fill) self.c.fill();
	if (stroke) self.c.stroke();
}

this.regularpoly = function(r, n, fill, stroke) {
	// regular polygon
	// used only for drones - do we really need it?
	if (fill || stroke) self.c.beginPath();
	var a = PI*2 / n;
	var R = r / Math.cos(a/2);
	self.c.save();
	self.c.rotate(-a/2);
	self.c.moveTo(R, 0);
	for (var i = 0; i < n - 1; i++) {
		self.c.rotate(a);
		self.c.lineTo(R, 0);
	}
	self.c.closePath();
	self.c.restore();
	if (fill) self.c.fill();
	if (stroke) self.c.stroke();
}

this.turret = function(type, r) {
	// 4 arcs around gauss & rocket
	self.clr(type, '', '#000');
	for (var i = 0; i < 6; i += PI/2) {
		self.c.beginPath();
		self.c.arc(0, 0, r, i + 0.2, PI/2 + i - 0.2, false);
		self.c.stroke();
	}
}

// ========================================================
// ============= handling external images

this.prepImage = function(urlf, blend, cb) {
	var m, url;
	var url_re = /^(http:\/\/.+\.(gif|jpg|png))(?:\?(.+))?$/i;
	
	if (!urlf || self.images[urlf] || !(m = urlf.match(url_re)) || !(url = m[1])) {
		if (--self.pending == 0) cb();
		return;
	}
	self.images[urlf] = {};
	blend = blend || +m[3] || 0;
	
	if (!cb) cb = function(){ console.log('!! generic callback on prepImage') };
	
	request({uri: url, encoding: 'binary'}, function(e, res, body) {
		if (e || res.statusCode != 200) {
			if (--self.pending == 0) cb();
			return;
		}
		var img = new Image();
		img.src = new Buffer(body, 'binary');
		self.images[urlf] = { data: img, blend: blend };
		if (--self.pending == 0) cb();
	});
}

var blend_to_composite = ['over', 'over', 'over', 'multiply', 'screen',
	'ligther', 'darker', 'difference', 'add', 'substract',
	'invert', 'alpha', 'erase', 'overlay', 'hard-light']
	// TODO: implement add,substract,alpha,erase

this.drawImage = function(isrc, x, y) {
	var i = self.images[isrc];
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
			self.c.globalCompositeOperation = 'difference';
			self.c.drawImage(ca, x, y);
		break;
		default:
			self.c.globalCompositeOperation = blend_to_composite[i.blend];
			self.c.drawImage(i.data, x, y);
		}
		self.c.globalCompositeOperation = 'over';
	}
	catch (e) {
		console.log('!! drawImage', isrc, ':', e.message);
	}
}

// ========================================================
// ============= serious stuff

this.addTile = function(x, y, type) {
	var sx = [1,-1,-1, 1], sy = [1, 1,-1,-1];
	self.c.translate(x * 2 + 3, y * 2 + 3);
	// clamp type to [0..33], like n does.
	// though tiles > 33 behave oddly, they show up as 33, and we should obey.
	type = (type < 0 ? 0 : (type > 33 ? 33 : type));
	if (type == 0) {  // empty
		return;
	} else if (type == 1) {  // full
		self.c.rect(-1,-1, 2, 2);
		return;
	} else type += 2;
	var T = Math.floor(type / 4), r = type % 4;
	if (T == 8) self.c.rotate(-r * PI/2); else self.c.scale(sx[r], sy[r]);
	
	if (T == 2 || T == 3) {  // round things
		self.c.moveTo(-1, 1);
		if (T == 2) self.c.arc( 1,-1, 2, PI/2, PI, false);
		if (T == 3) self.c.arc(-1, 1, 2,-PI/2, 0, false);
		self.c.closePath();
	} else {  // everything else
		self.poly(TILEPOLY[T]);
	}
}

this.drawObject = function(str) {
	var t;
	var osp = str.split('^');
	if (osp.length < 2 || isNaN(t = +osp[0])) return false;
	if (t == -7) return true; // dupe stub
	
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
		// clamp coordinates to the grid
		x = Math.round((x - 12) / 24) * 24 + 12;
		y = Math.round((y - 12) / 24) * 24 + 12;
	}
	
	if (t == 4) { // floorguard
		var gx = Math.floor(x / 24) * 24;
		var gy = Math.floor(y / 24) * 24;
		var wtype = +params[3] || 0;
		var r = RADIUS[4];
		if (self.mods[7] && !isNaN(self.mods[7]['r'])) r = +self.mods[7]['r'];
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
			if (locked) {
				x -= +(r == 2);
				y -= +(r == 3);
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
	
	self.c.save();
	self.c.translate(self.rnd(x, 1), self.rnd(y, 1));
	
	// --------- apply mods, if any
	
	var cmods = self.mods[t == 6 ? dt : t + 3];
	var mod;
	if (cmods) {
		// alpha
		mod = cmods['_alpha'];
		if (!isNaN(mod)) {
			if (dt && dt > 100 && dt < 104) mod = 100; // ghosts are not affected
			self.c.globalAlpha = mod/100;
		}
		// icon mod
		mod = cmods['_icon'];
		if (mod) {
			self.drawImage(mod.img, mod.x, mod.y);
			self.c.translate(FARAWAY, FARAWAY);
		}
		// size mods
		var xscale, yscale;
		mod = +cmods['_xscale'];
		if (!isNaN(mod)) {
			xscale = mod/SCALE[t];
		}
		mod = +cmods['_yscale'];
		if (!isNaN(mod)) {
			yscale = mod/SCALE[t];
		}
		mod = +cmods['r'];
		if (!isNaN(mod) && RADIUS[t] && dt != 122) {
			if (isNaN(xscale)) xscale = mod/RADIUS[t];
			if (isNaN(yscale)) yscale = mod/RADIUS[t];
		}
		mod = +cmods['xw'];
		if (!isNaN(mod) && WIDTH[t] && isNaN(xscale)) xscale = mod/WIDTH[t];
		mod = +cmods['yw'];
		if (!isNaN(mod) && WIDTH[t] && isNaN(yscale)) yscale = mod/WIDTH[t];
		if (isNaN(xscale)) xscale = 1;
		if (isNaN(yscale)) yscale = 1;
		if (xscale == 0) xscale = 0.01;
		if (yscale == 0) yscale = 0.01;
		if (xscale != 1 || yscale != 1) {
			if (xscale == yscale) {
				var zoomed = 1;
				self.zoom(xscale);
			} else self.c.scale(xscale, yscale);
		}
	}
	
	// --------- render object
	
	switch (t) {
	case 0: // gold
		self.clr(t, '#c90', '#a67c00');
		self.rect(0, 0, 6, 6, 1, 1, 1);
		self.clr(t, '#dbbd11');
		self.rect(0, 0, 3.6, 3.6, 1, 1);
		self.clr(t, '#e2e200');
		self.rect(0, 0, 1.8, 1.8, 1, 1);
		self.clr(t, '#ffc');
		self.rect(0.6, -2.1, 1.5, 1.5, 0, 1);
	break;
	case 1: // bounceblock
		self.clr(t, '#ccc', '#666');
		self.rect(0, 0, 19.2, 19.2, 1, 1, 1);
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
			self.c.rotate(r);
		}
		self.clr(t, '#b0b0b9', '#4b4b54');
		self.rect(p[8], p[9], p[10], p[11], 1, 1);
		self.clr(t, '#878794');
		self.poly(p.slice(0,8), 1);
		if (nc && self.tilesize == 24) self.c.lineWidth *= 0.8;
		self.rect(p[8], p[9], p[10], p[11], 1, 0, 1, nc);
	break;
	case 3: // gauss
		self.turret(t, 5.75);
		self.clr(t, '', '#7f335a');
		if (self.tilesize == 24) self.c.lineWidth *= 1.3; // trying to compensate weird lightness
		self.circle(0, 0, 3.05, 0, 1);
	break;
	case 4: // floorguard
		switch(wtype) {
			case 1: self.c.scale(1, -1); break;
			case 2: self.c.rotate(PI/2); break;
			case 3:	self.c.rotate(-PI/2); break;
		}
		self.clr(t, '#484848', '#09c');
		self.c.beginPath();
		r = 6 - 0.21;
		self.c.lineWidth = 0.42;
		self.c.moveTo(-r, 0); self.c.lineTo(-r, r);
		self.c.lineTo( r, r); self.c.lineTo( r, 0);
		self.c.arc(0, 0.21, r, 0, PI, true);
		self.c.fill(); self.c.stroke();
		self.clr(t, '#0cf');
		self.rect(-2.4, -1.23, 1.2, 1.2, 0, 1);
		self.clr(t, '#09c');
		self.rect( 1.2, -2.55, 1.2, 1.2, 0, 1);
	break;
	case 5: // player
		self.c.lineJoin = 'bevel';
		self.clr(t, '#333', '#000');
		var g = [  // too much effort for basically nothing
			-3.247, -10.670, 0.340, -9.959, 0.093, -7.918,
			-2.969, -4.392, -3.402, -0.402, -2.165, -0.433,
			0.340, -3.588, 0.711, 0.402, 1.887, 0.124,
			-2.010, 4.021, -3.464, 9.959, -1.052, 10.052,
			1.175, 4.082, -0.093, 10.082, 2.320, 10.113,
			-0.433, -7.515, -0.711, -4.546, -0.773, -1.515];
		self.poly(g.slice( 0, 6), 1, 1); // head
		self.poly(g.slice( 6,12), 1, 1); // arms
		self.poly(g.slice(12,18), 1, 1);
		self.poly(g.slice(18,24), 1, 1); // legs
		self.poly(g.slice(24,30), 1, 1);
		self.poly(g.slice(30,36), 0, 1, 1); // body
		self.poly([g[6], g[7],  g[30],g[31], g[12],g[13]], 0, 1, 1); // arm-to-arm
		self.poly([g[18],g[19], g[34],g[35], g[24],g[25]], 0, 1, 1); // leg-to-leg
	break;
	case 6: // drone
		var bodyC = '#000', bodyF = '#79cbe3', eyeF = '#000', eye_turret = 0;
		switch (dt) {
			case 0: // zap
			break;
			case 1: // laser
				bodyF = 'transparent';
				if (seeking) { // seeking laser -> rotolaser
					bodyF = '#333a7e';
					seeking = 0;
				}
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
				self.c.lineWidth = r / 100;
				self.clr(null, '', 'rgba(255,0,0,0.6)');
				self.circle(0, 0, r*0.985, 0, 1);
				self.clr(null, '', 'rgba(255,0,0,0.4)');
				self.circle(0, 0, r*0.955, 0, 1);
			break;
			case 141: // gold
				bodyC = eyeF = '#860100';
				bodyF = '#ffcc00';
			break;
			case 201: // text
				eyeF = 'transparent';
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
				bodyC = bodyF = 'transparent';
		}
		// antenna
		if (seeking) {
			self.c.beginPath();
			self.clr(dt-3, bodyC, bodyC);
			self.line(-6.36, -6.36, -6.36, -14.5);
			self.c.stroke();
			self.rect(-6.84, -13.64, 1.8, 1.8, 0, 1);
		}
		self.clr(dt-3, bodyF, bodyC);
		self.c.lineWidth = 1.62;
		self.regularpoly(8.19, 8, 1, 1);
		
		if (dt == 122) { // tiler's body
			self.clr(122-3, '#797988');
			self.rect(0, 0, 24, 24, 1, 1);
		}
		
		var r = +params[5];
		if (isNaN(r) || r > 2 || r < 0) r = -1;
		if (dt == 132) r = 0;
		self.c.rotate(r * PI * 0.15);
		
		self.clr(dt-3, eyeF);
		if (eye_turret) {
			self.rect(0.95, 0, 8, 3.87, 1, 1);
		} else {
			self.circle(4.5, 0, 2.16, 1);
		}
	break;
	case 7: // one-way
		self.c.lineJoin = 'bevel';
		var r = +params[2];
		if (isNaN(r) || r < 0 || r > 3 || Math.floor(r) != r) r = 3;
		var p = rotate_pts([12, 12, 12, -12, 7, -7, 7, 7], r);
		self.clr(t, '#b4b7c2', '#8f94a7');
		self.c.beginPath();
		self.line(p[0], p[1], p[2], p[3]);
		self.line(p[4], p[5]);
		self.line(p[6], p[7]);
		self.c.closePath();
		self.c.fill();
		self.c.stroke();
		self.clr(t, '', '#383838');  // top side
		self.c.beginPath();
		p = rotate_pts([12, 11.5, 12, -11.5], r);
		self.line(p[0], p[1], p[2], p[3]);
		self.c.stroke();
	break;
	case 8: // thwump
		self.clr(t, '#838383', '#484848');
		self.rect(0, 0, 18, 18, 1, 1);
		var r = +params[2];
		if (isNaN(r) || r < 0 || r > 3 || Math.floor(r) != r) r = 1;
		var p = rotate_pts([7.2, -9, 7.2, 9, 9, 9, 9, -9], r);
		self.c.beginPath();
		self.line(p[0], p[1], -p[4], -p[5]);
		self.line(-p[6], -p[7]);
		self.line(p[2], p[3]);
		self.c.stroke();
		self.clr(t, '', '#00ccff');  // zappy side
		self.c.beginPath();
		self.line(p[0], p[1], p[2], p[3]);
		self.line(p[4], p[5], p[6], p[7]);
		self.c.stroke();
	break;
	case 9: // door
		var p = [10.08, 0, 1.92, 24, 10, 0, 4, 10.44];
		// dirty hacks for thin locked doors
		if (locked && r > 1 && self.tilesize == 24) p[2] = 1;
		p = rotate_pts(p, r);
		if (door) {  // door
			self.clr(t, '#797988', '#333');
			self.rect(p[0], p[1], p[2], p[3], 1, 1, 1);
			if (locked) {
				self.clr(t, '#666673', '#000');
				self.rect(p[4], p[5], p[6], p[7], 1, 1, 1);		
			}
		}
		if (sw) {  // key
			self.c.lineJoin = 'bevel';
			if (zoomed) { self.popzoom(); zoomed = 0; }
			self.c.restore(); self.c.save();
			self.c.translate(self.rnd(sx, 1), self.rnd(sy, 1));
			self.clr(null, '#acacb5', '#5f5f6b');
			self.rect(0, 0, sw, sw, 1, 1, 1);
			self.clr(null, '#666', '#000');
			self.rect(0, -sw/8, sw/2, sw/4, 1, 1, 1, (+params[3] && self.tilesize==24) ? 1 : 0);
		}
	break;
	case 10: // rocket launcher
		self.turret(t, 5.75);
		self.clr(t, '#490024');
		self.circle(0, 0, 3.05, 1);
	break;
	case 11: // exit
		self.clr(t, '#b0b0b9', '#333');
		self.rect(0, 0, 24.36, 24, 1, 1, 1);
		self.rect(0, -12, 12.18, 24, 0, 0, 1);
		self.clr(t, '', '#ccc');
		self.rect(0, 0, 17, 17, 1, 0, 1);
		self.rect(0, -8.5, 8.5, 17, 0, 0, 1);
		// exit key
		x = +params[2]; y = +params[3];
		if (isNaN(x+y)) x = y = FARAWAY;
		if (zoomed) { self.popzoom(); zoomed = 0; }
		self.c.restore(); self.c.save();
		self.c.translate(self.rnd(x, 1), self.rnd(y, 1));
		self.clr(null, '#b3b3bb', '#585863');
		self.rect(0, 0, 12, 7.5, 1, 1, 1);
		self.clr(null, '#b5cae1', '#34343a');
		self.rect(0, 0, 7.5, 4.5, 1, 1, 1);
		self.clr(null, '', '#6d97c3');
		self.c.beginPath();
		self.line(-3.75, -2.25, 3.75, 2.25);
		self.line(3.75, -2.25, -3.75, 2.25);
		self.c.stroke();
	break;
	case 12: // mine
		self.clr(t, '#000', '#900');
		self.c.lineCap = 'butt';
		self.c.lineWidth *= 0.9;
		self.c.translate(0, 0.22);
		self.c.scale(1, 1.05);
		self.c.beginPath();
		var p = [3.84, 3.84, 5, 4.8, 3.6, 4.08, 4.56, 4.512];
		for (var i = 0; i < 8; i += 2) {
			var a = i * PI/8;
			self.c.moveTo(p[i] * Math.cos(a), p[i] * Math.sin(a));
			self.c.lineTo(-p[i+1] * Math.cos(a), -p[i+1] * Math.sin(a));
		}
		self.c.stroke();
		self.circle(0, 0, 2.4, 1, 1);
	break;
	}
	if (zoomed) self.popzoom();
	self.c.restore();
	return true;
}

this.drawObjectTypes = function(objects, types) {
 	objects = objects.filter(function(o) {
		return types.some(function(i) { return +o.split('^')[0] == i });
	});
	var r = 0;
	for (var i = 0, l = objects.length; i < l; i++)
		if (self.drawObject(objects[i])) r++;
	return r;
}

this.render = function(s, cb) {
	if (!s) return;
	if (s[0] == '$') {
		s = s.slice(1).split('#');
		if (s.length < 4) return;
		self.title = s[0];
		self.author = s[1];
		self.type = s[2];
		s = s[3];
	}
	s = s.split('|');
	if (s.length < 2 || !s[0].length) return;
	
	var iq = [];
	
	self.bg = s[2];
	self.fg = s[3];
	iq.push([self.bg, 0]);
	iq.push([self.fg]);
	self.nrt = s[4];
	
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
			self.mods[id] = self.mods[id] || {};
			mod[1] = mod[1].toLowerCase();
			if (mod[1] == '_icon') {
				var mi = mod[2];
				mi = mi.split('^');
				if (mi.length == 3) {
					iq.push([mi[2]]);
					mod[2] = { x: +mi[0], y: +mi[1], img: mi[2] };
				} else mod[2] = null;
			}
			self.mods[id][mod[1]] = mod[2];
		}
	}
	
	self.pending = iq.length;
	for (var i = 0; i < iq.length; i++)
		self.prepImage(iq[i][0], iq[i][1], function() {self._render(s, cb)} );
	if (self.pending == 0) { // there were no valid images in queue
		self._render(s, cb);
	}
}

this._render = function(s, cb) {
	if (self.rendering) return;
	self.rendering = 1;
	
	console.time('render');
	var timer = new Date;

	var t = s[0];  // tiles
	var o = s[1].split('!');  // objects
	
	// elliminate double-placed objects (slow!)
	// all the dupes will be counted properly
	var STUB = '-7^', oi;
	for (var i = o.length-1; i > 0; i--) {
		if ((oi = o[i]) == STUB) continue;
		for (var j = 0; j < i; j++) {
			if (oi == o[j]) o[j] = STUB;
		}
	}
	
	// paint background (walls)
	self.clr(null, '#ccc');
	self.c.fillRect(0, 0, self.ca.width, self.ca.height);
	
	self.zoom(self.aa);
		
	// paint objects
	var totalo = 0;
	self.zoom(self.tilesize / 24); // scaling object coordinates for custom tile sizes
	self.drawImage(self.bg);
	totalo += self.drawObjectTypes(o, [2,3,7,9,10,11]); // background objects - always behind
	totalo += self.drawObjectTypes(o, [0,1,4,6,8,12]); // normal objects
	totalo += self.drawObjectTypes(o, [5]); // player - always in front
	self.popzoom();
	
	// paint foreground (tiles)
	self.zoom(self.tilesize / 2);
	self.c.beginPath();
	for (var i = -1; i <= ROWS; i++) {
		for (var j = -1; j <= COLS; j++) {
			self.c.save();
			if (i==-1 || j==-1 || i==ROWS || j==COLS)
				self.addTile(j, i, 1);
			else
				self.addTile(j, i, t.charCodeAt(i + j * ROWS) - 48);
			self.c.restore();
		}
	}
	self.popzoom();
	self.clr(null, '#797988');
	self.c.fill();
	
	self.zoom(self.tilesize / 24);
	self.drawImage(self.fg);
	// put up some fancy text
	self.c.fillStyle = '#000';
	if (typeof self.title != 'undefined') {
		font.putStr(self.c, 410, 586, (self.title ? self.title : '') +
			'  ( by ' + self.author + ' )' +
			((self.type && self.type != 'none') ? '  ::  ' + self.type : '') +
			(self.nrt ? '  #  ' + self.nrt : ''));
	}
	// info
	self.c.fillStyle = 'rgba(0,0,0,0.3)';
	font.putStr(self.c, 2, 592, 'nmr v' + VERSION + '   ' +
		totalo + ' objects in ' + (new Date - timer) + 'ms @ ' + new Date);
	self.popzoom();
	
	// back to normal
	self.popzoom();
	
	// apply antialiasing
	if (self.aa > 1) {
		self.c.drawImage(self.ca, 0, 0, self.rw, self.rh);
		var iData = self.c.getImageData(0, 0, self.rw, self.rh);
		self.ca.width = self.rw; self.ca.height = self.rh;
		self.c.putImageData(iData, 0, 0);
	}
	
	console.timeEnd('render');
	cb(self.ca);
}

// return { render: self.render };

// end of nmr
}

