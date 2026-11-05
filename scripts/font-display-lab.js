#!/usr/bin/env node
// Display font lab: every Latin display, colour and unusual-axis family on
// Google Fonts, each shown on real titles and a date, so a face can be picked
// by eye. Reads titles from dist/index.html (run `node build.js` first),
// fetches the live catalogue from fonts.google.com/metadata/fonts and writes
// dist/font-display.html. Each font is downloaded once as a `text=` subset of
// just the sample characters into dist/fontx/ (cached across runs; Google
// takes ~5 s per font, so 16 run at a time) and the page loads them locally.
// A design tool, not part of the site.
const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, '..', 'dist');
const index = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const titles = [...index.matchAll(/<a class="story-title[^"]*" href="[^"]+">([^<]+)<\/a>/g)].map(m => m[1]);
if (titles.length === 0) throw new Error('no titles in dist/index.html; run node build.js first');
const SAMPLE = [titles[0], titles.find(t => t.length > 25) || titles[1], titles.find(t => /Company/.test(t)) || titles[2]];
const DATE = 'Jul 2026 · 24m';
const CHARS = [...new Set(SAMPLE.join('') + DATE + '·0123456789')].join('');

// Operator's rejects (2026-11-03): Honk, Nabla, all Rubik and all Sixtyfour.
const EXCLUDE = /^(Honk|Nabla|Rubik\b|Sixtyfour\b)/;
// Operator's "reviewed and cool experimental fonts" (2026-11-03): badged.
const REVIEWED = new Set(['Foldit', 'Bungee Spice', 'Kalnia Glaze', 'Tilt Prism', 'Moirai One', 'Workbench', 'Bungee Shade', 'Tilt Warp', 'Climate Crisis', 'Jersey 10']);
const STD_AXES = new Set(['wght', 'wdth', 'ital', 'slnt', 'opsz']);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const FONT_DIR = path.join(dist, 'fontx');
const slug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

