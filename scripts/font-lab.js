#!/usr/bin/env node
// Font lab: renders every story title in several type directions side by side,
// so a title set can be picked by eye. Reads titles from dist/index.html (run
// `node build.js` first) and writes dist/font-lab.html. Loads faces straight
// from Google Fonts; this page is a design tool, not part of the site.
const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, '..', 'dist');
const index = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const stories = [...index.matchAll(/<li class="story" data-slug="([^"]+)"[^>]*>[\s\S]*?<a class="story-title[^"]*" href="[^"]+">([^<]+)<\/a>/g)]
  .map(m => ({ slug: m[1], title: m[2] }));
if (stories.length === 0) throw new Error('no stories found in dist/index.html; run node build.js first');

// Each direction: a list of per-title styles, applied in contents order
// (newest first) and cycled if there are more stories than entries.
// `family` is the Google Fonts request spec; `css` is the inline style.
const fr = (wght, opsz, soft, wonk, ital) =>
  ({ css: `font-family:'Fraunces';font-weight:${wght};font-style:${ital ? 'italic' : 'normal'};font-variation-settings:'opsz' ${opsz},'SOFT' ${soft},'WONK' ${wonk}` });
const rec = (wght, casl, mono, slnt, crsv) =>
  ({ css: `font-family:'Recursive';font-weight:${wght};font-variation-settings:'CASL' ${casl},'MONO' ${mono},'slnt' ${slnt},'CRSV' ${crsv}` });
// g('Name', 'ital,wght@1,500') requests that instance and styles it to match.
const g = (name, extra = '', more = '') => {
  const [axes = '', vals = ''] = extra.split('@');
  const v = vals.split(',');
  const ax = axes.split(',');
  const ital = ax.includes('ital') && v[ax.indexOf('ital')] === '1';
  const wght = ax.includes('wght') ? v[ax.indexOf('wght')] : null;
  return {
    family: name.replace(/ /g, '+') + (extra ? ':' + extra : ''),
    css: `font-family:'${name}'${ital ? ';font-style:italic' : ''}${wght ? `;font-weight:${wght}` : ''}${more}`,
  };
};
// Pen scripts have tiny x-heights; normalising by x-height blows them up.
const script = name => g(name, '', ';font-size-adjust:none;font-size:1.55rem');

