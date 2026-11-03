#!/usr/bin/env node
// Initials lab: decorated initials (drop caps) for the story pages, set on
// the book page so a face and a frequency can be chosen by eye. Reads built
// stories out of dist/<slug>.html (run `node build.js` first) and writes
// dist/initials-lab/index.html. Fonts come from the manifest that
// scripts/initials-lab-fonts.py writes into dist/initials-lab/fonts/; the
// page loads only those files. Research and sources: the lab's notes and
// the initials-research memo the lab was built with.
// Usage: node scripts/initials-lab.js
'use strict';
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');
const OUT = path.join(DIST, 'initials-lab');
const FONT_DIR = path.join(OUT, 'fonts');

// Shortlist shown in the face grid and the frequency picker. I0 is the
// site's current initial. The other Steffmann caps go in the appendix strip.
const FACES = [
  { code: 'I0', family: 'EB Garamond', note: 'Today’s initial: the body face enlarged. Calm, typographic, no ornament.' },
  { code: 'I1', family: 'Zallman Caps', note: 'Roman capital in a square of interlaced vine (after Zallman’s woodcut alphabets). The classic fine-press drop cap.' },
  { code: 'I2', family: 'Morris Initials', note: 'Kelmscott-style capital on a ground of acanthus and berries, after William Morris’s initials (1890s).' },
  { code: 'I3', family: 'Goudy Initialen', note: 'Open roman capital laced with flowering stems, after Goudy’s decorative initials. Light and airy beside Garamond.' },
  { code: 'I4', family: 'Kinigcap', note: 'Blackletter-flavoured capital wrapped in leafy scrollwork. Darker, more medieval.' },
  { code: 'I5', family: 'Eileen Caps', note: 'Art Nouveau capital in a frame of curling leaves; reads as a Victorian book initial.' },
  { code: 'I6', family: 'Typocaps', note: 'Engraved-looking roman capital in a hatched square: a printer’s stock initial.' },
  { code: 'I7', family: 'Cinzel Decorative', note: 'Inscriptional Roman capitals with swash terminals. Elegant without ornament; works at every size.' },
  { code: 'I8', family: 'UnifrakturMaguntia', note: 'Textura after Gutenberg’s Mainz types: the incunabula look, a strong black square.' },
  { code: 'I9', family: 'Monsieur La Doulaise', note: 'Copperplate capitals with long flourishes. The most ornate script; flourishes spill into the margin.' },
  { code: 'I10', family: 'Kalnia Glaze', note: 'From the approved experimental list: a glazed, two-tone didone. Brings its own colour.' },
  { code: 'I11', family: 'Jacques Francois Shadow', note: 'From the approved list: an engraved, shaded old-style capital, nearest in spirit to Garamond.' },
];

function manifest() {
  const p = path.join(FONT_DIR, 'manifest.json');
  if (!fs.existsSync(p)) throw new Error(`${p} missing: run uv run --with fonttools --with brotli python3 scripts/initials-lab-fonts.py`);
  const m = JSON.parse(fs.readFileSync(p, 'utf8'));
  for (const f of m) if (!fs.existsSync(path.join(FONT_DIR, f.file))) throw new Error(`font ${f.file} missing`);
  return m;
}

const fontFaces = m => m.map(f =>
  `@font-face { font-family: '${f.family}'; src: url('fonts/${f.file}') format('woff2'); font-style: ${f.style}; font-weight: ${f.weight}; font-display: block; }`).join('\n');

// --- story text ------------------------------------------------------------

function storyBody(slug) {
  const html = fs.readFileSync(path.join(DIST, `${slug}.html`), 'utf8');
  const title = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)[1].replace(/<[^>]+>/g, '').trim();
  const body = html.match(/<div class="post-body">([\s\S]*?)<\/div>\s*<p class="end-mark"/)[1].trim();
  // Sections are runs of paragraphs between <hr>s.
  const sections = body.split(/<hr[^>]*>/).map(s => s.match(/<p[^>]*>[\s\S]*?<\/p>/g) || []);
  return { title, sections };
}

