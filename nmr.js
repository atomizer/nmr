var fs = require('fs')
var path = require('path')
var Canvas = require('canvas')
Image = Canvas.Image;

var im = require('imagemagick')

var font = require('./font');

var _copy = 'nmr v1.3n';
var COLS = 31, ROWS = 23;
var tilesize = 24;
var aa = 2; // antialiasing multiplier
var printable = 0; // always 1px lines or not

var ca,c;

var cz; // current zoom (for size mods); x_real = x / cz
var zooms;


/****************
helper functions
****************/

function zoom(factor) {
	zooms.push(cz);
	c.save();
	c.scale(factor, factor);
	cz *= factor;
	c.lineWidth = aa/cz;
}

function popzoom() {
	if (zooms.length) {
		c.restore();
		cz = zooms.pop();
	}
}

// 4-way rotation
function rotate_pts(a, dir) {
	var ra = [];
	dir = (dir > 3 ? dir - 4 : (dir < 0 ? dir + 4 : dir));
	for (var i = 0, l = a.length; i < l; i += 2) {
		ra[i]   = dir % 2 ? a[i+1] : a[i];
		ra[i+1] = dir % 2 ? a[i] : a[i+1];
		if (dir > 1) {
			ra[i] = -ra[i]; ra[i+1] = -ra[i+1];
		}
	}
	return ra;
}
// rounding to the pixel's center, Flash way
function rnd(x, cross) {
	var mul = cz/aa;
	return (Math.floor(x * mul) + (cross ? 0 : 0.5)) / mul;
}
// (hopefully) crisp 1px line
function line(x1, y1, x2, y2) {
	if (!isNaN(x2 + y2)) {
		c.moveTo(rnd(x1), rnd(y1));
		c.lineTo(rnd(x2), rnd(y2));
	} else {
		c.lineTo(rnd(x1), rnd(y1));
	}
}

function rect(x, y, w, h, centered, fill, stroke, noclip) {
	if (centered) { x = x-w/2; y = y-h/2; }
	if (fill || stroke) c.beginPath();
	// c.rect(x, y, w, h);
	c.moveTo(x, y);
	c.lineTo(x + w, y);
	c.lineTo(x + w, y + h);
	c.lineTo(x + 0.001, y + h);
	c.closePath();
	if (fill) c.fill();
	if (stroke) {
		if (!noclip) {
			c.beginPath();
			line(x, y, x+w, y);
			line(x+w, y+h);
			line(x, y+h);
			c.closePath();
		}
		c.stroke();
	}
}

function circle(x, y, r, fill, stroke) {
	if (fill || stroke) c.beginPath();
	c.arc(x, y, r, 0, Math.PI*2, false);
	if (fill) c.fill();
	if (stroke) c.stroke();
}

