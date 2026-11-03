"""Fetch the initials lab's faces and write them as woff2 subsets.

Sources: the google/fonts repository (OFL TTFs), CTAN's fonts/initials
(Dieter Steffmann's decorative capitals, Type 1 .pfb, converted here to
CFF OpenType) and CTAN's EB Garamond Initials (Georg Duffner, drawn from
the 1592 Berner specimen) with its two fill layers. Initial faces are cut
to A-Z; EB Garamond (the body face) keeps latin and every layout feature
so the lab's small caps work. Each initial face gets its letter box
measured (median top and bottom of A-Z) and its OS/2 cap height set to
that box, so CSS initial-letter sizes the whole decorated square to the
three-line drop; Steffmann outlines are also shifted so the box sits on
the baseline. Writes dist/initials-lab/fonts/*.woff2 and manifest.json,
which scripts/initials-lab.js reads.

With --site FAMILY it builds just that face, the same way, into
fonts/web/initials-<slug>-v1.woff2: the face the site's story pages use
(style.css 'Initials'). The file is committed, so builds never fetch it.
Usage: uv run --with fonttools --with brotli python3 scripts/initials-lab-fonts.py [--site 'Zallman Caps']
"""
import json
import pathlib
import statistics
import sys
import tempfile
import urllib.request

from fontTools import subset
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.pens.transformPen import TransformPen
from fontTools.t1Lib import T1Font
from fontTools.ttLib import TTFont

GF = 'https://raw.githubusercontent.com/google/fonts/main/ofl/'
CTAN = 'https://mirrors.ctan.org/fonts/'
# Duffner's fill layers are not on CTAN; this mirror holds the 0.016 release files.
EBG_FILL = ('https://media.githubusercontent.com/media/igormorgado/dotfiles/'
            '918a35ac237b6f87894a0ce5d02829223c0d3e01/home/dot_local/share/fonts/')

# family, kind, url
INITIALS = [
    ('Zallman Caps', 'pfb', CTAN + 'initials/Zallman.pfb'),
    ('Morris Initials', 'pfb', CTAN + 'initials/MorrisIn.pfb'),
    ('Goudy Initialen', 'pfb', CTAN + 'initials/GoudyIn.pfb'),
    ('Kinigcap', 'pfb', CTAN + 'initials/Kinigcap.pfb'),
    ('Typocaps', 'pfb', CTAN + 'initials/Typocaps.pfb'),
    ('Eileen Caps', 'pfb', CTAN + 'initials/Eileen.pfb'),
    ('Eileen Caps Black', 'pfb', CTAN + 'initials/EileenBl.pfb'),
    ('Elzevier Caps', 'pfb', CTAN + 'initials/Elzevier.pfb'),
    ('Romantik', 'pfb', CTAN + 'initials/Romantik.pfb'),
    ('Royal Initialen', 'pfb', CTAN + 'initials/RoyalIn.pfb'),
    ('Acorn Initials', 'pfb', CTAN + 'initials/Acorn.pfb'),
    ('Carrick Caps', 'pfb', CTAN + 'initials/Carrickc.pfb'),
    ('Ann Stone', 'pfb', CTAN + 'initials/AnnSton.pfb'),
    ('Rothenburg Decorative', 'pfb', CTAN + 'initials/Rothdn.pfb'),
    ('Gotische Initialen', 'pfb', CTAN + 'initials/GotIn.pfb'),
    ('Sanremo', 'pfb', CTAN + 'initials/Sanremo.pfb'),
    ('Eichenlaub Initialen', 'pfb', CTAN + 'initials/Eichenla.pfb'),
    ('Cinzel Decorative', 'ttf', GF + 'cinzeldecorative/CinzelDecorative-Regular.ttf'),
    ('UnifrakturMaguntia', 'ttf', GF + 'unifrakturmaguntia/UnifrakturMaguntia-Book.ttf'),
    ('Kalnia Glaze', 'ttf', GF + 'kalniaglaze/KalniaGlaze%5Bwdth,wght%5D.ttf'),
    ('Jacques Francois Shadow', 'ttf', GF + 'jacquesfrancoisshadow/JacquesFrancoisShadow-Regular.ttf'),
    ('Monsieur La Doulaise', 'ttf', GF + 'monsieurladoulaise/MonsieurLaDoulaise-Regular.ttf'),
    ('IM FELL French Canon SC', 'ttf', GF + 'imfellfrenchcanonsc/IMFeFCsc28P.ttf'),
    ('Moirai One', 'ttf', GF + 'moiraione/MoiraiOne-Regular.ttf'),
    ('EB Garamond Initials', 'otf', CTAN + 'ebgaramond/opentype/EBGaramond-Initials.otf'),
    ('EB Garamond Initials Fill1', 'otf', EBG_FILL + 'ebgaramond-initialsf1.otf'),
    ('EB Garamond Initials Fill2', 'otf', EBG_FILL + 'ebgaramond-initialsf2.otf'),
]
BODY = [
    ('EB Garamond', 'normal', '400 800', GF + 'ebgaramond/EBGaramond%5Bwght%5D.ttf'),
    ('EB Garamond', 'italic', '400 800', GF + 'ebgaramond/EBGaramond-Italic%5Bwght%5D.ttf'),
]
CAPS = 'U+0041-005A'
LATIN = ('U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,'
         'U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2212,U+2215,U+FEFF,U+FFFD')

