"""Writes favicon.svg: "TB" in the name's face (Send Flowers, as in the
story nav's home link), in the accent red on the page's paper colour, with
the dark theme's values under prefers-color-scheme: dark.

    node build.js   # first: writes dist/fonts/author-monoton.woff2
    uv run --with fonttools --with brotli python3 scripts/favicon.py

The glyphs are outlines, so the icon needs no font. Colours are style.css's
--accent and --paper (light, dark), converted from OKLCH; change them here
if they change there. build.js inlines the result as the page icon.
"""
import math
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
FONT = ROOT / "dist/fonts/author-monoton.woff2"
OUT = ROOT / "favicon.svg"
TEXT = "TB"
ACCENT = ((0.52, 0.22, 24), (0.80, 0.11, 24))
PAPER = ((0.99, 0.006, 85), (0.18, 0.006, 85))


def oklch_hex(l, c, h):
    a, b = c * math.cos(math.radians(h)), c * math.sin(math.radians(h))
    l_, m_, s_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3, (l - 0.1055613458 * a - 0.0638541728 * b) ** 3, (l - 0.0894841775 * a - 1.2914855480 * b) ** 3
    rgb = (4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
           -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
           -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_)
    enc = lambda v: 12.92 * v if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055
    return "#" + "".join(f"{round(min(1, max(0, enc(v))) * 255):02x}" for v in rgb)


font = TTFont(FONT)
gs, cmap = font.getGlyphSet(), font.getBestCmap()
names = [cmap[ord(ch)] for ch in TEXT]
# Lay the glyphs out by advance, y up; collect bounds and one path.
bounds, pen, x = BoundsPen(gs), SVGPathPen(gs), 0
for n in names:
    gs[n].draw(TransformPen(bounds, (1, 0, 0, 1, x, 0)))
    gs[n].draw(TransformPen(pen, (1, 0, 0, 1, x, 0)))
    x += font["hmtx"][n][0]
x0, y0, x1, y1 = bounds.bounds
# Fit into a 100-unit square with 12 units of padding, flipping y. A
# 45-unit stroke in the glyphs' colour thickens the script's hairlines so
# the letters survive at 16 px.
k = 76 / max(x1 - x0, y1 - y0)
tx, ty = 50 - k * (x0 + x1) / 2, 50 + k * (y0 + y1) / 2
light, dark = [(oklch_hex(*ACCENT[i]), oklch_hex(*PAPER[i])) for i in (0, 1)]
svg = (f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>"
       f"<style>rect{{fill:{light[1]}}}path{{fill:{light[0]};stroke:{light[0]};stroke-width:45;stroke-linejoin:round}}"
       f"@media(prefers-color-scheme:dark){{rect{{fill:{dark[1]}}}path{{fill:{dark[0]};stroke:{dark[0]}}}}}</style>"
       f"<rect width='100' height='100' rx='18'/>"
       f"<path transform='matrix({k:.5f} 0 0 {-k:.5f} {tx:.2f} {ty:.2f})' d='{pen.getCommands()}'/></svg>\n")
OUT.write_text(svg)
print(f"wrote {OUT.name}: {len(svg)} bytes, accent {light[0]}/{dark[0]}, paper {light[1]}/{dark[1]}")