function poly(a, fill, stroke, noclose) {
	if (fill || stroke) c.beginPath();
	c.moveTo(a[0], a[1]);
	for (var i = 2; i < a.length; i += 2) c.lineTo(a[i], a[i+1]);
	if (!noclose) c.closePath();
	if (fill) c.fill();
	if (stroke) c.stroke();
}
// right polygon, used only for drones - do we need it?
function polyg(x, y, r, n, fill, stroke) {
	if (fill || stroke) c.beginPath();
	var a = Math.PI * 2 / n;
	var R = r / Math.cos(a/2);
	c.save();
	c.translate(x, y);
	c.rotate(-a/2);
	c.moveTo(R, 0);
	for (var i=0; i<n-1; i++) {
		c.rotate(a);
		c.lineTo(R, 0);
	}
	c.restore();
	c.closePath();
	if (fill) c.fill();
	if (stroke) c.stroke();
}
// draws 4 arcs, used for gauss & rocket
function turret(t, r) {
	clr(t, '', '#000');
	for (var i=0; i<6; i+=Math.PI/2) {
		c.beginPath();
		c.arc(0, 0, r, i + 0.2, Math.PI/2 + i - 0.2, false);
		c.stroke();
	}
}
// colorTransform, canvas way
function clrTrans(color, tr) {
	tr = tr.split('.');
	if (tr.length < 8) return color;
	for (var i = 0; i < 8; i++) {
		tr[i] = +tr[i];
		if (isNaN(tr[i])) return color;
	}
	var c = [];
	// step 1: deserialization
	if (color[0] == '#') { // "#aabbcc"
		c[3] = 1;
		for (var i = 0; i < 3; i++) c[i] = +('0x' + color.substr(i*2+1, 2));
	}
	else { // "rgba(r,g,b,a)"
		c = color.match(/\((.+)\)/)[1].split(',');
		for (var i = 0; i < 4; i++) c[i] = +c[i];
	}
	// step 2: transformation
	for (var i = 0; i < 3; i++) {
		c[i] = c[i] * (+tr[i*2] / 100) + (+tr[i*2+1]);
	}
	c[3] = c[3] * (+tr[6] / 100) + (+tr[7] / 255);
	// step 3: serialization
	var s = 'rgba(';
	for (var i=0; i<3; i++) s += Math.round(c[i]) + ', ';
	s += c[3] + ')';
	return s;
}
// set colors
function clr(type, fill, stroke) {
	var t;
	if (type != null && mods[type+3] && (t = mods[type+3]['_color'])) {
		if (fill) fill = clrTrans(fill, t);
		if (stroke) stroke = clrTrans(stroke, t);
	}
	if (fill) c.fillStyle = fill;
	if (stroke) c.strokeStyle = stroke;
}

var img_loading = 0;

function prepImage(url, filter) {
	var img, m;
	var url_re = /^(http:\/\/.+\.(?:gif|jpg|png))(?:\?(\d+))?$/;
	if (!url || !(m = url.match(url_re))) return null;
	url = m[1];
	if (typeof filter == 'undefined') filter = +m[2] || 0;
	console.log('image required:', url, filter ? (', filter #'+filter) : '');
	
	// here we should set img to an instance of Canvas
	
	return null; // on fail
	return {i: img, filter: filter, src: url};
}

function prepIcon(s) {
	s = s.split('^');
	if (s.length > 2) {
		var img = prepImage(s[2]);
		if (img) return { x: +s[0], y: +s[1], img: img };
	}
	return null;
}

function drawImage(i, x, y) {
	if (!i) return;
	x = x || 0; y = y || 0;
	try {
		// filter here!!!
		c.drawImage(i.img, x, y);
	}
	catch (e) {
		console.log('error while drawing:', e.message);
	}
}

/****************
end of helpers
****************/

var TILEPOLY = [[],
	[-1,-1, 1, 1, 1,-1],
	[], [],
	[-1,-1, 1,-1, 1, 1,-1, 0],
	[-1,-1, 1,-1, 1, 0],
	[-1,-1, 1,-1, 1, 1, 0, 1],
	[ 0,-1, 1,-1, 1, 1],
	[-1,-1, 1,-1, 1, 0,-1, 0]];

function addTile(c, type) {
	var sx = [1,-1,-1, 1], sy = [1, 1,-1,-1];
	// clamp type to [0..33], like n does.
	// though tiles > 33 behave oddly, they show up as 33, and we should obey.
	type = (type < 0 ? 0 : (type > 33 ? 33 : type));
	if (type == 0) {  // empty
		c.rect(-1,-1, 2, 2);
		return true;
	} else if (type == 1) {  // full
		return true;
	} else type += 2;
	var T = Math.floor(type / 4), r = type % 4;
	if (T == 8) c.rotate(-r * Math.PI/2); else c.scale(sx[r], sy[r]);
	
	if (T == 2 || T == 3) {  // round things
		c.moveTo(1,-1);
		if (T == 2) c.arc( 1,-1, 2, Math.PI/2, Math.PI, false);
		if (T == 3) c.arc(-1, 1, 2,-Math.PI/2, 0, false);
		c.closePath();
	} else {  // everything else
		poly(TILEPOLY[T]);
	}
	return true;
}

