// Checks the title hover morph in a real browser engine.
//
//   node scripts/hover-check.mjs <chrome|firefox|webkit> [base-url]
//
// Serve dist/ first and install the engines as for initials-check.mjs (its
// header says how). At three desktop widths it hovers every title in the
// contents list and the newer/older links on every story page, waits for
// the morph to finish, and compares the mono text with the resting title.
// The morph takes the geometric mean of the sizes that match the title's
// width and its letter height (x-height and capitals averaged), so:
// - width times letter height must be within 3% of the title's (unless the
//   text had to shrink to fit its room, which is listed instead), and
//   neither more than 40% off;
// - a wrapped title's words may not grow;
// - the title's row must not move.
// Exits 1 on any failure.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const [engine, base = 'http://localhost:8787/'] = process.argv.slice(2);
if (!['chrome', 'firefox', 'webkit'].includes(engine)) {
  console.error('usage: node scripts/hover-check.mjs <chrome|firefox|webkit> [base-url]');
  process.exit(2);
}
const pwDir = process.env.PLAYWRIGHT_DIR;
const require = createRequire(pwDir ? path.join(path.resolve(pwDir), 'index.js') : import.meta.url);
let pw;
try { pw = require('playwright'); } catch {
  console.error('playwright not found: set PLAYWRIGHT_DIR to a directory where it is installed (see initials-check.mjs)');
  process.exit(2);
}

const dist = new URL('../dist/', import.meta.url);
const stories = fs.readdirSync(dist).filter(f => f.endsWith('.html') &&
  fs.readFileSync(new URL(f, dist), 'utf8').includes('class="post-nav"'));
if (!stories.length) { console.error('no story pages in dist/: run node build.js'); process.exit(2); }
const sizes = [[1440, 900], [1024, 768], [700, 900]];
const TOL = 0.03, FAR = 0.4;

// "chrome" is the installed Google Chrome, driven by Playwright.
const browser = engine === 'chrome' ? await pw.chromium.launch({ channel: 'chrome' }) : await pw[engine].launch();

// Hovers each title matching sel in turn; returns hovered/resting ratios.
const HOVER = async sel => {
  if (!matchMedia('(hover: hover)').matches) return 'no hover: the morph does not run';
  await document.fonts.ready;
  const cx = document.createElement('canvas').getContext('2d');
  const up = (f, s) => { cx.font = f; return cx.measureText(s).actualBoundingBoxAscent; };
  const height = (f, t) => { const xs = (t.match(/[acemnorsuvwxz]/g) || []).join('') || t; return (up(f, xs) + up(f, t)) / 2; };
  const width = e => { const r = document.createRange(); r.selectNodeContents(e); return r.getBoundingClientRect().width; };
  const out = [];
  for (const a of document.querySelectorAll(sel)) {
    const t = a.textContent, cs = getComputedStyle(a), row = a.closest('.story, .post-nav');
    const w0 = width(a), h0 = height(`${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`, t);
    const r0 = row.getBoundingClientRect();
    a.dispatchEvent(new MouseEvent('mouseenter'));
    const done = () => a.querySelector('.mi') && !a.querySelector('.mi .w > span:not(.mm)');
    for (const t0 = performance.now(); !done() && performance.now() - t0 < 3000;) await new Promise(r => setTimeout(r, 16));
    if (!done()) { out.push({ t, err: 'the morph did not finish' }); continue; }
    await document.fonts.ready;
    const mm = getComputedStyle(a.querySelector('.mm')), r1 = row.getBoundingClientRect();
    const words = a.classList.contains('pinned') ? null
      : [...a.querySelectorAll('.w')].map(w => width(w) / parseFloat(w.style.getPropertyValue('--w')));
    const fit = parseFloat(a.style.getPropertyValue('--mfit')) < parseFloat(a.style.getPropertyValue('--mono-size'));
    out.push({ t, wrapped: !!words, fit, w: words ? Math.max(...words) : width(a.querySelector('.mi')) / w0,
      h: height(`${mm.fontWeight} ${mm.fontSize} ${mm.fontFamily}`, t) / h0,
      moved: Math.max(Math.abs(r1.top - r0.top), Math.abs(r1.height - r0.height)) });
    a.dispatchEvent(new MouseEvent('mouseleave'));
  }
  return out;
};

let checked = 0; const worstW = [0, 0], worstH = [0, 0];
const failures = [], shrunk = [];
for (const [w, h] of sizes) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  page.on('crash', () => { console.error(`${engine} ${w}px: the page crashed`); process.exit(2); });
  if (engine === 'chrome') await (await ctx.newCDPSession(page)).send('Emulation.setEmulatedMedia', { features: [{ name: 'hover', value: 'hover' }] });
  for (const [file, sel] of [['index.html', '.stories .morph'], ...stories.map(s => [s, '.post-nav .morph'])]) {
    await page.goto(new URL(file, base).href, { waitUntil: 'load' });
    const res = await page.evaluate(HOVER, sel);
    if (typeof res === 'string') { console.error(`${engine} ${w}px ${file}: ${res}`); process.exit(2); }
    for (const r of res) {
      checked++;
      if (r.err) { failures.push(`${w}px ${file} "${r.t}": ${r.err}`); continue; }
      worstW[0] = Math.max(worstW[0], 1 - r.w); worstW[1] = Math.max(worstW[1], r.w - 1);
      worstH[0] = Math.max(worstH[0], 1 - r.h); worstH[1] = Math.max(worstH[1], r.h - 1);
      const why = [r.wrapped ? r.w > 1.02 && `a word grew ${r.w.toFixed(3)}x`
          : !r.fit && Math.abs(r.w * r.h - 1) > TOL && `width x height ${(r.w * r.h).toFixed(3)}`,
        Math.abs(r.w - 1) > FAR && `width ${r.w.toFixed(3)}x`,
        !r.fit && Math.abs(r.h - 1) > FAR && `letter height ${r.h.toFixed(3)}x`,
        r.moved > 0.5 && `row moved ${r.moved.toFixed(1)}px`].filter(Boolean);
      if (r.fit) shrunk.push(`${w}px ${file} "${r.t}": shrunk to its room, letter height ${r.h.toFixed(2)}x`);
      if (why.length) failures.push(`${w}px ${file} "${r.t}": ${why.join('; ')}`);
    }
  }
  await ctx.close();
}
await browser.close();

console.log(`${engine}: ${checked} hovers (list and newer/older on ${stories.length} stories) at ${sizes.map(s => s[0]).join(', ')}px;` +
  ` width ${(1 - worstW[0]).toFixed(2)}-${(1 + worstW[1]).toFixed(2)}x, height ${(1 - worstH[0]).toFixed(2)}-${(1 + worstH[1]).toFixed(2)}x`);
for (const f of shrunk) console.log(`  · ${f}`);
for (const f of failures) console.log(`  ✗ ${f}`);
console.log(failures.length ? `FAIL (${failures.length})` : 'PASS');
process.exit(failures.length ? 1 : 0);
