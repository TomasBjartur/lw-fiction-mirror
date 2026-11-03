#!/usr/bin/env node
// Reading lab: sets one story three ways so the reading treatment can be
// chosen by eye. Reads the built story out of dist/<slug>.html (run
// `node build.js` first) and writes dist/reading-lab/: index.html, a.html,
// b.html, c.html for the first slug, <slug>-a.html etc. for any others.
// Fonts are fetched once from Google Fonts (latin subset, woff2) into
// dist/reading-lab/fonts/ and served from there; no device fonts.
// Usage: node scripts/reading-lab.js [slug ...]
'use strict';
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');
const OUT = path.join(DIST, 'reading-lab');
const FONT_DIR = path.join(OUT, 'fonts');
const SLUGS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['remembering-aubrey-chang', 'goldfish', 'the-maker-of-mind'];

// --- fonts ----------------------------------------------------------------

// @font-face CSS from the manifest scripts/reading-lab-fonts.py writes. Those
// files are full-featured subsets (Google's css2 files lack small caps and
// old-style figures), so this script needs no network.
function fontFaces() {
  const manifestPath = path.join(FONT_DIR, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`${manifestPath} missing: run uv run --with fonttools --with brotli python3 scripts/reading-lab-fonts.py`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const f of manifest) if (!fs.existsSync(path.join(FONT_DIR, f.file))) throw new Error(`font ${f.file} missing`);
  return manifest.map(f =>
    `@font-face { font-family: '${f.family}'; src: url('fonts/${f.file}') format('woff2'); font-style: ${f.style}; font-weight: ${f.weight}; font-display: swap; }`
  ).join('\n');
}

// --- story ----------------------------------------------------------------

function readStory(slug) {
  const html = fs.readFileSync(path.join(DIST, `${slug}.html`), 'utf8');
  const title = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)[1].trim();
  const when = (html.match(/<span class="when">([\s\S]*?)<\/span>/) || [, ''])[1];
  const body = html.match(/<div class="post-body">([\s\S]*?)<\/div>\s*<footer class="post-footer">/)[1].trim();
  return { slug, title, when, body: typeset(body) };
}

