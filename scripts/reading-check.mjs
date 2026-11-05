// Checks the saved reading place and the carried title with real input.
//
//   node scripts/reading-check.mjs <chrome|firefox|webkit> [base-url]
//
// Serve dist/ first and install the engines as for initials-check.mjs (its
// header says how). Each scenario gets its own browser, because macOS quits a
// windowless Chrome about 30 s after launch. Exits 1 on any failure.
import { createRequire } from 'node:module';
import path from 'node:path';

const [engine, base = 'http://localhost:8787/'] = process.argv.slice(2);
if (!['chrome', 'firefox', 'webkit'].includes(engine)) {
  console.error('usage: node scripts/reading-check.mjs <chrome|firefox|webkit> [base-url]');
  process.exit(2);
}
const pwDir = process.env.PLAYWRIGHT_DIR;
const require = createRequire(pwDir ? path.join(path.resolve(pwDir), 'index.js') : import.meta.url);
let pw;
try { pw = require('playwright'); } catch {
  console.error('playwright not found: set PLAYWRIGHT_DIR to a directory where it is installed (see initials-check.mjs)');
  process.exit(2);
}

const STORY = 'the-company-man/', KEY = `read:${new URL(STORY, base).pathname}`;
const url = (s = STORY) => new URL(s, base).href;
const FONTS = /\.(woff2?|ttf|otf)(\?|$)/;
let failures = 0, scenario = '';
const check = (ok, msg) => { console.log(`${ok ? '  ok  ' : '  FAIL'} ${scenario}: ${msg}`); if (!ok) failures++; };
const near = (a, b, by = 1) => Math.abs(a - b) <= by;

const key = p => p.evaluate(k => localStorage.getItem(k), KEY);
const topBlock = p => p.evaluate(() => {
  const b = [...document.querySelector('.post-body').children], i = b.findIndex(e => e.getBoundingClientRect().bottom > 0);
  return { i, off: Math.round(b[i].getBoundingClientRect().top) };
});
const anchor = p => p.evaluate(() => {
  const b = [...document.querySelector('.post-body').children], i = b.findIndex(e => e.getBoundingClientRect().bottom > 0), r = b[i].getBoundingClientRect();
  return { i, f: -r.top / r.height };
});
const title = p => p.evaluate(() => {
  const a = document.querySelector('.post-header .morph'), s = [...a.querySelectorAll('.w > span')];
  return { n: s.length, turned: s.filter(x => x.className === 'mm').length, carry: document.documentElement.classList.contains('carry'), shown: getComputedStyle(a.closest('h1')).visibility === 'visible' };
});
const open = async (p, s) => { await p.goto(url(s), { waitUntil: 'load' }); await p.evaluate(() => document.fonts.ready); };
// A real wheel turn, then long enough for the 300 ms save.
const wheel = async (p, dy) => {
  await p.mouse.move(640, 400);
  const target = await p.evaluate(d => Math.max(0, Math.min(scrollY + d, document.documentElement.scrollHeight - innerHeight)), dy);
  // A turn can move less than asked (Firefox), so keep turning until it gets there.
  for (let turn = 0; turn < 80; turn++) {
    const left = target - await p.evaluate(() => scrollY);
    if (Math.abs(left) < 2) break;
    await p.mouse.wheel(0, left);
    for (let y = NaN, i = 0; i < 30; i++) {
      await p.waitForTimeout(40);
      const n = await p.evaluate(() => scrollY);
      if (n === y) break;
      y = n;
    }
  }
  await p.waitForTimeout(450);
};
// Reads to about the middle of the story with the wheel, so the place is saved.
const readToMiddle = async p => {
  await wheel(p, await p.evaluate(() => Math.round(document.documentElement.scrollHeight * 0.4)));
  return { at: await topBlock(p), saved: await key(p) };
};
const hoverAndClick = async (p, sel, ms = 700) => {
  const r = await p.locator(sel).boundingBox();
  await p.mouse.move(r.x + r.width / 2, r.y + r.height / 2, { steps: 4 });
  await p.waitForTimeout(ms);
  await p.mouse.down(); await p.mouse.up();
};
const slowFonts = (ctx, ms) => ctx.route(FONTS, async r => { await new Promise(s => setTimeout(s, ms)); await r.continue().catch(() => {}); });

