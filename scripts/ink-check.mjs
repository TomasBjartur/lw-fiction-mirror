// Checks that the site's text is actually drawn, in a real browser engine.
//
//   node scripts/ink-check.mjs <chrome|firefox|webkit> [base-url]
//
// Serve dist/ first and install the engines as for initials-check.mjs (its
// header says how). The other checks measure boxes, and a colour font an engine
// cannot draw still has its full width: Safari showed three titles as nothing
// while every check passed. So this one reads pixels. On the contents page and
// /title-fonts/, at a desktop and a phone width, every title, specimen, date and
// count must put ink on its own box, and a face must have loaded for its title.
// A colour face must also draw in colour, since a wrong table choice draws it
// black (Firefox, on an OpenType SVG Bitcount).
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
const PAGES = [
  ['', '.story-title', true],
  ['', '.story .when, .story .n, .site-h1, .bk-title', false],
  ['title-fonts/', '.tf-specimen', true],
];
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

// One screenshot per page and size, read once: the page's ground colour is
// its top-left pixel, and ink is whatever differs from that.
function inkIn(data, W, H, box, ground, dpr) {
  const x0 = Math.max(0, Math.floor(box.x * dpr)), y0 = Math.max(0, Math.floor(box.y * dpr));
  const x1 = Math.min(W, Math.ceil((box.x + box.w) * dpr)), y1 = Math.min(H, Math.ceil((box.y + box.h) * dpr));
  let ink = 0, colour = 0, total = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * W + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
    total++;
    if (Math.abs(r - ground[0]) + Math.abs(g - ground[1]) + Math.abs(b - ground[2]) > 60) {
      ink++;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 70) colour++;
    }
  }
  return { ink: total ? ink / total : 0, colour: total ? colour / total : 0 };
}

const browser = engine === 'chrome' ? await pw.chromium.launch({ channel: 'chrome' }) : await pw[engine].launch();
const failures = [];
let checked = 0;
for (const [w, h] of [[1280, 800], [393, 659]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await ctx.route(/ipapi\.co/, r => r.abort());  // fresh profiles would spend the readers' geo lookups
  const page = await ctx.newPage();
  for (const file of new Set(PAGES.map(p => p[0]))) {
    await page.goto(new URL(file, base).href, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => Promise.all([...document.fonts].map(f => f.load().catch(() => {}))));
    const img = await loadImage(await page.screenshot({ fullPage: true }));
    const cv = createCanvas(img.width, img.height), cx = cv.getContext('2d');
    cx.drawImage(img, 0, 0);
    const { data } = cx.getImageData(0, 0, img.width, img.height);
    const ground = [data[0], data[1], data[2]];
    for (const [, sel, ownFace] of PAGES.filter(p => p[0] === file)) {
      const items = await page.evaluate(COLLECT, sel);
      if (!items.length) failures.push(`${w}px /${file} ${sel}: no elements`);
      for (const it of items) {
        checked++;
        const { ink, colour } = inkIn(data, img.width, img.height, it, ground, 2);
        const where = `${w}px /${file} "${it.text}" (${it.family})`;
        if (ownFace && !it.loaded) failures.push(`${where}: its face did not load`);
        if (ink < MIN_INK) failures.push(`${where}: blank, ${(ink * 100).toFixed(2)}% ink`);
        else if (colourFamilies.has(it.family) && !GREY_PALETTE.has(it.text) && colour < MIN_COLOUR) failures.push(`${where}: no colour, ${(colour * 100).toFixed(2)}%`);
      }
    }
  }
  await ctx.close();
}
await browser.close();

console.log(`${engine}: ${checked} boxes, ${colourFamilies.size} colour faces`);
for (const f of failures) console.log(`  ✗ ${f}`);
console.log(failures.length ? `FAIL (${failures.length})` : 'PASS');
process.exit(failures.length ? 1 : 0);