// Downloads one family's subset; returns its file name, or null on failure.
async function fetchSubset(f, specStr) {
  const file = `${slug(f.family)}.woff2`;
  const out = path.join(FONT_DIR, file);
  if (fs.existsSync(out) && fs.statSync(out).size > 0) return file;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${specStr}&text=${encodeURIComponent(CHARS)}`, { headers: { 'User-Agent': UA } })).text();
      const m = css.match(/src:\s*url\(([^)]+)\)/);
      if (!m) throw new Error(css.slice(0, 80));
      const res = await fetch(m[1]);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
      return file;
    } catch (e) {
      if (attempt === 2) { console.error(`[DEGRADED] ${f.family}: ${e.message}`); return null; }
    }
  }
}

async function pool(items, n, fn) {
  const results = new Array(items.length);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
      if (++done % 100 === 0) console.log(`  ${done}/${items.length} fonts`);
    }
  }));
  return results;
}

async function main() {
  const raw = await (await fetch('https://fonts.google.com/metadata/fonts')).text();
  const meta = JSON.parse(raw.slice(raw.indexOf('{')));
  const fams = meta.familyMetadataList.filter(f =>
    f.subsets.includes('latin') && !f.isNoto && !EXCLUDE.test(f.family));
  const colour = f => (f.colorCapabilities || []).length > 0;
  const odd = f => (f.axes || []).some(a => !STD_AXES.has(a.tag));
  const display = f => f.category === 'Display' || (f.classifications || []).includes('Display');
  const newest = (a, b) => b.dateAdded.localeCompare(a.dateAdded);

  const groups = [
    ['Colour fonts', 'Fonts that carry their own colours, gradients or layers (COLRv1 / OT-SVG). They ignore the title gradient.', fams.filter(colour).sort(newest)],
    ['Unusual axes', 'Variable fonts with design axes beyond weight and width: rotation, bleed, scanlines, morph, year. Shown at their defaults.', fams.filter(f => odd(f) && !colour(f)).sort(newest)],
    ['All other display faces, newest first', 'Everything else Google lists as Display.', fams.filter(f => display(f) && !colour(f) && !odd(f)).sort(newest)],
  ];

  // css2 rejects a request for a weight the family lacks; ask for 400 if it
  // exists, else the family's first upright weight.
  // Italic-only families (Molle) need the italic requested explicitly.
  const italicOnly = f => !Object.keys(f.fonts).some(k => /^\d+$/.test(k));
  const spec = f => {
    if (italicOnly(f)) return f.family.replace(/ /g, '+') + ':ital,wght@1,' + parseInt(Object.keys(f.fonts)[0], 10);
    const w = Object.keys(f.fonts).filter(k => /^\d+$/.test(k));
    const pick = w.includes('400') || w.length === 0 ? null : w[0];
    return f.family.replace(/ /g, '+') + (pick ? `:wght@${pick}` : '');
  };
  const weight = f => {
    const w = Object.keys(f.fonts).filter(k => /^\d+$/.test(k));
    return w.includes('400') || w.length === 0 ? 400 : +w[0];
  };
  fs.mkdirSync(FONT_DIR, { recursive: true });
  const all = groups.flatMap(g => g[2]);
  const files = new Map();
  (await pool(all, 16, f => fetchSubset(f, spec(f)))).forEach((file, i) => file && files.set(all[i].family, file));
  const faces = all.filter(f => files.has(f.family))
    .map(f => `@font-face{font-family:'${f.family}';src:url('fontx/${files.get(f.family)}') format('woff2');font-weight:${weight(f)};font-style:${italicOnly(f) ? 'italic' : 'normal'};font-display:block}`).join('\n');
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

  let k = 0;
  const sections = groups.map(([name, note, list]) => `
  <section>
    <h2>${name} <span class="count">${list.length}</span></h2>
    <p class="note">${note}</p>
    <table>${list.map(f => {
      const tags = [colour(f) ? 'colour' : '', ...(f.axes || []).filter(a => !STD_AXES.has(a.tag)).map(a => a.tag)].filter(Boolean).join(' ');
      const missing = files.has(f.family) ? '' : ' · <b>download failed</b>';
      return `<tr data-family="${esc(f.family)}"><td class="code">X${++k}</td><td class="face"><b>${esc(f.family)}</b>${REVIEWED.has(f.family) ? ' <em class="cool">reviewed, cool</em>' : ''}<br><span>${f.dateAdded.slice(0, 4)} · ${esc((f.designers || []).slice(0, 2).join(', '))}${tags ? ` · <i>${tags}</i>` : ''}${missing}</span></td><td class="ttl" style="font-family:'${esc(f.family)}',var(--fallback);font-weight:${weight(f)}${italicOnly(f) ? ';font-style:italic' : ''}">${SAMPLE.map(esc).join('<i class="sep">·</i>')}<span class="date">${DATE}</span></td></tr>`;
    }).join('')}</table>
  </section>`).join('');

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Display font lab</title>
<style>
${faces}
  :root { --fallback: serif; }
  body { margin: 0; padding: 1.5rem 2rem 4rem; background: oklch(0.99 0.006 85); color: oklch(0.24 0.01 264); font: 15px/1.4 -apple-system, system-ui, sans-serif; }
  h1 { font-weight: 500; font-size: 1.3rem; margin: 0 0 0.3rem; }
  .intro { margin: 0 0 1.2rem; color: oklch(0.5 0.01 264); max-width: 62rem; }
  h2 { font-size: 0.8rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: oklch(0.45 0.01 264); margin: 2rem 0 0.2rem; }
  .count { color: oklch(0.45 0.17 26); }
  .note { margin: 0 0 0.5rem; font-size: 0.8rem; color: oklch(0.55 0.01 264); }
  table { border-collapse: collapse; width: 100%; }
  td { padding: 0.45rem 0.8rem 0.45rem 0; vertical-align: middle; border-bottom: 1px solid oklch(0.92 0.005 85); }
  .code { width: 3rem; color: oklch(0.45 0.17 26); font-size: 0.8rem; }
  .face { width: 14rem; font-size: 0.8rem; }
  .cool { font-style: normal; font-size: 0.65rem; color: oklch(0.5 0.15 150); border: 1px solid currentColor; border-radius: 3px; padding: 0 0.25rem; }
  .face span { color: oklch(0.55 0.01 264); font-size: 0.72rem; }
  .ttl { font-size: 1.6rem; line-height: 1.25; color: oklch(0.3 0.12 305); }
  .sep { font-style: normal; color: oklch(0.8 0.01 264); margin: 0 0.6rem; font-family: system-ui; font-size: 1rem; }
  .date { margin-left: 1.2rem; font-size: 0.6em; color: oklch(0.5 0.01 264); }
</style></head>
<body>
<h1>Display font lab</h1>
<p class="intro">Every Latin display, colour and unusual-axis family on Google Fonts (${k} faces; Honk, Nabla, Rubik and Sixtyfour left out; your reviewed picks carry a green badge), each on three titles and a date. Codes like <b>X12</b> name a face. All of these are open fonts the site can serve itself.</p>
${sections}
</body></html>
`;
  fs.writeFileSync(path.join(dist, 'font-display.html'), html);
  console.log(`Wrote dist/font-display.html (${files.size}/${all.length} fonts downloaded; ${groups.map(g => `${g[0]}: ${g[2].length}`).join(', ')})`);
}

main().catch(e => { console.error(e); process.exit(1); });
