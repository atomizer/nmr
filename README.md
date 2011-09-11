### Userscript

On Firefox, install GreaseMonkey or Scriptish first. On Chrome and Opera it should go as-is.

http://nmr.no.de/nmr.user.js

After installing, check out [this page](http://www.nmaps.net/browse?q=nreality%20rated&random=1&count=20).

### URL format

* full view: `http://nmr.no.de/[numa map id]`

  example: http://nmr.no.de/136604

* thumbnail: `http://nmr.no.de/thumb/[numa map id]`

  example: http://nmr.no.de/thumb/136604

* anything else: `http://nmr.no.de/[numa map id]-[height in pixels]`

  height guide: thumb = 100, full = 600, max = 2400

  example: http://nmr.no.de/136604-2400

### Not implemented (todo)

* Rendering custom (non-NUMA) maps.

* Text drone. I can't figure out how to mimic Flash behaviour in this case -
the coordinates and font size are way off. Please, drop me a pm if you know wtf is going on there.

* Weird color mods, like drones and doors in map 206465.
I don't understand why they work as they do, clamping to black after some constant intensity doesn't help.

* Some blend modes, because they are not among native cairo composite operators
and because I couldn't find a map which renders wrong because of this.