// The canon: the most admired typefaces of all time, each as a face the site
// can serve to every reader (Google Fonts, self-hostable). Where the classic
// itself cannot be served, the row shows its best open revival and names it.
// [name, what it is, Google family spec, extra css]
const CANON = [
  ['Serif: Renaissance and Baroque', [
    ['EB Garamond', 'Claude Garamond, Paris 1530s; Duffner revival', 'EB Garamond:wght@500'],
    ['Cormorant Garamond', 'Garamond display cut; markusstrasser.org headings', 'Cormorant Garamond:wght@500'],
    ['Cardo', 'Aldus Manutius / Bembo, Venice 1495', 'Cardo'],
    ['Sorts Mill Goudy', 'Goudy Old Style, 1915', 'Sorts Mill Goudy'],
    ['Libre Caslon Text', 'William Caslon, London 1734', 'Libre Caslon Text'],
    ['Alegreya', 'calligraphic old style, 2011', 'Alegreya:wght@500'],
    ['Vollkorn', 'dark-coloured old style, 2005', 'Vollkorn:wght@500'],
    ['Crimson Pro', 'in the line of Minion and Garamond, 2018', 'Crimson Pro:wght@500'],
  ]],
  ['Serif: Transitional and Didone', [
    ['Libre Baskerville', 'John Baskerville, Birmingham 1757', 'Libre Baskerville'],
    ['Bodoni Moda', 'Giambattista Bodoni, Parma 1790s', 'Bodoni Moda:wght@500'],
    ['Playfair Display', 'Didot-era high contrast, 2011', 'Playfair Display:wght@500'],
    ['Old Standard TT', 'late-19th-century "Modern" book face', 'Old Standard TT'],
    ['Charis SIL', 'Charter, Matthew Carter 1987; the body face now', 'Charis SIL'],
    ['Gelasio', 'Georgia, Matthew Carter 1993 (metric clone)', 'Gelasio:wght@500'],
    ['Tinos', 'Times New Roman, 1932 (metric clone)', 'Tinos'],
    ['Cinzel', 'Roman inscriptional capitals, Trajan column 113 AD', 'Cinzel:wght@500'],
  ]],
  ['Serif: contemporary', [
    ['Source Serif 4', 'Fournier-inspired, Adobe 2014', 'Source Serif 4:wght@500'],
    ['Literata', 'Google Play Books face, 2015', 'Literata:wght@500'],
    ['Newsreader', 'newspaper text, Production Type 2020', 'Newsreader:wght@500'],
    ['Spectral', 'screen-first text serif, 2017', 'Spectral:wght@500'],
    ['Fraunces', '"Old Style soft" display, 2020', 'Fraunces:wght@500'],
    ['Instrument Serif', 'condensed display serif, 2023', 'Instrument Serif'],
    ['DM Serif Display', 'high-contrast transitional display', 'DM Serif Display'],
    ['Young Serif', 'heavy old style in the Plantin line', 'Young Serif'],
  ]],
  ['Slab', [
    ['Besley', 'Clarendon, Robert Besley 1845', 'Besley:wght@500'],
    ['Zilla Slab', 'Mozilla\'s slab, 2017', 'Zilla Slab:wght@500'],
    ['Roboto Slab', 'Rockwell-like geometric slab', 'Roboto Slab'],
  ]],
  ['Sans: grotesque and neo-grotesque', [
    ['Inter', 'SF/Helvetica-style UI sans; the list font now', 'Inter'],
    ['Libre Franklin', 'Franklin Gothic, Morris Fuller Benton 1902', 'Libre Franklin'],
    ['Archivo', 'American grotesque, 2016', 'Archivo'],
    ['Public Sans', 'US government neutral sans, 2019', 'Public Sans'],
    ['IBM Plex Sans', 'IBM corporate face, 2017', 'IBM Plex Sans'],
    ['Space Grotesk', 'quirky grotesque from Space Mono', 'Space Grotesk'],
    ['Bricolage Grotesque', 'French-flavoured display grotesque, 2023', 'Bricolage Grotesque'],
    ['Instrument Sans', 'precise neo-grotesque, 2023', 'Instrument Sans'],
  ]],
  ['Sans: geometric', [
    ['Jost', 'Futura, Paul Renner 1927 (revival)', 'Jost'],
    ['Josefin Sans', '1920s geometric with vintage proportions', 'Josefin Sans'],
    ['Montserrat', 'Gotham-like, Buenos Aires signage', 'Montserrat'],
    ['Poppins', 'pure circles-and-lines geometric', 'Poppins'],
    ['Manrope', 'semi-condensed modern geometric', 'Manrope'],
    ['Syne', 'wide-to-narrow art-centre face, 2017', 'Syne'],
  ]],
  ['Sans: humanist', [
    ['Lato', 'warm humanist in the Gill Sans / Frutiger family', 'Lato'],
    ['Source Sans 3', 'Adobe\'s first open face, in the Franklin/News Gothic line', 'Source Sans 3'],
    ['Fira Sans', 'Erik Spiekermann for Mozilla, Meta lineage', 'Fira Sans'],
    ['Open Sans', 'Frutiger-like, the web\'s workhorse', 'Open Sans'],
    ['Marcellus', 'flared like Optima, Hermann Zapf 1958', 'Marcellus'],
  ]],
  ['Monospace', [
    ['Courier Prime', 'Courier, IBM typewriter 1955', 'Courier Prime'],
    ['IBM Plex Mono', 'IBM corporate mono', 'IBM Plex Mono'],
    ['JetBrains Mono', 'code face, 2020', 'JetBrains Mono'],
    ['Fira Mono', 'code blocks now', 'Fira Mono'],
    ['Space Mono', 'retro-futurist display mono', 'Space Mono'],
  ]],
];
const canonStyle = spec => {
  const [name, rest = ''] = spec.split(':');
  const w = (rest.match(/wght@(\d+)/) || [])[1];
  return { family: spec.replace(/ /g, '+'), css: `font-family:'${name}'${w ? `;font-weight:${w}` : ''}` };
};