async function run(name, fn, viewport = { width: 1280, height: 800 }) {
  scenario = name;
  const browser = engine === 'chrome' ? await pw.chromium.launch({ channel: 'chrome', headless: true }) : await pw[engine].launch({ headless: true });
  const ctx = await browser.newContext({ viewport });
  await ctx.route(/ipapi\.co/, r => r.abort());
  ctx.on('page', p => p.on('pageerror', e => check(false, `page error: ${e.message}`)));
  try { await fn(await ctx.newPage(), ctx); } catch (e) { check(false, `threw: ${e.message.split('\n')[0]}`); }
  await browser.close();
}

const ROW = '.story-title.t-the-company-man';

await run('carry', async p => {
  await open(p, '');
  await hoverAndClick(p, ROW);
  await p.waitForURL(`**/${STORY}`); await p.waitForTimeout(500);
  let t = await title(p);
  check(t.n > 0 && t.turned === t.n, `a clicked title opens turned (${t.turned}/${t.n})`);
  await p.mouse.move(40, 500, { steps: 3 }); await p.waitForTimeout(150);
  await p.mouse.move(60, 520, { steps: 3 }); await p.waitForTimeout(150);
  check((await title(p)).turned === 0, 'moving off lets it go');
  const h = await p.locator('.post-header .morph').boundingBox();
  await p.mouse.move(h.x + h.width / 2, h.y + h.height / 2, { steps: 3 }); await p.waitForTimeout(1000);
  t = await title(p);
  check(t.turned === t.n, `hovering the title turns it (${t.turned}/${t.n})`);
  await p.mouse.move(40, 520, { steps: 3 }); await p.waitForTimeout(150);
  check((await title(p)).turned === 0, 'leaving the title resets it');
  const at = p.url();
  await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(300);
  check(p.url() === at, 'arrow keys stay on the page');
});

await run('carry, scroll', async p => {
  await open(p, '');
  await hoverAndClick(p, ROW);
  await p.waitForURL(`**/${STORY}`); await p.waitForTimeout(500);
  const before = (await title(p)).turned;
  await p.evaluate(() => scrollBy(0, 200)); await p.waitForTimeout(150);
  check(before > 0 && (await title(p)).turned === 0, 'the first scroll lets it go');
});

await run('carry, no mouse click', async (p, ctx) => {
  await open(p, '');
  await p.locator(ROW).focus();
  await p.keyboard.press('Enter');
  await p.waitForURL(`**/${STORY}`);
  let t = await title(p);
  check(t.turned === 0 && !t.carry && t.shown, 'opening by keyboard shows the title at rest at once');
  await open(p, '');
  const opened = ctx.waitForEvent('page', { timeout: 3000 }).catch(() => null);
  await p.locator(ROW).click({ modifiers: ['Meta'] });
  const tab = await opened;
  if (tab) {
    await tab.waitForLoadState('load'); await tab.waitForTimeout(300);
    t = await title(tab);
    check(t.turned === 0 && !t.carry, 'a tab opened with cmd-click shows the title at rest');
  } else console.log(`  skip ${scenario}: cmd-click opened no tab in this engine`);
});

await run('carry, slow fonts', async (p, ctx) => {
  await open(p, '');
  await slowFonts(ctx, 1300);
  await hoverAndClick(p, ROW);
  await p.waitForURL(`**/${STORY}`, { waitUntil: 'commit' });
  await p.waitForTimeout(900);
  let t = await title(p);
  check(t.shown && t.turned === 0, 'past the wait the title shows at rest');
  await p.mouse.move(40, 500, { steps: 2 });
  await p.waitForTimeout(1500);
  t = await title(p);
  check(t.shown && t.turned === 0 && !t.carry, `it stays at rest when the fonts arrive (${t.turned} turned)`);
  const h = await p.locator('.post-header .morph').boundingBox();
  await p.mouse.move(h.x + h.width / 2, h.y + h.height / 2, { steps: 3 }); await p.waitForTimeout(1000);
  t = await title(p);
  check(t.turned === t.n, `a later hover still turns it (${t.turned}/${t.n})`);
});

