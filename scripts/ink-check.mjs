// Checks that the site's text is actually drawn, in a real browser engine.
//
//   node scripts/ink-check.mjs <chrome|firefox|webkit> [base-url]
//
// Serve dist/ first and install the engines as for initials-check.mjs (its
// header says how). The other checks measure boxes, and a colour font an engine
// cannot draw still has its full width: Safari showed three titles as nothing
// while every check passed. So this one reads pixels. At a desktop and a phone
// width, every title, specimen, date and count on the contents page and
// /title-fonts/, and the title on every story, must put ink on its own box, and
// a face must have loaded for its title.
// A colour face must also draw in colour, since a wrong table choice draws it
// black (Firefox, on an OpenType SVG Bitcount). An item's ink is what changes
// when it is hidden: boxes overlap their neighbours' letters, so counting
// everything off the page colour let a blank title pass on the row beside it.
// Exits 1 on any failure.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { loadImage, createCanvas } from 'canvas';

const [engine, base = 'http://localhost:8787/'] = process.argv.slice(2);
if (!['chrome', 'firefox', 'webkit'].includes(engine)) {
  console.error('usage: node scripts/ink-check.mjs <chrome|firefox|webkit> [base-url]');
  process.exit(2);
}
const pwDir = process.env.PLAYWRIGHT_DIR;
const require = createRequire(pwDir ? path.join(path.resolve(pwDir), 'index.js') : import.meta.url);
let pw;
try { pw = require('playwright'); } catch {
  console.error('playwright not found: set PLAYWRIGHT_DIR to a directory where it is installed (see initials-check.mjs)');
  process.exit(2);
}

