// Checks every story's initials in a real browser engine.
//
//   node scripts/initials-check.mjs <chrome|firefox|webkit> [base-url] [clip-dir]
//
// Serve dist/ first (e.g. `python3 -m http.server 8787 -d dist`; the base
// URL defaults to http://localhost:8787/). Firefox and WebKit come from
// Playwright, kept out of package.json so CI's `npm ci` and the native
// canvas build stay untouched: install it in any other directory and point
// PLAYWRIGHT_DIR there.
//
//   mkdir -p ~/.cache/pw && cd ~/.cache/pw && bun add playwright && bunx playwright install firefox webkit
//   PLAYWRIGHT_DIR=~/.cache/pw node scripts/initials-check.mjs webkit
//
// "chrome" drives the installed Google Chrome (Playwright channel "chrome").
// macOS quits a Chrome that has never shown a window 30 s after it starts, whatever
// it is doing (loginwindow logs "is not allowed to run non-foreground and has never
// been user-visible"), so a check must replace its browser well before that.
//
// At a desktop and a phone width, for each .first/.sect paragraph:
// - the next paragraph must start at its own indent, not pushed right by
//   an initial reaching down from a short paragraph above;
// - the paragraph must be at least as tall as its initial;
// - copying the paragraph must give its text: the opening quote, and the
//   space after a one-letter first word (word joiners aside).
// With a clip directory it also saves clips of reference spots to look at.
// Exits 1 on any failure.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const [engine, base = 'http://localhost:8787/', clips] = process.argv.slice(2);
if (!['chrome', 'firefox', 'webkit'].includes(engine)) {
  console.error('usage: node scripts/initials-check.mjs <chrome|firefox|webkit> [base-url] [clip-dir]');
  process.exit(2);
}
const pwDir = process.env.PLAYWRIGHT_DIR;
const require = createRequire(pwDir ? path.join(path.resolve(pwDir), 'index.js') : import.meta.url);
let pw;
try { pw = require('playwright'); } catch {
  console.error('playwright not found: set PLAYWRIGHT_DIR to a directory where it is installed (see the header)');
  process.exit(2);
}

const dist = new URL('../dist/', import.meta.url);
const stories = fs.readdirSync(dist, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => `${d.name}/`)
  .filter(s => fs.existsSync(new URL(`${s}index.html`, dist)) &&
    fs.readFileSync(new URL(`${s}index.html`, dist), 'utf8').includes('class="post-body"'));
if (!stories.length) { console.error('no story pages in dist/: run node build.js'); process.exit(2); }
const sizes = [[1024, 800], [390, 664]];

// "chrome" is the installed Google Chrome, driven by Playwright.
const browser = engine === 'chrome' ? await pw.chromium.launch({ channel: 'chrome' }) : await pw[engine].launch();

const CHECK = () => {
  const texts = el => { const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), out = [];
    while (tw.nextNode()) if (tw.currentNode.data.trim()) out.push(tw.currentNode); return out; };
  const charRect = (t, i) => { const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + 1); return r.getBoundingClientRect(); };
  return [...document.querySelectorAll('.post-body p.first, .post-body p.sect')].map(p => {
    const need = p.classList.contains('first') ? 3 : 2;
    const lh = parseFloat(getComputedStyle(p).lineHeight);
    const pr = p.getBoundingClientRect();
    const last = texts(p).at(-1);
    const lines = Math.round((charRect(last, last.data.trimEnd().length - 1).bottom - pr.top) / lh);
    let push = null;
    const nx = p.nextElementSibling;
    if (nx && nx.tagName === 'P') {
      const t = texts(nx)[0]; const i = t.data.search(/[^ \t\n\r]/);
      push = Math.round(charRect(t, i).left - nx.getBoundingClientRect().left - parseFloat(getComputedStyle(nx).textIndent));
    }
    const norm = s => s.replace(/\u2060/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
    getSelection().selectAllChildren(p); const copy = norm(getSelection().toString()); getSelection().removeAllRanges();
    return { cls: p.className, text: p.textContent.trim().slice(0, 30), lines, need, rows: +(pr.height / lh).toFixed(2), push, copy: copy === norm(p.textContent) ? null : copy };
  });
};

const clip = async (page, sel, file, rows) => {
  const box = await page.evaluate(([sel, rows]) => {
    const p = document.querySelector(sel); if (!p) return null;
    p.scrollIntoView({ block: 'center' });
    const r = p.getBoundingClientRect(); const lh = parseFloat(getComputedStyle(p).lineHeight);
    return { x: Math.max(0, r.left - 24 + scrollX), y: r.top - 12 + scrollY, width: r.width + 48, height: lh * rows + 24 };
  }, [sel, rows]);
  if (box) await page.screenshot({ path: file, clip: box, fullPage: true });
};

let checked = 0;
const failures = [];
for (const [w, h] of sizes) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await ctx.route(/ipapi\.co/, r => r.abort());  // fresh profiles would spend the readers' geo lookups
  const page = await ctx.newPage();
  const load = async s => { await page.goto(new URL(s, base).href, { waitUntil: 'load' }); await page.evaluate(() => document.fonts.ready.then(() => 1)); };
  for (const s of stories) {
    await load(s);
    for (const r of await page.evaluate(CHECK)) {
      checked++;
      const why = [r.push !== null && r.push > 4 && `next paragraph pushed ${r.push}px`,
        r.rows < r.need - 0.01 && `paragraph ${r.rows} lines tall for a ${r.need}-line initial`,
        r.copy !== null && `copies as "${r.copy}"`].filter(Boolean);
      if (why.length) failures.push(`${w}px ${s} ${r.cls} "${r.text}": ${why.join('; ')}`);
    }
  }
  if (clips) {
    fs.mkdirSync(clips, { recursive: true });
    const tag = path.join(clips, `${engine}-${w}`);
    await load('the-company-man/');
    await clip(page, 'p.first', `${tag}-open.png`, 4);
    await clip(page, 'p.sect', `${tag}-sect.png`, 3);
    await load('goldfish/');
    await clip(page, 'p.first', `${tag}-short.png`, 5);
    await load('the-origami-men/');
    await clip(page, 'p.oq', `${tag}-quote.png`, 3);
  }
  await ctx.close();
}
await browser.close();

console.log(`${engine}: ${checked} initials on ${stories.length} stories at ${sizes.map(s => s[0]).join(' and ')}px`);
for (const f of failures) console.log(`  ✗ ${f}`);
console.log(failures.length ? `FAIL (${failures.length})` : 'PASS');
process.exit(failures.length ? 1 : 0);