const DIRECTIONS = [
  {
    id: 'A', name: 'One family, many voices: Fraunces',
    note: 'Single variable face. Each title gets its own weight, optical size, softness, "wonk" and italic, so the list is distinct per story but reads as one book.',
    families: ['Fraunces:ital,opsz,wght,SOFT,WONK@0,9..144,100..900,0..100,0..1;1,9..144,100..900,0..100,0..1'],
    styles: [fr(300, 144, 100, 1, 0), fr(900, 144, 0, 0, 0), fr(600, 9, 50, 1, 1), fr(400, 72, 100, 0, 1), fr(800, 40, 100, 1, 0),
      fr(200, 144, 0, 0, 1), fr(700, 144, 50, 1, 1), fr(500, 9, 0, 0, 0), fr(900, 144, 100, 1, 1), fr(350, 30, 30, 1, 0),
      fr(650, 72, 0, 0, 1), fr(450, 144, 100, 0, 0), fr(150, 144, 50, 1, 1), fr(750, 9, 100, 1, 0), fr(550, 144, 0, 1, 1)],
  },
  {
    id: 'B', name: 'One family, many voices: Recursive',
    note: 'Single variable face that slides between sans and mono, linear and casual, upright and slanted.',
    families: ['Recursive:slnt,wght,CASL,CRSV,MONO@-15..0,300..1000,0..1,0..1,0..1'],
    styles: [rec(800, 0, 1, 0, 0), rec(400, 1, 0, -15, 1), rec(900, 1, 0, 0, 0), rec(300, 0, 1, -15, 1), rec(600, 0.5, 0, 0, 0),
      rec(1000, 1, 1, -15, 1), rec(450, 0, 0, -8, 0), rec(700, 1, 1, 0, 0), rec(350, 0.3, 0, -15, 1), rec(850, 0, 0, 0, 0),
      rec(500, 1, 0.5, -10, 1), rec(650, 0, 1, -15, 0), rec(950, 0.7, 0, -5, 1), rec(400, 0, 1, 0, 0), rec(750, 1, 0, -15, 1)],
  },
  {
    id: 'C', name: 'Five centuries of book type',
    note: 'Each title in a historical book face, roughly oldest story to newest in reverse: Jenson-, Garamond-, Caslon-, Baskerville-, Bodoni-era revivals and modern text faces.',
    families: [], styles: [
      g('EB Garamond', 'wght@500'), g('Libre Caslon Text'), g('Libre Baskerville'), g('Bodoni Moda', 'wght@500'), g('Old Standard TT'),
      g('IM Fell DW Pica'), g('Sorts Mill Goudy'), g('Cormorant', 'wght@600'), g('Crimson Pro', 'wght@500'), g('Gelasio', 'wght@500'),
      g('Literata', 'wght@500'), g('Linden Hill'), g('Playfair Display', 'wght@500'), g('Spectral', 'wght@500'), g('Newsreader', 'wght@500')],
  },
  {
    id: 'D', name: 'Manuscript and blackletter',
    note: 'Uncials, textura, bastarda and fraktur revivals. Strong period feel, harder to read at a glance.',
    families: [], styles: [
      g('UnifrakturMaguntia'), g('Grenze Gotisch', 'wght@500'), g('Jacquard 24'), g('Pirata One'), g('Jacquarda Bastarda 9'),
      g('Uncial Antiqua'), g('Texturina', 'wght@500'), g('Almendra'), g('MedievalSharp'), g('New Rocker'),
      g('Metamorphous'), g('Eagle Lake'), g('Fondamento'), g('UnifrakturCook', 'wght@700'), g('Grenze Gotisch', 'wght@800')],
  },
  {
    id: 'E', name: 'Typewriter and terminal',
    note: 'All monospace, from office typewriters to code faces. Suits the AI and corporate stories; uniform rhythm down the list.',
    families: [], styles: [
      g('Courier Prime'), g('IBM Plex Mono', 'wght@500'), g('Space Mono'), g('JetBrains Mono', 'wght@500'), g('Martian Mono', 'wght@400'),
      g('DM Mono', 'wght@500'), g('Cutive Mono'), g('Xanh Mono'), g('Syne Mono'), g('Azeret Mono', 'wght@500'),
      g('Red Hat Mono', 'wght@500'), g('Victor Mono', 'ital,wght@1,500'), g('Anonymous Pro', 'wght@700'), g('Fira Code', 'wght@500'), g('Major Mono Display')],
  },
  {
    id: 'F', name: 'Experimental and colour fonts',
    note: 'Built-in colour and 3D faces (they ignore the title gradient) plus odd constructions. Foldit is folded-paper lettering, close to the title story.',
    families: [], styles: [
      g('Foldit', 'wght@500'), g('Nabla'), g('Bungee Spice'), g('Honk'), g('Kalnia Glaze', 'wght@500'),
      g('Tilt Prism'), g('Rubik Glitch'), g('Moirai One'), g('Sixtyfour'), g('Workbench'),
      g('Bungee Shade'), g('Tilt Warp'), g('Rubik Puddles'), g('Climate Crisis'), g('Jersey 10')],
  },
  {
    id: 'G', name: 'Italic and script',
    note: 'Display italics and pen scripts: literary and intimate, weaker for scanning a list.',
    families: [], styles: [
      g('Instrument Serif', 'ital@1'), g('Cormorant Garamond', 'ital,wght@1,500'), g('Playfair Display', 'ital,wght@1,500'), script('Pinyon Script'), g('Italiana'),
      g('Libre Caslon Text', 'ital@1'), script('Petit Formal Script'), g('Fraunces', 'ital,wght@1,400'), script('Monsieur La Doulaise'), g('EB Garamond', 'ital,wght@1,500'),
      script('Homemade Apple'), g('Newsreader', 'ital,wght@1,400'), script('La Belle Aurore'), g('Spectral', 'ital,wght@1,300'), script('Mrs Saint Delafield')],
  },
];