// Small-caps lead-in: up to five words, stopping at a clause end (as build.js).
function leadIn(p) {
  return p.replace(/^<p[^>]*>(?:<span class="lead">([^<]*)<\/span>)?([^<]*)/, (m, lead, rest) => {
    if (lead) return `<p><span class="lead">${lead}</span>${rest}`;
    const words = rest.split(' ');
    let n = 0;
    while (n < Math.min(5, words.length - 1)) { n++; if (/[.,;:!?”]$/.test(words[n - 1])) break; }
    const l = words.slice(0, n).join(' ');
    return `<p><span class="lead">${l}</span>${rest.slice(l.length)}`;
  });
}

// An initial paragraph: a leading quotation mark comes out of the text flow
// into data-q, which CSS hangs in the margin at text size (Bringhurst 4.1.5);
// the letter after it then becomes ::first-letter on its own.
function initial(p, cls) {
  p = leadIn(p);
  return p.replace(/^<p><span class="lead">([“‘"']?)/, (m, q) =>
    `<p class="${cls}${q ? ' oq' : ''}"${q ? ` data-q="${q}"` : ''}><span class="lead">`);
}

// The paragraph as a browser renders ::first-letter by default: the quote
// joins the drop cap.
function initialRaw(p) { return leadIn(p).replace(/^<p>/, '<p class="init">'); }

function excerpt(sections, shape) {
  // shape: number of paragraphs to take from each of the first N sections.
  const out = [];
  shape.forEach((n, i) => {
    if (i) out.push('<hr>');
    sections[i].slice(0, n).forEach((p, j) => out.push(j === 0 ? initial(p, i === 0 ? 'init open' : 'init sec') : p));
  });
  return out.join('\n');
}

const trim = (p, words) => {
  const text = p.replace(/<\/p>$/, '');
  const parts = text.split(/(\s+)/);
  let count = 0, out = '';
  for (const part of parts) { if (/\S/.test(part) && !part.startsWith('<')) count++; if (count > words) break; out += part; }
  return out.replace(/[,;:\s]+$/, '') + '…</p>';
};

// --- page ------------------------------------------------------------------

const PAPER = 'oklch(0.99 0.006 85)';
const INK = 'oklch(0.24 0.01 264)';
const RED = 'light-dark(oklch(0.52 0.22 24), oklch(0.80 0.11 24))';

const CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root { color-scheme: light dark; --paper: light-dark(${PAPER}, oklch(0.2 0.008 264)); --ink: light-dark(${INK}, oklch(0.9 0.01 85)); --muted: light-dark(oklch(0.5 0.01 264), oklch(0.68 0.01 264)); --red: ${RED}; --init: 'EB Garamond'; }
html { background: var(--paper); color: var(--ink); -webkit-text-size-adjust: 100%; }
body { font-family: 'EB Garamond', serif; font-kerning: normal; font-variant-numeric: oldstyle-nums proportional-nums; }
a { color: inherit; }
main { max-width: 74rem; margin: 0 auto; padding: 4rem 1.4rem 8rem; }
h1 { font-weight: 400; font-size: 2.4rem; letter-spacing: 0.12em; text-transform: uppercase; }
h2 { font-weight: 400; font-size: 1.35rem; letter-spacing: 0.1em; text-transform: uppercase; margin: 4.5rem 0 0.4rem; }
.intro, .note { max-width: 40rem; font-size: 1.1rem; line-height: 1.5; color: var(--muted); margin-top: 0.6rem; }
.note b { color: var(--ink); font-weight: 500; }
code { font-family: inherit; font-style: italic; }

/* the book page */
.story { font-size: clamp(19px, 14.4px + 0.45vw, 21.5px); line-height: 1.5; text-align: justify; hyphens: auto; -webkit-hyphens: auto; hyphenate-limit-chars: 6 3 2; text-wrap: pretty; font-variant-ligatures: common-ligatures; max-width: 29em; }
.story p { text-indent: 1em; hanging-punctuation: first; orphans: 2; widows: 2; }
.story > p:first-child, .story hr + p, .story p.init { text-indent: 0; }
.story .lead { font-variant-caps: small-caps; letter-spacing: 0.07em; }
.story .caps { font-variant-caps: all-small-caps; letter-spacing: 0.06em; }
.story hr { border: 0; margin: 1.5em 0; height: 1.5em; text-align: center; overflow: visible; }
.story hr::before { content: '*\\2002*\\2002*'; letter-spacing: 0.1em; }
.story p.init { position: relative; }
.story p.init::first-letter { font-family: var(--init), 'EB Garamond'; initial-letter: 3; -webkit-initial-letter: 3; margin-right: 0.12em; font-variant-caps: normal; letter-spacing: 0; font-weight: 400; color: var(--init-color, inherit); }
.story p.init.small::first-letter { initial-letter: 2; -webkit-initial-letter: 2; }
@supports not ((initial-letter: 3) or (-webkit-initial-letter: 3)) {
  .story p.init::first-letter { float: left; font-size: 3.9em; line-height: 0.8; margin: 0.06em 0.08em 0 0; }
  .story p.init.small::first-letter { font-size: 2.5em; }
}
/* A leading quotation mark, taken out of the flow, hangs at text size. */
.story p.oq::before { content: attr(data-q); position: absolute; left: -0.45em; top: 0; }
.story.drop-q p.oq::before { content: none; }

/* face grid */
.faces { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 22rem), 1fr)); gap: 3rem 3.2rem; margin-top: 2rem; }
.face h3 { font-weight: 500; font-size: 1.05rem; letter-spacing: 0.04em; }
.face h3 .c { display: inline-block; min-width: 2.4em; color: var(--red); }
.face .meta { font-size: 0.85rem; color: var(--muted); margin: 0.15rem 0 0.4rem; line-height: 1.35; }
.face .meta a { text-decoration-thickness: 1px; }
.face .alpha { font-size: 2.6rem; line-height: 1.15; margin: 0.3rem 0 0.8rem; letter-spacing: 0.04em; overflow-wrap: anywhere; }
.face .story { font-size: 19px; }

