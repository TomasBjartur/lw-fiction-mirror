"""Writes the copy of a COLRv1 web font that Safari can draw.

Safari's engine has no COLRv1 (font-tech(color-COLRv1) is false through
Safari 27.2) and draws those glyphs as nothing, on Macs and on every iPhone
browser. It does draw OpenType SVG, so this adds an SVG table: nanoemoji's
maximum_color compiles one from the COLR paints. The file keeps COLR and CPAL
too, because the SVG documents take their colours from CPAL (var(--colorN))
and WebKit draws an SVG-only copy blank or black.

Firefox would prefer the SVG table and draw Bitcount Double Ink black, so
build.js gives Chrome and Firefox the original through tech(color-COLRv1) and
only browsers without it reach this file.

    uv run --python 3.12 --with nanoemoji --with brotli \
      python3 scripts/colr-twin.py IN.woff2 OUT.woff2
"""
import subprocess
import sys
import tempfile
from pathlib import Path

from fontTools.ttLib import TTFont


def main(src, out):
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        font = TTFont(src)
        font.flavor = None
        font.save(work / "in.ttf")
        # maximum_color resolves paths against its working directory and
        # leaves its ninja build beside them.
        subprocess.run(["maximum_color", "--build_dir", "b", "in.ttf"], cwd=work, check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        twin = TTFont(work / "b" / "Font.ttf")
        missing = [t for t in ("COLR", "CPAL", "SVG ") if t not in twin]
        if missing:
            sys.exit(f"{src}: maximum_color left out {missing}")
        twin.flavor = "woff2"
        twin.save(out)
    print(f"{Path(out).name}: {Path(src).stat().st_size} -> {Path(out).stat().st_size} bytes")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