function titleColor(rank, n) {
  const t = n > 1 ? rank / (n - 1) : 0;
  const mix = (a, b) => (a + (b - a) * t).toFixed(3);
  return `oklch(${mix(0.2, 0.36)} ${mix(0.005, 0.15)} 305)`;
}

const families = new Set();
for (const [, faces] of CANON) for (const f of faces) families.add(canonStyle(f[2]).family);
for (const d of DIRECTIONS) {
  d.families.forEach(f => families.add(f));
  d.styles.forEach(s => s.family && families.add(s.family));
}
// Google caps the families per request; split into chunks.
const fam = [...families];
const links = [];
for (let i = 0; i < fam.length; i += 12) {
  links.push(`<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fam.slice(i, i + 12).map(f => 'family=' + f).join('&')}&display=swap">`);
}

const samples = [0, 4, 12].map(i => stories[i % stories.length]);
let k = 0;
const canon = `
  <section class="canon">
    <h2><span class="id">K</span> The canon, as faces every reader gets</h2>
    <p class="note">The most admired typefaces, each served by the site so every device shows the same thing. Where the classic itself cannot be served (Helvetica, Futura, Gill Sans, Optima, Didot), the row shows its best open revival and names the original. Three titles per face; codes like <b>K12</b>.</p>
    ${CANON.map(([group, faces]) => `<h3>${group}</h3><table>${faces.map(([name, what, spec]) => {
      const st = canonStyle(spec);
      return `<tr><td class="code">K${++k}</td><td class="face"><b>${name}</b><br><span>${what}</span></td><td class="ttl" style="${st.css}">${samples.map(s => `<a href="${s.slug}.html">${s.title}</a>`).join('<i>·</i>')}</td></tr>`;
    }).join('')}</table>`).join('')}
  </section>`;

