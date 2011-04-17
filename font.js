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

// font.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAAAwCAIAAABWluX'+
// 'pAAACpUlEQVR42u1by4LEIAjj/3/avc5DMQmgdlZP3c6WquERwFpbMsxssfDSN2ZOXlsY9ZO9jK7'+
// 'wj0e+/9nZUGej/Uc2wva29iwA7H3gS3I2GpEjAKBJK7JXS/QbU2xwjEf/H99lR1G69x3h1DxHU7J'+
// 'EYKdzQrwK6HmeaAH99VZbwAgVJAaAmlgdA4I6Prl/WdDmybc79u3+BeCMPGDko6csIuLrnaBNyXd'+
// 'Yk8BS4nbgxIDhJNMZCMLlZR4i5A3BnI6is9MldBRLmKimuSMLoCiQYAERI9CedTCLWkCEGkYsBrk'+
// 'TyT+03RQsAI0BkUwSqoHwPp3NnFn113K6aGZ+ecjiStwF4KDdvwAcnAdk8XGE7bD5QYTmRuhsnP7'+
// '2FyULzbpew6BAACgu/k0uX/8E96FvBAJ/ZzdIyKipebIA4FSwvZdUv987uj8EIG5iKy0gRX7cAvx'+
// 'r1FU2oAcb4e9CDHB0NiUGTDWdtfhQDLg8ZD8LuuMCcEQixrYeswrdlp4HsCyFuv64EORQsae6s2/'+
// 'VrIatYrIANPc4TMsokbJ9ArZ4Z6UsaAEAKWkdq0BZ5SOL8FxN3xG6hvD0qQW01LMnLGZRABLzg8a'+
// 'fgPM7Ski679zRMucWbuzoLOgpJ41PZkFD4C8BvXnAv88/2AfkN1W8Iou/7zqwPmHKLNeMH5wSimg'+
// 'pSanWD+iSAn9/UBeUXrbF5fgaGpxP4z88Adf1IQGd514AIgtOB8DPP1YDMK0F7XJBpRZQBwDtgk6'+
// 'mDdsl/FMamhtsLwCPMa/SL3Bs16oe5NxKUwRjg6pfesSDtsxqoqzDLacnAoN/ZpvG04XGRRyANjv'+
// 'lIPQnIj8pDZksft2AEx8nAFBxKG+1C8KTgKZ9NsX3A1J62nsA+I0QWlfaq2VBPwxA1smR0vEHWdp'+
// '73gBSZjkAAAAASUVORK5CYII=';
font.src = './font.png'

exports.putStr = function(c, x, y, s) {
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

