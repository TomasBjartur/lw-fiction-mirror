"""Download the latin woff2 subsets of the site's served text faces into
fonts/web/. Run once when a face changes; the files are committed, so builds
never depend on Google Fonts.
Usage: uv run --with fonttools --with brotli python3 scripts/fetch-webfonts.py

Google's css2 files strip OpenType features (old-style figures, small caps),
so EB Garamond (story text and the meta line: old-style figures, small
caps) is built from the full TTFs in the google/fonts repo, pinned at
weights 400 and 700, subset to the same latin range with the layout
features the site can use kept."""
import pathlib, re, tempfile, urllib.parse, urllib.request

UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
FACES = {  # file prefix -> Google css2 family spec
    'inter': 'Inter:wght@300..700',
    'fira-mono': 'Fira+Mono:wght@400',
}
RAW = 'https://raw.githubusercontent.com/google/fonts/main/ofl/'
FULL = [  # output file, repo path, weight to pin a variable font at (or None)
    ('eb-garamond-latin-normal-400-v1.woff2', 'ebgaramond/EBGaramond[wght].ttf', 400),
    ('eb-garamond-latin-italic-400-v1.woff2', 'ebgaramond/EBGaramond-Italic[wght].ttf', 400),
    ('eb-garamond-latin-normal-700-v1.woff2', 'ebgaramond/EBGaramond[wght].ttf', 700),
]
# Google Fonts' "latin" subset; build.js LATIN_RANGES must match it.
LATIN = ('U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,'
         'U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,'
         'U+2212,U+2215,U+FEFF,U+FFFD')
out = pathlib.Path(__file__).resolve().parent.parent / 'fonts' / 'web'

def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=30).read()

for prefix, spec in FACES.items():
    css = get(f'https://fonts.googleapis.com/css2?family={spec}&display=swap').decode()
    blocks = re.findall(r'/\* latin \*/\s*@font-face\s*\{(.*?)\}', css, re.S)
    if not blocks:
        raise SystemExit(f'no latin block for {spec}')
    for b in blocks:
        style = re.search(r'font-style:\s*(\w+)', b).group(1)
        weight = re.search(r'font-weight:\s*([\d ]+);', b).group(1).strip().replace(' ', '-')
        url = re.search(r'url\((\S+?)\)', b).group(1)
        data = get(url)
        if data[:4] != b'wOF2':
            raise SystemExit(f'{url} is not woff2')
        path = out / f'{prefix}-latin-{style}-{weight}-v1.woff2'
        path.write_bytes(data)
        print(path.name, len(data))

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

with tempfile.TemporaryDirectory() as tmp:
    for name, repo_path, wght in FULL:
        src = pathlib.Path(tmp) / pathlib.Path(repo_path).name
        src.write_bytes(urllib.request.urlopen(RAW + urllib.parse.quote(repo_path), timeout=60).read())
        font = TTFont(src)
        if wght is not None:
            font = instancer.instantiateVariableFont(font, {'wght': wght})
        opts = subset.Options()
        # Shaping basics plus figure styles and small caps; the rest
        # (swashes, stylistic sets, fractions...) would more than double it.
        opts.layout_features = ['ccmp', 'locl', 'mark', 'mkmk', 'kern', 'liga', 'calt',
                                'onum', 'lnum', 'pnum', 'tnum', 'smcp', 'c2sc']
        opts.flavor = 'woff2'
        sub = subset.Subsetter(opts)
        sub.populate(unicodes=subset.parse_unicodes(LATIN))
        sub.subset(font)
        font.flavor = 'woff2'
        font.save(out / name)
        feats = sorted({r.FeatureTag for r in font['GSUB'].table.FeatureList.FeatureRecord}) if 'GSUB' in font else []
        if 'onum' not in feats:
            raise SystemExit(f'{name}: no onum feature after subsetting')
        print(name, (out / name).stat().st_size, 'features:', ' '.join(feats))