const sections = DIRECTIONS.map(d => `
  <section>
    <h2><span class="id">${d.id}</span> ${d.name}</h2>
    <p class="note">${d.note}</p>
    <ol>${stories.map((s, i) => {
      const st = d.styles[i % d.styles.length];
      const label = (st.css.match(/font-family:'([^']+)'/) || [])[1];
      return `<li><a href="${s.slug}.html" style="${st.css};color:${titleColor(i, stories.length)}">${s.title}</a><span class="f">${d.id}${i + 1} · ${label}</span></li>`;
    }).join('')}</ol>
  </section>`).join('');

const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Font lab — title directions</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${links.join('\n')}
<style>
  body { margin: 0; padding: 1.5rem 2rem 4rem; background: oklch(0.99 0.006 85); color: oklch(0.24 0.01 264); font: 15px/1.4 -apple-system, system-ui, sans-serif; }
  h1 { font-weight: 500; font-size: 1.3rem; margin: 0 0 0.3rem; }
  .intro { margin: 0 0 1.5rem; color: oklch(0.5 0.01 264); max-width: 60rem; }
  main { display: grid; grid-template-columns: repeat(auto-fill, minmax(30rem, 1fr)); gap: 2.2rem 3rem; }
  h2 { font-size: 0.95rem; font-weight: 600; margin: 0; }
  .id { display: inline-block; min-width: 1.4rem; color: oklch(0.45 0.17 26); }
  .note { margin: 0.2rem 0 0.7rem; font-size: 0.8rem; color: oklch(0.5 0.01 264); }
  ol { list-style: katakana; margin: 0; padding-left: 2rem; }
  li { padding: 0.12rem 0; }
  li::marker { color: oklch(0.45 0.17 26); font-size: 0.85rem; }
  li a { font-size: 1.4rem; line-height: 1.2; text-decoration: none; font-size-adjust: 0.5; }
  li a:hover { color: oklch(0.66 0.16 5) !important; }
  .canon { margin-bottom: 3rem; }
  .canon h3 { font-size: 0.8rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: oklch(0.5 0.01 264); margin: 1.4rem 0 0.3rem; }
  .canon table { border-collapse: collapse; width: 100%; }
  .canon td { padding: 0.32rem 0.6rem 0.32rem 0; vertical-align: baseline; border-bottom: 1px solid oklch(0.92 0.005 85); }
  .canon .code { width: 2.6rem; color: oklch(0.45 0.17 26); font-size: 0.8rem; }
  .canon .face { width: 15rem; font-size: 0.8rem; }
  .canon .face span { color: oklch(0.55 0.01 264); font-size: 0.72rem; }
  .canon .ttl { font-size: 1.35rem; line-height: 1.25; font-size-adjust: 0.5; }
  .canon .ttl a { color: oklch(0.24 0.01 264); text-decoration: none; }
  .canon .ttl a:hover { color: oklch(0.66 0.16 5); }
  .canon .ttl i { font-style: normal; color: oklch(0.75 0.01 264); margin: 0 0.5rem; }
  .f { margin-left: 0.6rem; font-size: 0.65rem; color: oklch(0.6 0.01 264); white-space: nowrap; }
</style></head>
<body>
<h1>Font lab</h1>
${canon}
<h1>Earlier directions: one face per title</h1>
<p class="intro">Every story title, in contents order (newest first), in seven directions. Codes like <b>C4</b> name a single title's face, so you can pick a whole direction or mix titles across them. Size is normalised by x-height, as on the site.</p>
<main>${sections}
</main>
</body></html>
`;
fs.writeFileSync(path.join(dist, 'font-lab.html'), html);
console.log(`Wrote dist/font-lab.html (${k} canon faces, ${DIRECTIONS.length} directions × ${stories.length} titles, ${fam.length} families)`);