/* frequency demo */
.controls { position: sticky; top: 0; z-index: 2; background: var(--paper); padding: 0.8rem 0; margin-top: 1.2rem; display: flex; flex-wrap: wrap; gap: 0.4rem 1.4rem; align-items: baseline; border-bottom: 1px solid color-mix(in oklch, var(--ink) 15%, transparent); }
.controls .grp { display: flex; flex-wrap: wrap; gap: 0.3rem; align-items: baseline; }
.controls .lbl { font-size: 0.85rem; color: var(--muted); margin-right: 0.3rem; font-variant-caps: all-small-caps; letter-spacing: 0.08em; font-size: 1rem; }
.controls button { font: inherit; font-size: 0.95rem; padding: 0.15rem 0.55rem; border: 1px solid color-mix(in oklch, var(--ink) 25%, transparent); background: none; color: inherit; border-radius: 3px; cursor: pointer; }
.controls button[aria-pressed=true] { background: var(--ink); color: var(--paper); }
.freq { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 30rem), 1fr)); gap: 3rem 3.5rem; margin-top: 2rem; }
.freq h3 { font-weight: 500; font-size: 1.05rem; margin-bottom: 0.2rem; }
.why { font-size: 0.9rem; color: var(--muted); line-height: 1.4; margin-bottom: 1.4rem; max-width: 30rem; }
.story.v-a p.sec::first-letter { all: unset; }
.story.v-a p.sec { text-indent: 0; }
.story.v-c p.init::first-letter, .story.v-d p.sec::first-letter { color: var(--red); }
.story.v-d p.sec::first-letter { font-family: 'EB Garamond'; }

/* quote handling */
.quotes { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 22rem), 1fr)); gap: 2.5rem 3rem; margin-top: 2rem; }
.quotes .story { font-size: 19px; }

