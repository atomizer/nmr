var Canvas = require('canvas'), Image = Canvas.Image, font = new Image(), fbitmap = [];

font.onload = function() {
	var ca = new Canvas(font.width, font.height);
	var c = ca.getContext('2d');
	c.drawImage(font, 0, 0);
	var d = c.getImageData(0, 0, ca.width, ca.height).data;
	for (var i = 32; i < 128; i++) fbitmap[i] = [];
	for (var i = 0, j = 0, l = d.length; j < l; i++, j+=4) {
		var k = 32 + Math.floor(i / 1024) * 16 + Math.floor((i % 128) / 8); // char code index
		var p = 8 * (i % 8) + Math.floor(i / 128) % 8; // pixel index == x * 8 + y
		fbitmap[k][p] = d[j]>0 ? 0 : 1;
	}
}

font.src = './font.png'

exports.putStr = function(c, x, y, s) {
	if (!fbitmap[0]) return;
	c.save();
	c.translate(x, y);
	c.beginPath();
	for (var si = cx = lx = 0, l = s.length; si < l; si++) {
		var cc = s.charCodeAt(si);
		if (cc < 33 || cc > 126) {
			cx += 3;
			continue;
		}
		for (var p = pd = 0; p < 8; p++, pd += 8) {
			for (var q = 0; q < 8; q++) {
				if (fbitmap[cc][pd + q]) {
					c.rect(cx + p, q, 1, 1);
					lx = p;
				}
			}
		}
		cx += lx + 2;
	}
	c.fill();
	c.restore();
}

