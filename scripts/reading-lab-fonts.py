"""Fetch the reading lab's faces as full-featured latin woff2 subsets.

Google Fonts' css2 files drop OpenType features such as smcp (small caps)
and onum (old-style figures), so the lab's small-caps lead-in and old-style
figures would be faked or ignored. This pulls the full TTFs from the
google/fonts repository instead and subsets them to latin keeping every
layout feature. Writes dist/reading-lab/fonts/*.woff2 and manifest.json,
which scripts/reading-lab.js reads.
Usage: uv run --with fonttools --with brotli python3 scripts/reading-lab-fonts.py
"""
import json
import pathlib
import tempfile
import urllib.parse
import urllib.request

from fontTools import subset
from fontTools.ttLib import TTFont

RAW = 'https://raw.githubusercontent.com/google/fonts/main/ofl/'
# family, style, weight range, repo path
FACES = [
    ('EB Garamond', 'normal', '400 800', 'ebgaramond/EBGaramond[wght].ttf'),
    ('EB Garamond', 'italic', '400 800', 'ebgaramond/EBGaramond-Italic[wght].ttf'),
    ('Literata', 'normal', '200 900', 'literata/Literata[opsz,wght].ttf'),
    ('Literata', 'italic', '200 900', 'literata/Literata-Italic[opsz,wght].ttf'),
    ('Alegreya Sans', 'normal', '400', 'alegreyasans/AlegreyaSans-Regular.ttf'),
    ('Alegreya Sans', 'italic', '400', 'alegreyasans/AlegreyaSans-Italic.ttf'),
    ('Alegreya Sans', 'normal', '500', 'alegreyasans/AlegreyaSans-Medium.ttf'),
    ('Alegreya Sans', 'normal', '700', 'alegreyasans/AlegreyaSans-Bold.ttf'),
    ('Instrument Serif', 'normal', '400', 'instrumentserif/InstrumentSerif-Regular.ttf'),
    ('Instrument Serif', 'italic', '400', 'instrumentserif/InstrumentSerif-Italic.ttf'),
]
# Google's latin range plus the asterism and fleurons for scene breaks.
LATIN = ('U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,'
         'U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,'
         'U+2212,U+2215,U+2766-2767,U+FEFF,U+FFFD')

out = pathlib.Path(__file__).resolve().parent.parent / 'dist' / 'reading-lab' / 'fonts'
out.mkdir(parents=True, exist_ok=True)
for old in out.glob('*.woff2'):
    old.unlink()
manifest = []
with tempfile.TemporaryDirectory() as tmp:
    for family, style, weight, repo_path in FACES:
        src = pathlib.Path(tmp) / pathlib.Path(repo_path).name
        url = RAW + urllib.parse.quote(repo_path)
        src.write_bytes(urllib.request.urlopen(url, timeout=60).read())
        name = f"{family.lower().replace(' ', '-')}-latin-{style}-{weight.replace(' ', '-')}.woff2"
        opts = subset.Options()
        opts.layout_features = ['*']
        opts.flavor = 'woff2'
        opts.name_IDs = ['*']
        opts.notdef_outline = True
        font = TTFont(src)
        sub = subset.Subsetter(opts)
        sub.populate(unicodes=subset.parse_unicodes(LATIN))
        sub.subset(font)
        font.flavor = 'woff2'
        font.save(out / name)
        feats = sorted({r.FeatureTag for r in font['GSUB'].table.FeatureList.FeatureRecord}) if 'GSUB' in font else []
        print(name, (out / name).stat().st_size, ' '.join(f for f in feats if f in ('smcp', 'c2sc', 'onum', 'liga', 'dlig')))
        manifest.append({'family': family, 'style': style, 'weight': weight, 'file': name, 'features': feats})
(out / 'manifest.json').write_text(json.dumps(manifest, indent=1))