// Typographer's quotes, dashes and ellipses in text nodes only (tags and
// attributes untouched). The site's source text mixes straight and curly.
function smarten(text) {
  return text
    .replace(/&quot;/g, '"')
    .replace(/(^|[\s(\[\u2014\u2013])"/g, '$1\u201c')
    .replace(/"/g, '\u201d')
    .replace(/(^|[\s(\[\u2014\u2013\u201c])'/g, '$1\u2018')
    .replace(/'/g, '\u2019')
    .replace(/ - /g, '\u202f\u2014\u2009') // a dash never starts a line
    .replace(/\.\.\./g, '\u2026')
    .replace(/ {2,}/g, ' ');
}

function typeset(body) {
  // Split into tags and text; a quote at the start of a text node that
  // follows an inline tag keeps the previous character's context.
  let out = '', prev = ' ';
  for (const part of body.split(/(<[^>]+>)/)) {
    if (part.startsWith('<')) {
      if (/^<\/?(p|hr|div|blockquote|li|h\d)\b/i.test(part)) prev = ' ';
      out += part;
    } else {
      const s = smarten(prev + part).slice(1);
      // Acronyms (MIND, CEO) get their own span: book treatments set them in
      // small capitals so they do not shout in running text.
      out += s.replace(/\b[A-Z]{3,}\b/g, '<span class="caps">$&</span>');
      if (part) prev = part.slice(-1);
    }
  }
  out = out.replace(/\s+<\/p>/g, '</p>');
  // Mark dialogue paragraphs (open with a quote) so a treatment can hang it.
  out = out.replace(/<p>(\u201c)/g, '<p class="q">$1');
  // Wrap the opening words of the first paragraph for a small-caps lead-in:
  // up to five words, stopping early at a sentence or clause end.
  out = out.replace(/^<p( class="q")?>([^<]*)/, (m, cls, text) => {
    const head = text.split(/[\u2009\u202f]?\u2014/)[0]; // stop before a dash
    const words = head.split(' ');
    let n = 0;
    while (n < Math.min(5, head === text ? words.length - 1 : words.length)) { n++; if (/[.,;:!?”]$/.test(words[n - 1])) break; }
    const lead = words.slice(0, n).join(' ');
    return `<p class="first"><span class="lead">${lead}</span>${text.slice(lead.length)}`;
  });
  return out;
}

// --- treatments -----------------------------------------------------------

const PAPER = 'oklch(0.99 0.006 85)';
const INK = 'oklch(0.24 0.01 264)';

const BASE = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { background: ${PAPER}; color: ${INK}; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
body { min-height: 100vh; }
a { color: inherit; }
::selection { background: oklch(0.88 0.1 24 / 0.5); }
.lab { position: absolute; top: 0.9rem; right: 1rem; font-size: 13px; letter-spacing: 0.02em; color: oklch(0.55 0.01 264); }
.lab a { text-decoration: none; margin-left: 0.7em; }
.lab a[aria-current] { color: ${INK}; border-bottom: 1px solid currentColor; }
.story p { orphans: 2; widows: 2; }
.story img { display: block; max-width: 100%; height: auto; margin: 1em auto; }
`;

const VARIANTS = {
  a: {
    name: 'Book page',
    face: 'EB Garamond',
    blurb: 'EB Garamond at 21 px on a justified, hyphenated 62-character line (ragged on phones) with 1 em indents, a sunk chapter opening, a three-line drop cap and a small-caps lead-in. The printed novel, carried over whole.',
    css: `
body { font-family: 'EB Garamond', serif; font-kerning: normal; font-variant-ligatures: common-ligatures; font-variant-numeric: oldstyle-nums proportional-nums; }
.lab { font-variant: small-caps; font-size: 15px; letter-spacing: 0.06em; }
.page { max-width: 29em; margin: 0 auto; padding: max(14vh, 5rem) 1.25rem 22vh; font-size: clamp(19px, 0.9rem + 0.45vw, 21.5px); }
.head { text-align: center; margin-bottom: 3.2em; }
.head h1 { font-weight: 400; font-size: 1.55em; line-height: 1.2; text-transform: uppercase; letter-spacing: 0.16em; margin-right: -0.16em; text-wrap: balance; }
.head .by { margin-top: 0.9em; font-style: italic; font-size: 0.95em; }
.head .orn { display: block; margin: 1.6em auto 0; width: 2.4em; border-top: 1px solid currentColor; opacity: 0.55; }
.story { line-height: 1.5; text-align: justify; hyphens: auto; -webkit-hyphens: auto; hyphenate-limit-chars: 6 3 2; text-wrap: pretty; }
.story p { text-indent: 1em; hanging-punctuation: first; }
.story p.first, .story hr + p, .story :is(h1,h2,h3,blockquote) + p { text-indent: 0; }
.story .lead { font-variant-caps: all-small-caps; letter-spacing: 0.07em; font-feature-settings: 'c2sc', 'smcp'; }
.story p.first .lead { font-variant-caps: small-caps; font-feature-settings: 'smcp'; }
.story .caps { font-variant-caps: all-small-caps; letter-spacing: 0.06em; }
.story p.first::first-letter { initial-letter: 3; -webkit-initial-letter: 3; margin-right: 0.1em; font-variant-caps: normal; letter-spacing: 0; font-weight: 400; }
@supports not ((initial-letter: 3) or (-webkit-initial-letter: 3)) {
  .story p.first::first-letter { float: left; font-size: 3.9em; line-height: 0.8; margin: 0.06em 0.08em 0 0; }
}
.story hr { border: 0; margin: 1.5em 0; height: 1.5em; text-align: center; overflow: visible; }
.story hr::before { content: '*\\2002*\\2002*'; letter-spacing: 0.1em; }
.story i, .story em { font-style: italic; }
.end { margin-top: 2.4em; text-align: center; letter-spacing: 0.5em; opacity: 0.6; }
@media (max-width: 520px) {
  .page { padding-top: 4.5rem; padding-inline: 1.15rem; }
  /* Browsers justify greedily, line by line; at ~43 characters that opens
     visible gaps, so the phone page goes ragged and keeps the hyphenation. */
  .story { text-align: left; hyphenate-limit-chars: 7 3 3; }
}`,
    end: '<p class="end" aria-hidden="true">· · ·</p>',
  },
  b: {
    name: 'Screen literary',
    face: 'Literata',
    blurb: 'Literata (the Google Play Books face) with optical sizes, 20 px on a 1.62 leading, ragged right with sparing hyphenation, about 62 characters, plain 1.5 em indents, no ornament, a thin scroll-linked progress line. A book set for the screen rather than imitating paper.',
    css: `
body { font-family: 'Literata', serif; font-optical-sizing: auto; font-kerning: normal; font-variant-numeric: oldstyle-nums proportional-nums; }
.progress { position: fixed; inset: 0 0 auto 0; height: 2px; background: oklch(0.45 0.17 26); transform-origin: 0 50%; transform: scaleX(0); z-index: 2; }
@supports (animation-timeline: scroll()) {
  .progress { animation: grow linear both; animation-timeline: scroll(root); }
  @keyframes grow { to { transform: scaleX(1); } }
}
.page { max-width: 34em; margin: 0 auto; padding: max(12vh, 4.5rem) 1.3rem 24vh; font-size: clamp(18px, 0.85rem + 0.5vw, 20.5px); }
.head { margin-bottom: 2.6em; }
.head h1 { font-size: 2.6em; font-weight: 340; line-height: 1.04; letter-spacing: -0.012em; text-wrap: balance; }
.head .by { margin-top: 0.8em; font-size: 0.82em; color: oklch(0.45 0.01 264); }
.head .by i { font-style: italic; }
.story { line-height: 1.62; font-weight: 400; hyphens: auto; -webkit-hyphens: auto; hyphenate-limit-chars: 9 4 4; hyphenate-limit-lines: 1; text-wrap: pretty; }
.story p { text-indent: 1.5em; }
.story .caps { font-variant-caps: all-small-caps; letter-spacing: 0.05em; }
.story p.first, .story hr + p, .story :is(h1,h2,h3,blockquote) + p { text-indent: 0; }
.story hr { border: 0; height: 0; margin: 2.1em auto; width: 3em; border-top: 1px solid oklch(0.7 0.01 264); }
.end { margin-top: 2.2em; width: 0.45em; height: 0.45em; background: oklch(0.45 0.17 26); border-radius: 50%; }
@media (max-width: 520px) {
  .head h1 { font-size: 2.2em; }
  .story p { text-indent: 1.2em; }
}`,
    end: '<p class="end" aria-hidden="true"></p>',
    before: '<div class="progress" aria-hidden="true"></div>',
  },
  c: {
    name: 'Editorial',
    face: 'Alegreya Sans + Instrument Serif',
    blurb: 'A magazine feature: a large Instrument Serif title held in a sticky left column on wide screens, story text in Alegreya Sans (a humanist sans drawn for long literature) at 21 px, a larger lede, spaced paragraphs, flush-left, dialogue quotes hung in the margin.',
    css: `
body { font-family: 'Alegreya Sans', sans-serif; font-kerning: normal; font-variant-numeric: oldstyle-nums proportional-nums; }
.lab { font-family: 'Alegreya Sans', sans-serif; }
.page { padding: max(10vh, 4.5rem) 1.3rem 22vh; font-size: clamp(19px, 1rem + 0.4vw, 21.5px); }
.head { container-type: inline-size; }
.head h1 { font-family: 'Instrument Serif', serif; font-weight: 400; font-size: clamp(2.6rem, 19cqi, 5.6rem); hyphens: none; line-height: 0.92; letter-spacing: -0.015em; text-wrap: balance; }
.head .by span { display: block; }
.head .by { margin-top: 1.1rem; font-size: 0.74em; line-height: 1.6; font-weight: 500; letter-spacing: 0.09em; text-transform: uppercase; color: oklch(0.5 0.01 264); }
.head .rule { margin-top: 1.4rem; height: 3px; width: 3.5rem; background: oklch(0.45 0.17 26); }
.story { max-width: 29em; margin-top: 2.6em; line-height: 1.52; hyphens: manual; text-wrap: pretty; }
.story p + p { margin-top: 0.62em; }
.story p.q { text-indent: -0.42em; }
.story .caps { letter-spacing: 0.03em; }
.story p.first { font-size: 1.12em; line-height: 1.45; margin-bottom: 1em; }
.story p.first .lead { font-weight: 700; }
.story hr { border: 0; height: 1px; background: ${INK}; margin: 2.2em 0 2em; width: 100%; }
.story i, .story em { font-style: italic; }
.end { margin-top: 1.6em; width: 0.6em; height: 0.6em; background: ${INK}; }
@media (min-width: 1000px) {
  .page { display: grid; grid-template-columns: minmax(17rem, 1fr) minmax(0, 29em) minmax(2rem, 0.5fr); column-gap: clamp(2.5rem, 5vw, 5rem); padding-top: 18vh; }
  .head { grid-column: 1; text-align: right; position: sticky; top: 18vh; align-self: start; }
  .head .rule { margin-left: auto; }
  .story p.first { font-size: 1.24em; }
  .story { grid-column: 2; margin-top: 0; }
  .end { grid-column: 2; }
}`,
    end: '<p class="end" aria-hidden="true"></p>',
  },
};

function page(story, key, files, faces) {
  const v = VARIANTS[key];
  const nav = Object.keys(VARIANTS).map(k =>
    `<a href="${files[k]}"${k === key ? ' aria-current="page"' : ''}>${k.toUpperCase()}</a>`).join('') +
    `<a href="../${story.slug}.html">current</a><a href="index.html">lab</a>`;
  const by = story.when ? `Tomás Bjartur · <i>${story.when}</i>` : 'Tomás Bjartur';
  const head = key === 'c'
    ? `<header class="head"><h1>${story.title}</h1><p class="by"><span>Tomás Bjartur</span><span>${story.when}</span></p><div class="rule"></div></header>`
    : key === 'a'
      ? `<header class="head"><h1>${story.title}</h1><p class="by">Tomás Bjartur</p><span class="orn"></span></header>`
      : `<header class="head"><h1>${story.title}</h1><p class="by">${by}</p></header>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${story.title} — ${key.toUpperCase()}: ${v.name} — reading lab</title>
<style>
${faces}
${BASE}
${v.css}
</style>
</head>
<body>
${v.before || ''}
<nav class="lab" aria-label="Reading lab">${nav}</nav>
<main class="page">
${head}
<article class="story">
${story.body}
</article>
${v.end}
</main>
</body>
</html>
`;
}

function indexPage(stories, faces) {
  const rows = Object.entries(VARIANTS).map(([k, v]) =>
    `<li><h2><a href="${k}.html">${k.toUpperCase()} · ${v.name}</a></h2><p class="face">${v.face}</p><p>${v.blurb}</p></li>`).join('\n');
  const others = stories.slice(1).map(s =>
    `<li>${s.title}: ${Object.keys(VARIANTS).map(k => `<a href="${s.slug}-${k}.html">${k.toUpperCase()}</a>`).join(' · ')} · <a href="../${s.slug}.html">current</a></li>`).join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Reading lab</title>
<style>
${faces}
${BASE}
body { font-family: 'Literata', serif; font-optical-sizing: auto; }
main { max-width: 36rem; margin: 0 auto; padding: 4.5rem 1.3rem 6rem; font-size: 18px; line-height: 1.5; }
h1 { font-weight: 340; font-size: 2.3rem; line-height: 1.1; }
.intro { margin: 0.8rem 0 2.2rem; color: oklch(0.42 0.01 264); }
ol { list-style: none; }
li + li { margin-top: 1.6rem; }
h2 { font-weight: 500; font-size: 1.25rem; }
h2 a { text-decoration-thickness: 1px; text-underline-offset: 0.18em; }
.face { font-size: 0.85rem; color: oklch(0.5 0.01 264); margin: 0.15rem 0 0.35rem; }
h3 { margin-top: 2.6rem; font-weight: 500; font-size: 1.05rem; }
ul { margin-top: 0.5rem; padding-left: 1.1rem; }
ul li + li { margin-top: 0.3rem; }
</style>
</head>
<body>
<main>
<h1>Reading lab</h1>
<p class="intro"><i>${stories[0].title}</i>, set three ways. Compare against <a href="../${stories[0].slug}.html">the current page</a>. Every face is served from this folder.</p>
<ol>
${rows}
</ol>
<h3>Same treatments, other stories</h3>
<ul>
${others}
</ul>
</main>
</body>
</html>
`;
}

(async () => {
  const faces = await fontFaces();
  const stories = SLUGS.map(readStory);
  stories.forEach((s, i) => {
    const files = Object.fromEntries(Object.keys(VARIANTS).map(k => [k, i === 0 ? `${k}.html` : `${s.slug}-${k}.html`]));
    for (const k of Object.keys(VARIANTS)) {
      fs.writeFileSync(path.join(OUT, files[k]), page(s, k, files, faces));
      console.log('wrote', path.relative(DIST, path.join(OUT, files[k])));
    }
  });
  fs.writeFileSync(path.join(OUT, 'index.html'), indexPage(stories, faces));
  console.log('wrote reading-lab/index.html');
})().catch(e => { console.error(e); process.exit(1); });