// Colour faces, as the build declared them: the families with a tech() source.
const colourFamilies = new Set();
for (const css of ['titles.css', 'title-fonts.css']) {
  const text = fs.readFileSync(new URL(`../dist/${css}`, import.meta.url), 'utf8');
  for (const m of text.matchAll(/@font-face\{font-family:'([^']+)';src:[^;]*tech\(color-COLRv1\)/g)) colourFamilies.add(m[1]);
}
if (!colourFamilies.size) { console.error('no colour faces in dist/: run node build.js'); process.exit(2); }

// [page, the things on it that must show ink, whether each must load its own face]
const dist = new URL('../dist/', import.meta.url);
const stories = fs.readdirSync(dist, { withFileTypes: true })
  .filter(d => d.isDirectory() && fs.existsSync(new URL(`${d.name}/index.html`, dist))
    && fs.readFileSync(new URL(`${d.name}/index.html`, dist), 'utf8').includes('class="post-nav"'))
  .map(d => `${d.name}/`);
if (!stories.length) { console.error('no story pages in dist/: run node build.js'); process.exit(2); }
const PAGES = [
  ['', '.story-title', true],
  ['', '.story .when, .story .n, .site-h1, .bk-title', false],
  ['title-fonts/', '.tf-specimen', true],
  ...stories.map(s => [s, '.post-header .morph', true]),
];
// A story is long and its title is at the top, so only the first screen is read.
const WHOLE_PAGE = new Set(['', 'title-fonts/']);
const MIN_INK = 0.015, MIN_COLOUR = 0.01;  // shares of the box's pixels
// Foldit's own palette is three greys, so it has no colour to lose. If a story
// takes it from the backlog, add that story's title here.
const GREY_PALETTE = new Set(['Foldit']);

// Each element's text box, its face and whether that face loaded.
const COLLECT = sel => [...document.querySelectorAll(sel)].filter(e => e.offsetParent !== null).map(e => {
  const r = document.createRange(); r.selectNodeContents(e);
  const b = r.getBoundingClientRect(), cs = getComputedStyle(e);
  const family = cs.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
  const faces = [...document.fonts].filter(f => f.family.replace(/^["']|["']$/g, '') === family);
  return { text: e.textContent.trim().slice(0, 40), x: b.left + scrollX, y: b.top + scrollY, w: b.width, h: b.height, family,
    loaded: faces.length > 0 && faces.some(f => f.status === 'loaded') };
});

// Pixels of the box that differ between the page as shown and with the item
// hidden; the colourful ones among them are its colour.
function inkIn(shown, hidden, W, H, box, dpr) {
  const x0 = Math.max(0, Math.floor(box.x * dpr)), y0 = Math.max(0, Math.floor(box.y * dpr));
  const x1 = Math.min(W, Math.ceil((box.x + box.w) * dpr)), y1 = Math.min(H, Math.ceil((box.y + box.h) * dpr));
  let ink = 0, colour = 0, total = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * W + x) * 4, r = shown[i], g = shown[i + 1], b = shown[i + 2];
    total++;
    if (Math.abs(r - hidden[i]) + Math.abs(g - hidden[i + 1]) + Math.abs(b - hidden[i + 2]) > 60) {
      ink++;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 70) colour++;
    }
  }
  return { ink: total ? ink / total : 0, colour: total ? colour / total : 0 };
}

async function pixels(page, fullPage) {
  const img = await loadImage(await page.screenshot({ fullPage }));
  const cv = createCanvas(img.width, img.height), cx = cv.getContext('2d');
  cx.drawImage(img, 0, 0);
  return { data: cx.getImageData(0, 0, img.width, img.height).data, W: img.width, H: img.height };
}

// Hides or shows every other item of a selector, so that an item's neighbours
// in the list stay drawn while it is hidden.
const SET_HIDDEN = ([sel, half, hide]) => {
  [...document.querySelectorAll(sel)].filter(e => e.offsetParent !== null).forEach((e, i) => {
    if (i % 2 === half) e.style.visibility = hide ? 'hidden' : '';
  });
};

// "chrome" is the installed Google Chrome, driven by Playwright. macOS quits it
// 30 s after it starts (see initials-check.mjs), so a browser older than LIFE_MS
// is replaced before the next page; the slowest page takes about 10 s.
const launch = () => engine === 'chrome' ? pw.chromium.launch({ channel: 'chrome' }) : pw[engine].launch();
const LIFE_MS = 15000;
const failures = [];
let checked = 0;
for (const [w, h] of [[1280, 800], [393, 659]]) {
  let browser = null, page = null, born = 0;
  for (const file of new Set(PAGES.map(p => p[0]))) {
    if (Date.now() - born > LIFE_MS) {
      await browser?.close();
      browser = await launch();
      born = Date.now();
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
      await ctx.route(/ipapi\.co/, r => r.abort());  // fresh profiles would spend the readers' geo lookups
      page = await ctx.newPage();
    }
    const fullPage = WHOLE_PAGE.has(file);
    await page.goto(new URL(file, base).href, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => Promise.all([...document.fonts].map(f => f.load().catch(() => {}))));
    const shown = await pixels(page, fullPage);
    for (const [, sel, ownFace] of PAGES.filter(p => p[0] === file)) {
      const items = await page.evaluate(COLLECT, sel);
      if (!items.length) failures.push(`${w}px /${file} ${sel}: no elements`);
      for (const half of [0, 1]) {
        await page.evaluate(SET_HIDDEN, [sel, half, true]);
        const hidden = await pixels(page, fullPage);
        await page.evaluate(SET_HIDDEN, [sel, half, false]);
        items.forEach((it, i) => {
          if (i % 2 !== half) return;
          checked++;
          const { ink, colour } = inkIn(shown.data, hidden.data, shown.W, shown.H, it, 2);
          const where = `${w}px /${file} "${it.text}" (${it.family})`;
          if (ownFace && !it.loaded) failures.push(`${where}: its face did not load`);
          if (ink < MIN_INK) failures.push(`${where}: blank, ${(ink * 100).toFixed(2)}% ink`);
          else if (colourFamilies.has(it.family) && !GREY_PALETTE.has(it.text) && colour < MIN_COLOUR) failures.push(`${where}: no colour, ${(colour * 100).toFixed(2)}%`);
        });
      }
    }
  }
  await browser.close();
}

console.log(`${engine}: ${checked} boxes, ${colourFamilies.size} colour faces`);
for (const f of failures) console.log(`  ✗ ${f}`);
console.log(failures.length ? `FAIL (${failures.length})` : 'PASS');
process.exit(failures.length ? 1 : 0);
