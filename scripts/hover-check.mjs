// Checks the title hover morph in a real browser engine.
//
//   node scripts/hover-check.mjs <chrome|firefox|webkit> [base-url]
//
// Serve dist/ first and install the engines as for initials-check.mjs (its
// header says how). At three desktop widths it hovers every title in the
// contents list and the newer/older links on every story page, waits for
// the morph to finish, and compares the Inconsolata text with the resting
// title:
// - its width must be within 2% of the title's (a wrapped title: each
//   word's, and no word may grow);
// - its letter height (x-height and capitals averaged) within 2%;
// - the title's row must not move.
// Exits 1 on any failure.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
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
const TOL = 0.02;

let browser;
if (engine === 'chrome') {
  execSync('agent-browser open about:blank');
  const http = execSync('agent-browser get cdp-url', { encoding: 'utf8' }).trim()
    .replace(/^"|"$/g, '').replace(/^ws/, 'http').replace(/\/devtools\/.*$/, '');
  browser = await pw.chromium.connectOverCDP(http);
} else {
  browser = await pw[engine].launch();
}

// Hovers each title matching sel in turn; returns hovered/resting ratios.
const HOVER = async sel => {
  if (!matchMedia('(hover: hover)').matches) return 'no hover: the morph does not run';
  await document.fonts.load('1em "Hover Mono"'); await document.fonts.ready;
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
    const mm = getComputedStyle(a.querySelector('.mm')), r1 = row.getBoundingClientRect();
    const words = a.classList.contains('pinned') ? null
      : [...a.querySelectorAll('.w')].map(w => width(w) / parseFloat(w.style.getPropertyValue('--w')));
    out.push({ t, w: words ? Math.max(...words) : width(a.querySelector('.mi')) / w0,
      h: height(`${mm.fontWeight} ${mm.fontSize} ${mm.fontFamily}`, t) / h0,
      moved: Math.max(Math.abs(r1.top - r0.top), Math.abs(r1.height - r0.height)) });
    a.dispatchEvent(new MouseEvent('mouseleave'));
  }
  return out;
};

let checked = 0, worstW = 0, worstH = 0;
const failures = [];
for (const [w, h] of sizes) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  if (engine === 'chrome') await (await ctx.newCDPSession(page)).send('Emulation.setEmulatedMedia', { features: [{ name: 'hover', value: 'hover' }] });
  for (const [file, sel] of [['index.html', '.stories .morph'], ...stories.map(s => [s, '.post-nav .morph'])]) {
    await page.goto(new URL(file, base).href, { waitUntil: 'load' });
    const res = await page.evaluate(HOVER, sel);
    if (typeof res === 'string') { console.error(`${engine} ${w}px ${file}: ${res}`); process.exit(2); }
    for (const r of res) {
      checked++;
      if (r.err) { failures.push(`${w}px ${file} "${r.t}": ${r.err}`); continue; }
      worstW = Math.max(worstW, Math.abs(r.w - 1)); worstH = Math.max(worstH, Math.abs(r.h - 1));
      const why = [Math.abs(r.w - 1) > TOL && `width ${r.w.toFixed(3)}x`,
        Math.abs(r.h - 1) > TOL && `letter height ${r.h.toFixed(3)}x`,
        r.moved > 0.5 && `row moved ${r.moved.toFixed(1)}px`].filter(Boolean);
      if (why.length) failures.push(`${w}px ${file} "${r.t}": ${why.join('; ')}`);
    }
  }
  await ctx.close();
}
if (engine !== 'chrome') await browser.close();

console.log(`${engine}: ${checked} hovers (list and newer/older on ${stories.length} stories) at ${sizes.map(s => s[0]).join(', ')}px;` +
  ` worst width ${(worstW * 100).toFixed(1)}%, height ${(worstH * 100).toFixed(1)}% off`);
for (const f of failures) console.log(`  ✗ ${f}`);
console.log(failures.length ? `FAIL (${failures.length})` : 'PASS');
process.exit(failures.length ? 1 : 0);
