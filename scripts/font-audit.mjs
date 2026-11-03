#!/usr/bin/env bun
// Reports every font the browser actually draws with on a page, via Chrome's
// CSS.getPlatformFontsForNode. A font that is not custom (isCustomFont=false)
// came from the reader's device, so other devices will render differently.
// Usage: bun scripts/font-audit.mjs <page-url>...   (needs `agent-browser`
// running; reuses its Chromium over CDP). Exit 1 if any device font is used.
import { execSync } from 'node:child_process';

const sh = c => execSync(c, { encoding: 'utf8' }).trim();
async function audit(url) {
  sh(`agent-browser open ${JSON.stringify(url)}`);
  sh('agent-browser wait 1200');
  // Read the CDP address per page: the agent-browser daemon can relaunch.
  const browserWs = sh('agent-browser get cdp-url').replace(/^"|"$/g, '');
  const http = browserWs.replace(/^ws/, 'http').replace(/\/devtools\/.*$/, '');
  const pages = await (await fetch(http + '/json/list')).json();
  if (!(await (await fetch(url)).ok)) throw new Error(`${url} is not served`);
  const page = pages.find(p => p.type === 'page' && p.url.split('#')[0] === url) || pages.find(p => p.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0; const waits = new Map();
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && waits.has(m.id)) { waits.get(m.id)(m); waits.delete(m.id); } });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; waits.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('DOM.enable'); await send('CSS.enable');
  await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(()=>1)', awaitPromise: true });
  const { result: { root } } = await send('DOM.getDocument', { depth: -1, pierce: true });
  const targets = [];
  (function walk(n, inHead) {
    const head = inHead || ['HEAD', 'SCRIPT', 'STYLE', 'TEMPLATE'].includes(n.nodeName);
    const hasText = (n.children || []).some(c => c.nodeType === 3 && c.nodeValue.trim());
    if (!head && n.nodeType === 1 && hasText) targets.push({ id: n.nodeId, label: n.nodeName.toLowerCase() + (n.attributes ? '.' + (n.attributes[n.attributes.indexOf('class') + 1] || '').split(' ')[0] : ''), text: (n.children.find(c => c.nodeType === 3 && c.nodeValue.trim()) || {}).nodeValue });
    for (const p of n.pseudoElements || []) if (!head) targets.push({ id: p.nodeId, label: 'pseudo' + p.pseudoType, text: '' });
    for (const c of n.children || []) walk(c, head);
  })(root, false);
  const device = new Map(), served = new Map();
  for (const t of targets) {
    const r = await send('CSS.getPlatformFontsForNode', { nodeId: t.id });
    for (const f of r.result?.fonts || []) {
      const m = f.isCustomFont ? served : device;
      const k = f.familyName;
      if (!m.has(k)) m.set(k, { glyphs: 0, where: new Set() });
      m.get(k).glyphs += f.glyphCount; if (m.get(k).where.size < 4) m.get(k).where.add(t.label + (t.text ? ' "' + t.text.trim().slice(0, 18) + '"' : ''));
    }
  }
  ws.close();
  const fmt = m => [...m].map(([k, v]) => `${k} (${v.glyphs} glyphs: ${[...v.where].join('; ')})`).join('\n    ');
  console.log(`${url}\n  served: ${[...served.keys()].join(', ') || '-'}\n  DEVICE: ${device.size ? '\n    ' + fmt(device) : 'none'}`);
  return device.size;
}

let bad = 0;
for (const u of process.argv.slice(2)) bad += await audit(u);
process.exit(bad ? 1 : 0);