await run('place', async p => {
  await open(p);
  const { at, saved } = await readToMiddle(p);
  check(saved && JSON.parse(saved).i === at.i, `reading saves the paragraph (${at.i})`);
  await open(p, '');
  await hoverAndClick(p, ROW);
  await p.waitForURL(`**/${STORY}`); await p.waitForTimeout(500);
  const back = await topBlock(p);
  check(back.i === at.i && near(back.off, at.off, 2), `the same width reopens on the same line (off ${at.off} -> ${back.off})`);
  const t = await title(p);
  check(t.turned === 0 && t.shown, 'no carried title when reopening at a place');
  check(await p.evaluate(() => document.querySelector('.nav').classList.contains('hidden')), 'the nav stays out of the way');
  await p.setViewportSize({ width: 430, height: 800 }); await p.waitForTimeout(500);
  check(near((await topBlock(p)).i, at.i), 'resizing keeps the paragraph');
  await open(p, ''); // through the list: a goto to the same URL may count as a reload
  await open(p);
  check(near((await topBlock(p)).i, at.i), 'another width reopens at the paragraph');
});

await run('place, first screen', async p => {
  await open(p);
  await wheel(p, await p.evaluate(() => Math.round(document.querySelector('.post-body').getBoundingClientRect().top + innerHeight * 0.6)));
  const at = await anchor(p);
  check(await key(p) === null, 'the first screen of text saves nothing');
  await p.setViewportSize({ width: 430, height: 800 }); await p.waitForTimeout(500);
  const now = await anchor(p);
  check(now.i === at.i && Math.abs(now.f - at.f) < 0.1, `resizing keeps the line there too (paragraph ${at.i}, ${at.f.toFixed(2)} -> ${now.i}, ${now.f.toFixed(2)})`);
  await p.setViewportSize({ width: 1280, height: 800 }); await p.waitForTimeout(300);
  await wheel(p, -20000);
  await p.setViewportSize({ width: 900, height: 800 }); await p.waitForTimeout(300);
  await p.setViewportSize({ width: 1400, height: 800 }); await p.waitForTimeout(300);
  check(await p.evaluate(() => scrollY) === 0, 'at the very top, resizing stays at the top');
});

await run('place, links', async p => {
  await open(p);
  const { saved } = await readToMiddle(p);
  // Through the list: from the story itself, a hash would stay in the same document.
  await open(p, '');
  await open(p, `${STORY}#content`); await p.waitForTimeout(300);
  check(await p.evaluate(() => scrollY < 200), 'a link to a place wins');
  await open(p, '');
  check(await key(p) === saved, 'and leaves the saved place alone');
  // Only Chrome reports a text fragment to the page.
  if (engine === 'chrome') {
    const words = await p.evaluate(async u => (new DOMParser().parseFromString(await (await fetch(u)).text(), 'text/html')).querySelectorAll('.post-body > p')[1].textContent.trim().split(/\s+/).slice(0, 6).join(' '), url());
    await p.goto(`${url()}#:~:text=${encodeURIComponent(words)}`, { waitUntil: 'load' }); await p.waitForTimeout(500);
    check((await topBlock(p)).i !== JSON.parse(saved).i, 'a link to a highlighted passage wins');
    await open(p, '');
    check(await key(p) === saved, 'and leaves the saved place alone');
  }
});

await run('place, finished', async p => {
  await open(p);
  const dy = await p.evaluate(() => Math.round(document.querySelector('.post-body').getBoundingClientRect().bottom - innerHeight + 10));
  await wheel(p, dy);
  check(await p.evaluate(() => document.querySelector('.post-body').getBoundingClientRect().bottom < innerHeight), 'the last line is on screen');
  check(await key(p) === null, 'reaching the last line clears the place');
  await wheel(p, -60);
  check(await key(p) === null, 'a nudge back up does not save it again');
  await open(p, '');
  await open(p);
  check(await p.evaluate(() => scrollY) === 0, 'a finished story opens at its title');
  const down = await p.evaluate(() => Math.round(document.querySelector('.post-body').getBoundingClientRect().bottom - innerHeight + 10));
  await wheel(p, down);
  await wheel(p, await p.evaluate(() => -Math.round(innerHeight * 2.5)));
  check(await key(p) !== null, 'going back well above the end saves again');
});

await run('place, other tabs', async (a, ctx) => {
  await open(a);
  const b = await ctx.newPage();
  await open(b);
  const { saved } = await readToMiddle(b);
  await a.bringToFront();
  await a.goto(url(''), { waitUntil: 'load' });
  check(await key(a) === saved, 'a tab that never moved does not erase it');
  await a.goto(url(), { waitUntil: 'load' }); await a.waitForTimeout(300);
  const c = await ctx.newPage();
  await open(c, '');
  await a.bringToFront();
  await wheel(a, 1500);
  const later = await key(a);
  await b.bringToFront(); await wheel(b, 400);
  const newest = await key(b);
  check(newest && newest !== later, 'the tab moved last owns the place');
  await a.goto(url(''), { waitUntil: 'load' });
  check(await key(a) === newest, 'closing a tab that moved earlier does not overwrite it');
});