/* EB Garamond Initials with fill layers */
.layered { display: flex; gap: 2.2rem; flex-wrap: wrap; margin-top: 1.4rem; }
.layer { position: relative; font-size: 7rem; line-height: 1; width: 1em; height: 1em; }
.layer span { position: absolute; inset: 0; }
.layer .f1 { font-family: 'EB Garamond Initials Fill1'; color: var(--red); }
.layer .f2 { font-family: 'EB Garamond Initials Fill2'; color: oklch(0.55 0.12 250); }
.layer .o { font-family: 'EB Garamond Initials'; }

/* appendix */
.more { margin-top: 1.4rem; }
.more li { list-style: none; display: grid; grid-template-columns: 13rem 1fr; gap: 1rem; align-items: center; padding: 0.6rem 0; border-top: 1px solid color-mix(in oklch, var(--ink) 10%, transparent); }
.more .n { font-size: 0.95rem; }
.more .n small { display: block; color: var(--muted); font-size: 0.8rem; }
.more .a { font-size: 2.3rem; line-height: 1.2; letter-spacing: 0.04em; overflow-wrap: anywhere; }
@media (max-width: 600px) { .more li { grid-template-columns: 1fr; } .story { text-align: left; } }
`;

const JS = `
const set = (k, v) => { document.documentElement.style.setProperty(k, v); };
document.querySelectorAll('[data-face]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('[data-face]').forEach(x => x.setAttribute('aria-pressed', x === b));
  set('--init', "'" + b.dataset.face + "'");
  history.replaceState(null, '', '#' + b.dataset.code);
}));
const start = document.querySelector('[data-code="' + location.hash.slice(1) + '"]') || document.querySelector('[data-face]');
start.click();
`;

function page(m) {
  const byFamily = Object.fromEntries(m.filter(f => !f.body).map(f => [f.family, f]));
  const kb = f => `${(f.bytes / 1024).toFixed(1)} KB`;
  const company = storyBody('the-company-man');
  const opening = trim(company.sections[0][0], 62);

  const faces = FACES.map(f => {
    const mf = byFamily[f.family];
    const meta = mf
      ? `${mf.letters.length} letters · ${kb(mf)} woff2 (A–Z) · <a href="${mf.source.replace('raw.githubusercontent.com/google/fonts/main', 'github.com/google/fonts/blob/main')}">source</a>`
      : 'the body face, already served';
    const p = initial(opening, 'init open');
    return `<section class="face" style="--init: '${f.family}'">
