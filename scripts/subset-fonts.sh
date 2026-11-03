#!/usr/bin/env bash
# Web subset of the bundled EB Garamond regular (SIL OFL, fonts/OFL.txt) for the site's
# display type. Latin + Latin-1 + typographic punctuation, all OpenType
# features kept (smcp, onum, liga). The full TTFs stay for the canvas cover.
# Rerun after replacing fonts/EBGaramond*.ttf; build.js copies fonts/web/ into dist/.
set -euo pipefail
cd "$(dirname "$0")/.."
UNICODES='U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2190-2193,U+2212,U+2215,U+2766,U+2767,U+FEFF,U+FFFD'
for f in EBGaramond; do
  uvx --from fonttools --with brotli pyftsubset "fonts/$f.ttf" \
    --unicodes="$UNICODES" --layout-features='*' --flavor=woff2 \
    --output-file="fonts/web/$f-latin.woff2"
done
ls -l fonts/web