await run('place, old history entry', async p => {
  await open(p);
  await open(p, '');
  await open(p);
  const { saved } = await readToMiddle(p);
  await open(p, '');
  await p.goBack(); await p.waitForTimeout(250);
  await p.goBack(); await p.waitForTimeout(250);
  await p.goBack(); await p.waitForTimeout(250);
  await p.goto(url(''), { waitUntil: 'load' });
  check(await key(p) === saved, 'an old entry at the title does not erase it');
});

await run('place, taller window', async (p, ctx) => {
  await open(p);
  await wheel(p, await p.evaluate(() => Math.round(document.querySelector('.post-body').getBoundingClientRect().top + innerHeight * 1.15)));
  const saved = await key(p), i = JSON.parse(saved || '{"i":-1}').i;
  check(saved !== null, 'just past the first screen saves');
  await open(p, '');
  await p.setViewportSize({ width: 1280, height: 1000 });
  await slowFonts(ctx, 700);
  await p.goto(url(), { waitUntil: 'load' });
  await p.waitForTimeout(1500);
  check(near((await topBlock(p)).i, i), 'it reopens there');
  check(await key(p) === saved, 'opening in a taller window does not erase it');
  await p.goto(url(''), { waitUntil: 'load' });
  check(await key(p) === saved, 'nor does leaving without moving');
});

await run('place, slow fonts', async (p, ctx) => {
  await open(p);
  const { at } = await readToMiddle(p);
  await open(p, '');
  await slowFonts(ctx, 1000);
  await p.goto(url(), { waitUntil: 'commit' });
  await p.waitForFunction(() => document.querySelector('.post-body') && scrollY > 0, null, { timeout: 8000 });
  await p.waitForTimeout(150);
  check(await p.evaluate(() => document.fonts.status === 'loading'), 'the fonts are still on their way at the press');
  // Stands in for a scrollbar drag: a press at the page's edge, then the page
  // moves with no wheel or key.
  await p.mouse.move(4, 400); await p.mouse.down(); await p.mouse.up();
  await p.evaluate(() => scrollBy(0, -2000));
  await p.waitForTimeout(1600);
  check((await topBlock(p)).i < at.i, 'the fonts arriving do not pull back a reader who moved');
});

await run('place, late fonts', async (p, ctx) => {
  await open(p);
  const { at } = await readToMiddle(p);
  await open(p, '');
  await slowFonts(ctx, 1000);
  await open(p);
  await p.waitForTimeout(200); // the nav updates on the next frame
  check(near((await topBlock(p)).i, at.i), 'the fonts arriving keep the paragraph');
  check(await p.evaluate(() => document.querySelector('.nav').classList.contains('hidden')), 'their move does not bring the nav back');
});

await run('place, leaving at once', async p => {
  await open(p); // a fresh visit, where any scroll counts as the reader's
  await p.evaluate(() => new Promise(r => {
    addEventListener('scroll', r, { once: true });
    scrollTo({ top: 3 * innerHeight, behavior: 'instant' });
  }));
  const before = await key(p);
  await open(p, '');
  check(before === null, 'nothing saved yet when the reader leaves');
  check(await key(p) !== null, 'leaving inside the 300 ms wait still saves the place');
});

await run('theme button', async p => {
  const theme = () => p.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await open(p);
  await p.locator('#theme-btn').click();
  const dark = await theme();
  await p.mouse.move(640, 400); await p.mouse.wheel(0, 900); await p.waitForTimeout(500);
  const y = await p.evaluate(() => scrollY);
  await p.keyboard.press('Space'); await p.waitForTimeout(600);
  check(await theme() === dark, 'Space after a click does not flip the theme');
  check(await p.evaluate(() => scrollY) > y, 'Space after a click scrolls the page');
  await p.locator('#theme-btn').focus();
  await p.keyboard.press('Enter');
  check(await theme() !== dark, 'a key press still flips it');
  check(await p.evaluate(() => document.activeElement.id === 'theme-btn'), 'a key press keeps focus on the button');
});

console.log(failures ? `FAIL ${failures}` : 'PASS');
process.exit(failures ? 1 : 0);