<h3><span class="c">${f.code}</span>${f.family}</h3>
<p class="meta">${f.note}<br>${meta}</p>
<p class="alpha" style="font-family: '${f.family}', 'EB Garamond'">T I W A O</p>
<div class="story">${p}</div>
</section>`;
  }).join('\n');

  const buttons = FACES.map(f => `<button type="button" data-face="${f.family}" data-code="${f.code}" aria-pressed="false" title="${f.family}">${f.code}</button>`).join('');
  const ex = excerpt(company.sections, [3, 2, 2]);
  const freqs = [
    ['v-a', 'A · Opening only', 'One three-line initial at the head of the story. Each later section starts flush left with its first words in small capitals, Bringhurst’s plain mark of a resumption (4.1.4). The modern trade-fiction norm.'],
    ['v-b', 'B · Opening + smaller section initials', 'Three-line initial at the opening, two-line initial after each scene break. The graded hierarchy of manuscripts (major and minor initials) and of Bringhurst’s own example page (54 pt opening, 42 pt later passages).'],
    ['v-d', 'D · Ornate opening, red section initials', 'The manuscript hierarchy in two grades: the chosen ornate face for the story’s opening (major initial), plain two-line EB Garamond capitals in red at each scene break (the rubricator’s minor initials).'],
    ['v-c', 'C · Rubricated', 'As B, with the initials in the site’s red: the scribe’s rubrication, which marked divisions in red long before printers cut decorated initials.'],
  ];
  const freqHtml = freqs.map(([cls, name, why]) => {
    const html = cls === 'v-a' ? ex : ex.replace(/class="init sec/g, 'class="init sec small');
    return `<section><h3>${name}</h3><p class="why">${why}</p><div class="story ${cls}">\n${html}\n</div></section>`;
  }).join('\n');

  const goldfish = storyBody('goldfish').sections[0][0];
  const olympiad = storyBody('that-mad-olympiad-1').sections[0][0];
  const qOpen = [trim(goldfish, 50), trim(olympiad, 50)];
  const quotes = [
    ['Q1 · Quote hung at text size', 'The opening quote stays (Bringhurst 4.1.5: “For the reader’s sake, it should be there”), at text size, hung in the margin; the initial is the letter.', '', p => initial(p, 'init open')],
    ['Q2 · Quote omitted', 'The older printers’ habit Chicago reports: the opening quote is dropped and the initial stands alone. Tidy, but the reader loses the cue that speech has begun.', 'drop-q', p => initial(p, 'init open')],
    ['Q3 · Browser default', 'What <code>::first-letter</code> does unaided: the quote mark joins the initial at full size. Avoid.', '', p => initialRaw(p)],
  ].map(([name, why, cls, fn]) => `<section><h3>${name}</h3><p class="why">${why}</p>${qOpen.map(p => `<div class="story ${cls}" style="margin-bottom:1.6em">${fn(p)}</div>`).join('')}</section>`).join('\n');

  const shown = new Set(FACES.map(f => f.family));
  const more = m.filter(f => !f.body && !shown.has(f.family) && !f.family.startsWith('EB Garamond Initials'))
    .map(f => `<li><span class="n">${f.family}<small>${f.letters.length} letters · ${kb(f)} · <a href="${f.source}">source</a></small></span><span class="a" style="font-family: '${f.family}'">${f.letters}</span></li>`).join('\n');
  const ebg = byFamily['EB Garamond Initials'];
  const layered = ['T', 'O', 'A', 'G'].map(c => `<div class="layer" aria-label="${c}"><span class="f1">${c}</span><span class="f2">${c}</span><span class="o">${c}</span></div>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Initials lab</title>
<style>
${fontFaces(m)}
${CSS}
</style>
</head>
<body>
<main>
<h1>Initials lab</h1>
<p class="intro">Decorated initials for the story pages, on the book page as it stands (EB Garamond, justified, 1&nbsp;em indents). Every face is served from this folder and cut to A–Z. Text: <i>${company.title}</i>, <i>Goldfish</i>, <i>That Mad Olympiad</i>.</p>

<h2>Faces</h2>
<p class="note">Each face as the story’s three-line opening initial. The stories open with <b>T, I, W, A, O</b> and a few with a quotation mark.</p>
<div class="faces">
${faces}
</div>

<h2>How often</h2>
<p class="note">The same excerpt (opening and two scene breaks) at three frequencies. Pick a face; it applies to all three.</p>
<div class="controls"><span class="grp"><span class="lbl">face</span>${buttons}</span></div>
<div class="freq">
${freqHtml}
</div>

<h2>A leading quotation mark</h2>
<p class="note">Openings that start with dialogue. Q1 is the recommended handling and is what the face grid and frequency demos use.</p>
<div class="quotes">
${quotes}
</div>

<h2>EB Garamond Initials</h2>
<p class="note">Georg Duffner’s initials for EB Garamond, drawn from the 1592 Berner specimen, with its two fill fonts layered (outline black, Fill1 red, Fill2 blue). The set has only <b>${ebg ? ebg.letters.split('').join(' ') : '?'}</b>: no I or W, so it cannot carry most stories.</p>
<div class="layered">${layered}</div>

<h2>More decorated capitals</h2>
<p class="note">The rest of Dieter Steffmann’s initials as packaged on CTAN, converted here from Type&nbsp;1. Any of these can be promoted to the shortlist.</p>
<ul class="more">
${more}
</ul>
</main>
<script>${JS}</script>
</body>
</html>
`;
}

const m = manifest();
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), page(m));
console.log('wrote initials-lab/index.html');