function drawObject(str) {
	var rads = { 0: 6.0, 2: 6.0, 4: 6.0, 5: 10.0, 6: 9.0, 11: 12.0, 12: 4.0 };
	var widths = { 1: 9.6, 8: 9.0 };
	
	var t, params;
	var osp = str.split('^');
	if (osp.length < 2 || isNaN(t = +osp[0]) || t < 0) return;
	
	params = osp[1].split(',');
	if (osp[2]) params = params.concat(osp[2].split(','));
	if (params.length < 2) return; // we need coordinates, i guess
	
	var x = +params[0], y = +params[1];
	if (isNaN(x) || isNaN(y)) return;
	
	if (t == 6) {
		if (params[4] == '') params[4] = -1;
		if (+params[3] && +params[4] == 1) { // seeking laser -> rotolaser
			params[3] = 0;
			params[4] = 131;
		}
		var dt = +params[4];
		x = Math.round((x-12)/24)*24+12;
		y = Math.round((y-12)/24)*24+12;
	}
	
	if (osp[4]) { // custom path
		var cm = osp[4].split(',');
		if (cm[1] == 7) {  // circular motion
			var a = +cm[4] * Math.PI * 2 / 360;
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
			if (!isNaN(p[0]+p[1])) {
				var d = Math.sqrt((p[0]-x)*(p[0]-x) + (p[1]-y)*(p[1]-y));
				if (d) {
					x += (p[0]-x) * speed / d;
					y += (p[1]-y) * speed / d;
				}
			}
		}
	}
	
	c.save();
	c.translate(rnd(x, 1), rnd(y, 1));
	
	var radius = rads[t];
	
	// size mods
	var mt = (t == 6 ? dt : t + 3);  // unified object type index
	if (mods[mt]) {
		var mod = +mods[mt]['r'];
		if (radius && !isNaN(mod)) {
			zoom(mod/radius);
			var zoomed = 1;
		}
		mod = +mods[mt]['_xscale'];
		if (!isNaN(mod)) c.scale(mod/100, 1);
		mod = +mods[mt]['_yscale'];
		if (!isNaN(mod)) c.scale(1, mod/100);
		
		mod = +mods[mt]['xw'];
		if (!isNaN(mod) && widths[t]) c.scale(mod/widths[t], 1);
		mod = +mods[mt]['yw'];
		if (!isNaN(mod) && widths[t]) c.scale(1, mod/widths[t]);
		
		mod = mods[mt]['_icon'];
		if (typeof mod != 'undefined') {
			mods[mt]['_color'] = '0.255.0.0.0.255.0.100'; // '0.0.0.0.0.0.0.0'; // ROFL WTF
			if (mod) drawImage(mod.img, mod.x, mod.y);
		}
	}
	
	if (printable) c.lineWidth = 1;
	
	switch (t) {
	case 0: // gold
		clr(t, '#c90', '#a67c00');
		rect(0, 0, 6, 6, 1, 1, 1);
		clr(t, '#dbbd11');
		rect(0, 0, 3.6, 3.6, 1, 1);
		clr(t, '#e2e200');
		rect(0, 0, 1.8, 1.8, 1, 1);
		clr(t, '#ffc');
		rect(0.6, -2.1, 1.5, 1.5, 0, 1);
	break;
	case 1: // bounceblock
		clr(t, '#ccc', '#666');
		rect(0, 0, 19.2, 19.2, 1, 1, 1);
	break;
	case 2: // launchpad
		var p = [-4.35, 0, -1.8, -5.1, 1.8, -5.1, 4.8, 0, 0, -2.5, 15, 5];
		var vx = +params[2], vy = +params[3], r = Math.atan2(vx, -vy);
		var nc = 1;
		if (vx == 0 || vy == 0) {
			nc = 0;
			p = rotate_pts(p, Math.round(-r * 2 / Math.PI));
		} else {
			r = r * 2 / Math.PI - 0.5;
			r = Math.round(r);
			r = (r + 0.5) * Math.PI / 2;
			c.rotate(r);
		}
		clr(t, '#b0b0b9', '#4b4b54');
		rect(p[8], p[9], p[10], p[11], 1, 1);
		clr(t, '#878794');
		poly(p.slice(0,8), 1);
		if (nc) c.lineWidth *= 0.8;
		rect(p[8], p[9], p[10], p[11], 1, 0, 1, nc);
	break;
	case 3: // gauss
		turret(t, 5.75);
		clr(t, '', '#7f335a');
		c.lineWidth *= 1.3; // trying to compensate lightness
		circle(0, 0, 3.05, 0, 1);
	break;
	case 4: // floorguard
		c.translate(-rnd(x, 1), -rnd(y, 1));
		var gx = Math.floor(x/24)*24;
		var gy = Math.floor(y/24)*24;
		var wtype = +(params[3] || 0);
		switch(wtype) {
			case 0:	y = gy + 24 - radius; break;
			case 1: y = gy + radius; break;
			case 2: x = gx + radius; break;
			case 3:	x = gx + 24 - radius; break;
		}
		c.translate(rnd(x, 1), rnd(y, 1));
		switch(wtype) {
			case 1: c.scale(1, -1); break;
			case 2: c.rotate(Math.PI/2); break;
			case 3:	c.rotate(-Math.PI/2); break;
		}
		clr(t, '#484848', '#09c');
		c.beginPath();
		var r = 6 - 0.21;
		c.lineWidth = 0.42;
		c.moveTo(-r, 0); c.lineTo(-r, r);
		c.lineTo( r, r); c.lineTo( r, 0);
		c.arc(0, 0.21, r, 0, Math.PI, true);
		c.fill(); c.stroke();
		clr(t, '#0cf');	rect(-2.4, -1.23, 1.2, 1.2, 0, 1);
		clr(t, '#09c');	rect( 1.2, -2.55, 1.2, 1.2, 0, 1);
	break;
	case 5: // player
		c.lineJoin = 'bevel';
		clr(t, '#333', '#000');
		var g = [  // too much effort for basically nothing
			-3.247, -10.670, 0.340, -9.959, 0.093, -7.918,
			-2.969, -4.392, -3.402, -0.402, -2.165, -0.433,
			0.340, -3.588, 0.711, 0.402, 1.887, 0.124,
			-2.010, 4.021, -3.464, 9.959, -1.052, 10.052,
			1.175, 4.082, -0.093, 10.082, 2.320, 10.113,
			-0.433, -7.515, -0.711, -4.546, -0.773, -1.515];
		poly(g.slice( 0, 6), 1, 1); // head
		poly(g.slice( 6,12), 1, 1); // arms
		poly(g.slice(12,18), 1, 1);
		poly(g.slice(18,24), 1, 1); // legs
		poly(g.slice(24,30), 1, 1);
		poly(g.slice(30,36), 0, 1, 1); // body
		poly([g[6], g[7],  g[30],g[31], g[12],g[13]], 0, 1, 1); // arm-to-arm
		poly([g[18],g[19], g[34],g[35], g[24],g[25]], 0, 1, 1); // leg-to-leg
	break;
	case 6: // drone
		if (+params[3]) { // seeking
			c.beginPath();
			clr(dt-3, '#000', '#000');
			line(-6.36, -6.36, -6.36, -14.5);
			c.stroke();
			rect(-6.84, -13.64, 1.8, 1.8, 0, 1);
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
				var r = params[8] ? +params[8] : 30;
				c.lineWidth = r / 100;
				clr(null, '', 'rgba(255,0,0,0.6)');
				circle(0, 0, r*0.985, 0, 1);
				clr(null, '', 'rgba(255,0,0,0.4)');
				circle(0, 0, r*0.955, 0, 1);
			break;
			case 141: // gold
				bodyC = eyeF = '#860100';
				bodyF = '#ffcc00';
			break;
			case 201: // text
				eyeF = 'rgba(0,0,0,0)';
				/*
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
		clr(dt-3, bodyF, bodyC);
		c.lineWidth = 1.62;
		polyg(0, 0, 8.19, 8, 1, 1);
		
		if (+params[4] == 122) { // tiler's body
			clr(122-3, '#797988');
			rect(0, 0, 24, 24, 1, 1);
		}
		
		var r = +params[5];
		if (isNaN(r) || r > 2 || r < 0) r = -1;
		c.rotate(r * Math.PI * 0.15);
		
		clr(dt-3, eyeF);
		if (eye_turret) {
			rect(0.95, 0, 8, 3.87, 1, 1);
		} else {
			circle(4.5, 0, 2.16, 1);
		}
	break;
	case 7: // one-way
		var r = +params[2];
		var p = rotate_pts([12, 12, 12, -12, 7, -7, 7, 7], r);
		clr(t, '#b4b7c2', '#8f94a7');
		c.beginPath();
		line(p[0], p[1], p[2], p[3]);
		line(p[4], p[5]);
		line(p[6], p[7]);
		c.closePath();
		c.fill(); c.stroke();
		clr(t, '', '#383838');  // top side
		c.beginPath();
		var p = rotate_pts([12, 11.5, 12, -11.5], r);
		line(p[0], p[1], p[2], p[3]);
		c.stroke();
	break;
	case 8: // thwump
		clr(t, '#838383', '#484848');
		rect(0, 0, 18, 18, 1, 1);
		var p = rotate_pts([7.2, -9, 7.2, 9, 9, 9, 9, -9], +params[2]);
		c.beginPath();
		line(p[0], p[1], -p[4], -p[5]);
		line(-p[6], -p[7]);
		line(p[2], p[3]);
		c.stroke();
		clr(t, '', '#00ccff');  // zappy side
		c.beginPath();
		line(p[0], p[1], p[2], p[3]);
		line(p[4], p[5], p[6], p[7]);
		c.stroke();
	break;
	case 9: // door
		var sw = 0, l = 0, d = 1;
		if (+params[6]) {  // locked
			sw = 7.5; l = 1;
		}
		else if (+params[3]) {  // trap
			sw = 5;	d = 0;
		}
		var r = 0,
			dx = (+params[4] + +params[7])*24 + 12,
			dy = (+params[5] + +params[8])*24 + 12;
		
		if (+params[2]) {  // horisontal ?
			if (+params[8]) {  // Y shift
				r = 3; dy += 24;
			} else r = 1;
		} else {
			if (+params[7]) {  // X shift
				r = 2; dx += 24;
			} else r = 0;
		}
		
		p = [10.08, 0, 1.92, 24, 10, 0, 4, 10.44];
		// dirty hacks for thin locked doors
		if (+params[6] && r>1 && tilesize==24) {
			p[2] = 1; dx-=(r==2?1:0); dy-=(r==3?1:0);
		}
		p = rotate_pts(p, r);
		
		c.restore();
		c.save();
		c.translate(rnd(dx, 1), rnd(dy, 1));
		if (d) {  // door
			clr(t, '#797988', '#333');
			rect(p[0], p[1], p[2], p[3], 1, 1, 1);
		}
		if (l) {  // lock
			clr(t, '#666673', '#000');
			rect(p[4], p[5], p[6], p[7], 1, 1, 1);		
		}
		c.restore();
		c.save();
		c.translate(rnd(x, 1), rnd(y, 1));
		
		if (sw) {  // key
			clr(null, '#acacb5', '#5f5f6b');
			rect(0, 0, sw, sw, 1, 1, 1);
			clr(null, '#666', '#000');
			rect(0, -sw/8, sw/2, sw/4, 1, 1, 1, (+params[3] && tilesize==24) ? 1: 0);
		}
	break;
	case 10: // rocket launcher
		turret(t, 5.75);
		clr(t, '#490024');
		circle(0, 0, 3.05, 1);
	break;
	case 11: // exit
		clr(t, '#b0b0b9', '#333');
		rect(0, 0, 24.36, 24, 1, 1, 1);
		rect(0, -12, 12.18, 24, 0, 0, 1);
		clr(t, '', '#ccc');
		rect(0, 0, 17, 17, 1, 0, 1);
		rect(0, -8.5, 8.5, 17, 0, 0, 1);
		c.translate(+params[2] - x, +params[3] - y); // exit key
		clr(null, '#b3b3bb', '#585863');
		rect(0, 0, 12, 7.5, 1, 1, 1);
		clr(null, '#b5cae1', '#34343a');
		rect(0, 0, 7.5, 4.5, 1, 1, 1);
		clr(null, '', '#6d97c3');
		c.beginPath();
		line(-3.75, -2.25, 3.75, 2.25);
		line(3.75, -2.25, -3.75, 2.25);
		c.stroke();
	break;
	case 12: // mine
		clr(t, '#000', '#900');
		c.lineCap = 'butt';
		c.lineWidth *= 0.9;
		c.translate(0, 0.22);
		c.scale(1, 1.05);
		c.beginPath();
		var p = [3.84, 3.84, 5, 4.8, 3.6, 4.08, 4.56, 4.512];
		for (var i = 0; i < 8; i += 2) {
			var a = i * Math.PI/8, sina = Math.sin(a), cosa = Math.cos(a);
			//line(-p[i] * Math.cos(a), -p[i] * Math.sin(a), p[i+1] * Math.cos(a), p[i+1] * Math.sin(a));
			c.moveTo(p[i] * cosa, p[i] * sina);
			c.lineTo(-p[i+1] * cosa, -p[i+1] * sina);
		}
		c.stroke();
		circle(0, 0, 2.4, 1, 1);
	break;
	default: // unhandled object type
		c.fillStyle = 'rgba(255,255,255,0.5)';
		rect(c,0,0,18,18,1,1);
		c.fillStyle = '#000';
		c.textAlign = 'center';
		c.textBaseline = 'middle';
		c.font = '15px sans-serif';
		c.fillText(type,0,0);
	}
	if (zoomed) popzoom();
	c.restore();
	return true;
}

function drawObjectTypes(objects, types) {
 	objects = objects.filter(function(o) {
		return types.some(function(i) { return +o.split('^')[0] == i });
	});
	var r = 0;
	for (var i = 0, l = objects.length; i < l; i++)
		if (drawObject(objects[i])) r++;
	return r;
}

var mods;

function drawMap(s, options, callback) {
	var timer = new Date;
	
	if (!s) return;
	if (s[0] == '$') {
		s = s.slice(1).split('#');
		if (s.length < 4) return;
		var title = s[0];
		var author = s[1];
		var type = s[2];
		s = s[3];
	}
	s = s.split('|');
	if (s.length < 2 || !s[0].length) return;
	
	var t = s[0];  // tiles
	var o = s[1].split('!');  // objects
	
	var bg = prepImage(s[2], 0);
	var fg = prepImage(s[3]);
	
	mods = {};
	var ms = [];
	if (s[5]) {
		ms = ms.concat(s[5].split(';'));
	}
	if (s[6]) {
		ms = ms.concat(s[6].split(';').map(function(s) { return '8,' + s }));
	}
	for (var i = 0; i < ms.length; i++) {
		var mod = ms[i].split(',');
		if (mod.length > 2 && !isNaN(+mod[0])) {
			var id = +mod[0];
			mods[id] = mods[id] || {};
			if (mod[1].match(/^_icon2?$/)) mod[2] = prepIcon(mod[2]);
			mods[id][mod[1]] = mod[2];
		}
	}
	
	// SPLIT AND WAIT FOR IMAGES TO LOAD HERE
	
	options = options || {};
	tilesize = +options['tilesize'] || 24;
	printable = options['printable'] ? 1 : 0;
	
	ca = new Canvas();
	c = ca.getContext('2d');
	
	var rw = (COLS + 2) * tilesize;  // real dimensions
	var rh = (ROWS + 2) * tilesize;
	var cw = rw * aa, ch = rh * aa;  // canvas dimensions
	
	ca.width = cw;
	ca.height = ch;
	
	c.lineCap = 'square';
	c.antialias = 'gray';
	c.patternQuality = 'best';
	c.save();
	
	// paint foreground (tiles)
	clr(null, '#797988');
	c.fillRect(0, 0, cw, ch);
	
	cz = 1;
	zooms = [];
	
	zoom(aa);
	c.lineWidth = 1;
	
	// clip tiles
	c.save();
	c.beginPath();
	c.scale(tilesize/2, tilesize/2);
	for (var i = 0; i < ROWS * COLS; i++) {
		c.save();
		c.translate(Math.floor(i / ROWS) * 2 + 3, (i % ROWS) * 2 + 3);
		addTile(c, t.charCodeAt(i) - 48);
		c.restore();
	}
	c.restore();
	c.clip();
	
	// paint background (walls)
	clr(null, '#ccc');
	c.fillRect(0, 0, cw, ch);
	drawImage(bg);
		
	// paint objects
	c.save();
	var to = 0;
	zoom(tilesize/24); // scaling object coordinates for custom tile sizes
	to += drawObjectTypes(o, [2,3,7,9,10,11]); // background objects - always behind
	to += drawObjectTypes(o, [0,1,4,6,8,12]); // normal objects
	to += drawObjectTypes(o, [5]); // player - always in front
	popzoom();
	c.restore();
	
	drawImage(fg);
	
	// back to normal
	popzoom();
	c.restore();
	
	// put up some fancy text
	zoom(aa*tilesize/24);
	c.fillStyle = '#000';
	if (typeof title != 'undefined') {
		font.putStr(c, 410, 586, (title ? title : '') +
			'  ( by ' + author + ' )' +
			((type && type != 'none') ? '  ::  ' + type : '') +
			(s[4] ? '  ::  ' + s[4] : ''));
	}
	c.fillStyle = 'rgba(0,0,0,0.3)';
	font.putStr(c, 2, 592, _copy + '  ' + to + 'objects  ' + (new Date - timer) + 'ms  ' + new Date);
	popzoom();
	
	// apply antialiasing
	/**/
	if (aa > 1) {
		c.drawImage(ca, 0, 0, rw, rh);
		var iData = c.getImageData(0, 0, rw, rh);
		ca.width = rw; ca.height = rh;
		c.putImageData(iData, 0, 0);
	}
	/**/
	
	console.log('rendered in', new Date - timer);
	
	callback(ca);
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
	return function() {
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
				console.log('resized', srcpath, 'to', dstpath);
			}
			callback();
		});
	}
}

exports.renderToFile = function(map_data, height, root, map_id, cb) {
	var ops = {};
	var th = 0;
	var filepath = path.join(root, map_id + '-');
	var fullpath = filepath + '600.png';
	
	if (height > 600) { // hi-res
		ops.tilesize = Math.round(height / 600 * 24);
		ops.printable = true;
		drawMap(map_data, ops, function(res) {
			canvasToFile(res, filepath + height + '.png', cb);
		});
	} else { // consider generating thumbnail
		th = height < 600 ? height : 100;
		drawMap(map_data, {}, function(res) {
			canvasToFile(res, fullpath, genThumb(fullpath, filepath + th + '.png', th, cb));
		});
	}
}

