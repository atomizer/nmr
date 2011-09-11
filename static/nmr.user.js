// ==UserScript==
// @name           nmr thumbs
// @namespace      http://nmr.no.de/
// @description    replaces numa thumbnails with nmr-generated ones.
// @include        http://www.nmaps.net/*
// @include        http://numa-notdot-net.appspot.com/*
// @include        http://forum.ninjarobotyeti.com/*
// ==/UserScript==

// removing the default functions
unsafeWindow.larger = function(){};
unsafeWindow.smaller = function(){};

var oldre = /static.notdot.net\/numa\/(thumbs|full)\/(\d+)$/;

function toggleThumb(img) {
	var t = !img.thumb;
	img.src = 'http://nmr.no.de/' + (t ? 'thumb/' : '') + img.map_id;
	var h = t ? 100 : 600, w = h * 1.32;
	img.style.width = w + 'px';
	img.style.height = h + 'px';
	img.thumb = +t;
}

for (var k = 0; k < document.images.length; k++) {
	var img = document.images[k];
	var m = oldre.exec(img.src);
	if (!m) continue;
	img.onmouseover = img.onmouseout = '';
	img.style.cursor = 'all-scroll';
	img.addEventListener('click', function(e) {
		e.stopPropagation();
		e.preventDefault();
		toggleThumb(this);
	}, true);
	img.map_id = m[2];
	img.thumb = m[1] === 'full';
	toggleThumb(img);
}
