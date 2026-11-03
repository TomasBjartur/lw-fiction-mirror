"""Download the latin woff2 subsets of the site's served text faces into
fonts/web/. Run once when a face changes; the files are committed, so builds
never depend on Google Fonts. Usage: uv run python3 scripts/fetch-webfonts.py"""
import pathlib, re, urllib.request

UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
FACES = {  # file prefix -> Google css2 family spec
    'inter': 'Inter:ital,wght@0,300..700;1,300..700',
    'charis-sil': 'Charis+SIL:ital,wght@0,400;0,700;1,400;1,700',
    'fira-mono': 'Fira+Mono:wght@400',
}
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