OUT = pathlib.Path(__file__).resolve().parent.parent / 'dist' / 'initials-lab' / 'fonts'
SITE = pathlib.Path(__file__).resolve().parent.parent / 'fonts' / 'web'


def slug(s):
    return s.lower().replace(' ', '-')


def box(glyphset, names):
    """Median top and bottom of the given glyphs' ink, in font units."""
    tops, bottoms = [], []
    for n in names:
        if n not in glyphset:
            continue
        bp = BoundsPen(glyphset)
        glyphset[n].draw(bp)
        if bp.bounds:
            bottoms.append(bp.bounds[1])
            tops.append(bp.bounds[3])
    return statistics.median(tops), statistics.median(bottoms)


def pfb_to_otf(src, dst, family, blank=()):
    """Type 1 -> CFF OpenType, A-Z only, ink box shifted onto the baseline.
    Code points in `blank` map to one empty glyph of zero width."""
    t1 = T1Font(str(src), encoding='latin-1')
    t1.parse()
    gs = t1.getGlyphSet()
    letters = [c for c in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' if c in gs]
    top, bottom = box(gs, letters)
    shift = -bottom
    upm = round(1 / t1.font['FontMatrix'][0])
    order = ['.notdef', 'space'] + letters + (['blank'] if blank else [])
    charstrings, metrics = {}, {}
    for n in order:
        if n in ('space', 'blank'):
            width = upm // 4 if n == 'space' else 0
            pen = T2CharStringPen(width, None)
            charstrings[n], metrics[n] = pen.getCharString(), (width, 0)
            continue
        g = gs[n] if n in gs else None
        if g is not None:
            g.draw(BoundsPen(gs))  # executing the charstring sets its width
        width = round(g.width) if g is not None else upm // 2
        pen = T2CharStringPen(width, None)
        if g is not None:
            g.draw(TransformPen(pen, (1, 0, 0, 1, 0, shift)))
        charstrings[n] = pen.getCharString()
        bp = BoundsPen(None)
        if g is not None:
            g.draw(TransformPen(bp, (1, 0, 0, 1, 0, shift)))
        metrics[n] = (width, round(bp.bounds[0]) if bp.bounds else 0)
    cap = round(top - bottom)
    fb = FontBuilder(upm, isTTF=False)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap({ord(c): c for c in letters} | {32: 'space'} | {cp: 'blank' for cp in blank})
    ps = family.replace(' ', '')
    fb.setupCFF(ps, {'FullName': family}, charstrings, {})
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=cap + upm // 10, descent=-upm // 5)
    fb.setupNameTable({'familyName': family, 'styleName': 'Regular'})
    fb.setupOS2(sTypoAscender=cap + upm // 10, sTypoDescender=-upm // 5, usWinAscent=cap + upm // 10,
                usWinDescent=upm // 5, sCapHeight=cap, sxHeight=cap // 2, version=4)
    fb.setupPost()
    fb.save(str(dst))
    return {'top': 1.0, 'bottom': 0.0}


def set_cap_box(path):
    """Set OS/2 cap height to the median A-Z ink top so initial-letter sizes the
    whole letter. Returns the ink box as fractions of the cap height."""
    f = TTFont(path)
    gs = f.getGlyphSet()
    cmap = f.getBestCmap()
    names = [cmap[ord(c)] for c in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' if ord(c) in cmap]
    top, bottom = box(gs, names)
    f['OS/2'].sCapHeight = round(top)
    if f['OS/2'].version < 2:
        f['OS/2'].version = 2
    f.save(path)
    return {'top': 1.0, 'bottom': round(bottom / top, 3)}


def woff2(src, dst, unicodes):
    opts = subset.Options()
    opts.layout_features = ['*']
    opts.flavor = 'woff2'
    opts.name_IDs = ['*']
    opts.notdef_outline = True
    font = TTFont(src)
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=subset.parse_unicodes(unicodes))
    sub.subset(font)
    font.flavor = 'woff2'
    font.save(dst)


def build_initial(family, kind, url, tmp, dst, blank=()):
    """Download one initial face, give it its letter box, cut it to A-Z."""
    raw = tmp / f'{slug(family)}.{kind}'
    raw.write_bytes(urllib.request.urlopen(url, timeout=60).read())
    if kind == 'pfb':
        otf = tmp / f'{slug(family)}.otf'
        ink = pfb_to_otf(raw, otf, family, blank)
        raw = otf
    else:
        ink = set_cap_box(str(raw))
    woff2(str(raw), str(dst), ','.join([CAPS] + [f'U+{cp:04X}' for cp in blank]))
    return ink


# Opening quotes that build.js (markOpening) leaves in front of an initial.
# They fall inside ::first-letter, so the site face draws them as nothing;
# CSS hangs a visible quote in the margin instead, and the text keeps its
# quote for copying, Reader view and screen readers.
OPEN_QUOTES = (0x201C, 0x2018)


def site(family):
    kind, url = next((k, u) for f, k, u in INITIALS if f == family)
    if kind != 'pfb':
        raise SystemExit(f'{family}: blank opening quotes are only built for Type 1 faces; add them for {kind} first')
    dst = SITE / f'initials-{slug(family)}-v1.woff2'
    with tempfile.TemporaryDirectory() as tmp:
        build_initial(family, kind, url, pathlib.Path(tmp), dst, OPEN_QUOTES)
    cap = TTFont(dst)
    cmap = cap.getBestCmap()
    missing = [f'U+{cp:04X}' for cp in OPEN_QUOTES if cmap.get(cp) != 'blank']
    if missing or cap['hmtx']['blank'][0] != 0:
        raise SystemExit(f'{dst.name}: opening quotes not blank: {missing}')
    print(f'{dst.name} {dst.stat().st_size} B; upm {cap["head"].unitsPerEm}, cap height {cap["OS/2"].sCapHeight}')


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob('*.woff2'):
        old.unlink()
    manifest = []
    with tempfile.TemporaryDirectory() as tmp:
        tmp = pathlib.Path(tmp)
        for family, kind, url in INITIALS:
            name = f'{slug(family)}.woff2'
            ink = build_initial(family, kind, url, tmp, OUT / name)
            letters = ''.join(c for c in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' if ord(c) in TTFont(OUT / name).getBestCmap())
            manifest.append({'family': family, 'file': name, 'style': 'normal', 'weight': '400',
                             'source': url, 'bytes': (OUT / name).stat().st_size, 'letters': letters, 'ink': ink})
            print(f'{name:40} {manifest[-1]["bytes"]:>7} B  {len(letters)} letters')
        for family, style, weight, url in BODY:
            raw = tmp / f'{slug(family)}-{style}.ttf'
            raw.write_bytes(urllib.request.urlopen(url, timeout=60).read())
            name = f'{slug(family)}-{style}.woff2'
            woff2(str(raw), str(OUT / name), LATIN)
            manifest.append({'family': family, 'file': name, 'style': style, 'weight': weight,
                             'source': url, 'bytes': (OUT / name).stat().st_size, 'body': True})
            print(f'{name:40} {manifest[-1]["bytes"]:>7} B')
    (OUT / 'manifest.json').write_text(json.dumps(manifest, indent=1))


if __name__ == '__main__':
    if sys.argv[1:2] == ['--site']:
        site(sys.argv[2])
    else:
        main()
