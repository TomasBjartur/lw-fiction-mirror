const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const LW_GRAPHQL = 'https://www.lesswrong.com/graphql';
const USER_SLUG = 'bjartur-tomas';
const OUTPUT_DIR = path.join(__dirname, 'dist');
const FICTION_TAG_SLUG = 'fiction';

// Site config - edit these
const SITE_TITLE = 'Tomás B.';
const SITE_SUBTITLE = 'Fiction';
const SITE_DESCRIPTION = 'Fiction by Tomás B., mirrored from LessWrong.';
const LW_PROFILE = `https://www.lesswrong.com/users/${USER_SLUG}`;
const SITE_URL = 'https://tomasbjartur.github.io/lw-fiction-mirror';
const SUBSTACK_URL = 'https://tomasbjartur.substack.com/';

async function gqlQuery(query, variables = {}) {
  const res = await fetch(LW_GRAPHQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GraphQL request failed: ${res.status}`);
  const json = await res.json();
  if (json.errors) {
    console.error('GraphQL errors:', JSON.stringify(json.errors, null, 2));
  }
  return json.data;
}

async function getUser() {
  const data = await gqlQuery(`
    {
      user(input: { selector: { slug: "${USER_SLUG}" } }) {
        result {
          _id
          displayName
          slug
        }
      }
    }
  `);
  return data.user.result;
}

async function getUserPosts(userId) {
  // Fetch posts in batches
  let allPosts = [];
  let offset = 0;
  const limit = 50;

  while (true) {
    const data = await gqlQuery(`
      {
        posts(input: {
          terms: {
            userId: "${userId}"
            limit: ${limit}
            offset: ${offset}
          }
        }) {
          results {
            _id
            title
            slug
            postedAt
            baseScore
            voteCount
            commentCount
            tags {
              _id
              name
              slug
            }
            htmlBody
            wordCount
          }
        }
      }
    `);

    const posts = data.posts.results;
    if (!posts || posts.length === 0) break;
    allPosts = allPosts.concat(posts);
    if (posts.length < limit) break;
    offset += limit;
  }

  return allPosts;
}

const EXCLUDED_SLUGS = ['offvermilion'];
const KARMA_CUTOFF = 60;

function filterFiction(posts) {
  return posts.filter(p =>
    p.tags && p.tags.some(t => t.slug === FICTION_TAG_SLUG) &&
    p.htmlBody && p.htmlBody.length > 100 && // skip link-only posts
    !EXCLUDED_SLUGS.includes(p.slug)
  );
}

function orderForCollection(posts) {
  const sorted = [...posts].sort((a, b) => b.baseScore - a.baseScore);
  const eligible = sorted.filter(p => p.baseScore >= KARMA_CUTOFF);

  // Hardcoded anchors
  const first = eligible.find(p => p.slug === 'the-company-man');
  const last = eligible.find(p => p.slug === 'the-origami-men');
  const middle = eligible.filter(p => p !== first && p !== last);

  // Editorial middle: alternate long and short pieces for pacing
  // Split into longer and shorter halves, then interleave
  middle.sort((a, b) => (b.wordCount || 0) - (a.wordCount || 0));
  const half = Math.ceil(middle.length / 2);
  const longer = middle.slice(0, half);
  const shorter = middle.slice(half);
  const interleaved = [];
  for (let i = 0; i < Math.max(longer.length, shorter.length); i++) {
    if (i < longer.length) interleaved.push(longer[i]);
    if (i < shorter.length) interleaved.push(shorter[i]);
  }

  return [first, ...interleaved, last].filter(Boolean);
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function estimateReadingTime(wordCount) {
  if (!wordCount) return '';
  const minutes = Math.ceil(wordCount / 250);
  return `${minutes} min read`;
}

function cleanHtml(html) {
  if (!html) return '';
  // Remove LW-specific widgets, voting buttons, etc.
  // Keep the prose clean
  return html
    // Remove empty paragraphs
    .replace(/<p>\s*<\/p>/g, '')
    // Remove LW internal link styling classes but keep links
    .replace(/class="[^"]*"/g, '')
    // Remove style attributes
    .replace(/style="[^"]*"/g, '');
}

function buildNav(posts, currentSlug, sortBy) {
  const sorted = [...posts];
  if (sortBy === 'karma') {
    sorted.sort((a, b) => b.baseScore - a.baseScore);
  } else {
    sorted.sort((a, b) => new Date(b.postedAt) - new Date(a.postedAt));
  }

  return sorted.map(p => {
    const active = p.slug === currentSlug ? ' class="active"' : '';
    return `<li><a href="${p.slug}.html"${active}><span class="nav-title">${p.title}</span></a></li>`;
  }).join('\n');
}

function buildSidebar(posts, currentSlug) {
  return `
    <nav class="sidebar">
      <div class="sidebar-header">
        <a href="index.html" class="site-title">${SITE_TITLE}</a>
        <span class="site-subtitle">${SITE_SUBTITLE}</span>
        <a href="${SUBSTACK_URL}" class="subscribe-button">Subscribe by email</a>
        <div class="header-links">
          <a href="fiction.epub">EPUB</a>
          <a href="feed.xml">RSS</a>
        </div>
      </div>

      <div class="nav-section">
        <h3>By Popularity</h3>
        <ul>
          ${buildNav(posts, currentSlug, 'karma')}
        </ul>
      </div>

      <div class="nav-section">
        <h3>By Date</h3>
        <ul>
          ${buildNav(posts, currentSlug, 'date')}
        </ul>
      </div>

      <div class="sidebar-footer">
        <a href="${LW_PROFILE}" class="lw-link">LessWrong Profile</a>
      </div>
    </nav>`;
}

function pageShell(content, title, posts, currentSlug) {
  const pageTitle = title ? `${title} — ${SITE_TITLE}` : `${SITE_TITLE} · ${SITE_SUBTITLE}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${pageTitle}</title>
  <meta name="description" content="${SITE_DESCRIPTION}">
  <link rel="stylesheet" href="style.css">
  <link rel="alternate" type="application/rss+xml" title="${SITE_TITLE} — ${SITE_SUBTITLE}" href="feed.xml">
</head>
<body>

  <input type="checkbox" id="menu-toggle" hidden>
  <label for="menu-toggle" class="menu-button" aria-label="Toggle menu">☰</label>
  <label for="menu-toggle" class="menu-overlay" aria-hidden="true"></label>

  ${buildSidebar(posts, currentSlug)}

  <main>
    ${content}
  </main>

</body>
</html>`;
}

function buildPostPage(post, allPosts) {
  const readTime = estimateReadingTime(post.wordCount);
  const meta = [formatDate(post.postedAt), readTime].filter(Boolean).join(' · ');

  const content = `
    <article>
      <header class="post-header">
        <h1>${post.title}</h1>
        <p class="post-meta">${meta}</p>
      </header>
      <div class="post-body">
        ${cleanHtml(post.htmlBody)}
      </div>
      <footer class="post-footer">
        <p>Originally published on <a href="https://www.lesswrong.com/posts/${post._id}/${post.slug}">LessWrong</a>.</p>
      </footer>
    </article>`;

  return pageShell(content, post.title, allPosts, post.slug);
}

function buildIndexPage(posts) {
  const byDate = [...posts].sort((a, b) => new Date(b.postedAt) - new Date(a.postedAt));

  const listing = byDate.map(p => {
    const readTime = estimateReadingTime(p.wordCount);
    const meta = [formatDate(p.postedAt), readTime].filter(Boolean).join(' · ');
    return `
      <li class="index-item">
        <a href="${p.slug}.html">
          <span class="index-title">${p.title}</span>
          <span class="index-meta">${meta}</span>
        </a>
      </li>`;
  }).join('\n');

  const content = `
    <div class="index-page">
      <h1>${SITE_TITLE}</h1>
      <p class="index-intro">${SITE_DESCRIPTION}</p>
      <ul class="index-list">
        ${listing}
      </ul>
    </div>`;

  return pageShell(content, null, posts, null);
}

function buildStylesheet() {
  return `/* Tomás B. Fiction — Static Mirror */

:root {
  --bg: #fcfbf9;
  --text: #1a1a1a;
  --text-light: #7a7570;
  --accent: #8b4513;
  --border: #e8e4de;
  --sidebar-bg: #f5f2ed;
  --sidebar-width: 260px;
  --active-bg: #ebe7e0;
  --link: #6b3a2e;
  --max-prose: 38rem;
  --serif: Charter, 'Bitstream Charter', 'Noto Serif', Georgia, serif;
  --sans: -apple-system, 'Segoe UI', system-ui, sans-serif;
  --radius: 6px;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html {
  font-size: 18px;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  scroll-behavior: smooth;
}

body {
  font-family: var(--serif);
  color: var(--text);
  background: var(--bg);
  line-height: 1.75;
  display: flex;
  min-height: 100vh;
}

::selection {
  background: rgba(139, 69, 19, 0.15);
}

/* --- Sidebar --- */
.sidebar {
  width: var(--sidebar-width);
  min-width: var(--sidebar-width);
  background: var(--sidebar-bg);
  border-right: 1px solid var(--border);
  padding: 2rem 0;
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  overflow-y: auto;
  font-family: var(--sans);
  font-size: 0.78rem;
  z-index: 10;
}

.sidebar-header {
  padding: 0 1.4rem 1.2rem;
  border-bottom: 1px solid var(--border);
  margin-bottom: 1rem;
}

.site-title {
  display: block;
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text);
  text-decoration: none;
  letter-spacing: -0.01em;
}
.site-title:hover { color: var(--accent); }

.site-subtitle {
  display: block;
  color: var(--text-light);
  font-size: 0.8rem;
  margin-top: 0.2rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.nav-section h3 {
  padding: 0.8rem 1.4rem 0.3rem;
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-light);
  font-weight: 600;
}

.nav-section ul {
  list-style: none;
}

.nav-section li a {
  display: flex;
  align-items: baseline;
  gap: 0.5em;
  padding: 0.35rem 1.4rem;
  color: var(--text);
  text-decoration: none;
  border-radius: 0;
  transition: background 0.15s, color 0.15s;
}

.nav-section li a:hover {
  background: var(--active-bg);
  color: var(--accent);
}

.nav-section li a.active {
  background: var(--active-bg);
  font-weight: 600;
  color: var(--accent);
}

.nav-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subscribe-button {
  display: block;
  text-align: center;
  padding: 0.5rem 1rem;
  margin-top: 0.9rem;
  background: var(--accent);
  color: #fff;
  font-size: 0.78rem;
  font-weight: 600;
  text-decoration: none;
  border-radius: var(--radius);
  transition: background 0.15s;
}
.subscribe-button:hover {
  background: #6b3a2e;
}

.header-links {
  display: flex;
  gap: 0.8em;
  margin-top: 0.5rem;
  flex-wrap: wrap;
}

.header-links a {
  font-size: 0.72rem;
  color: var(--text-light);
  text-decoration: none;
  transition: color 0.15s;
}
.header-links a:hover {
  color: var(--accent);
}

.sidebar-footer {
  padding: 1.5rem 1.4rem 0;
  border-top: 1px solid var(--border);
  margin-top: 1rem;
}

.lw-link {
  font-size: 0.75rem;
  color: var(--text-light);
  text-decoration: none;
  transition: color 0.15s;
}
.lw-link:hover { color: var(--accent); }

/* --- Main --- */
main {
  margin-left: var(--sidebar-width);
  flex: 1;
  padding: 4rem 2.5rem 6rem;
  display: flex;
  justify-content: center;
}

article, .index-page {
  max-width: var(--max-prose);
  width: 100%;
}

/* --- Post --- */
.post-header {
  margin-bottom: 3rem;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid var(--border);
}

.post-header h1 {
  font-size: 2.2rem;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: -0.02em;
  margin-bottom: 0.6rem;
}

.post-meta {
  font-family: var(--sans);
  font-size: 0.8rem;
  color: var(--text-light);
  letter-spacing: 0.01em;
}

.post-body p {
  margin-bottom: 1.3em;
  hanging-punctuation: first last;
}

.post-body blockquote {
  border-left: 2px solid var(--accent);
  padding-left: 1.4em;
  margin: 1.8em 0;
  color: var(--text-light);
  font-style: italic;
}

.post-body h2, .post-body h3 {
  margin: 2.2em 0 0.8em;
  font-weight: 700;
  line-height: 1.3;
  letter-spacing: -0.01em;
}

.post-body h2 { font-size: 1.4rem; }
.post-body h3 { font-size: 1.15rem; }

.post-body a {
  color: var(--link);
  text-decoration: underline;
  text-decoration-color: rgba(107, 58, 46, 0.3);
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
  transition: text-decoration-color 0.15s;
}
.post-body a:hover {
  text-decoration-color: var(--link);
}

.post-body hr {
  border: none;
  text-align: center;
  margin: 3em 0;
}
.post-body hr::before {
  content: '\\2022\\2003\\2022\\2003\\2022';
  color: var(--text-light);
  font-size: 0.85rem;
}

.post-body img {
  max-width: 100%;
  height: auto;
  border-radius: var(--radius);
}

.post-body pre, .post-body code {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 0.85em;
}

.post-body pre {
  background: var(--sidebar-bg);
  border: 1px solid var(--border);
  padding: 1.2em;
  overflow-x: auto;
  border-radius: var(--radius);
  margin: 1.8em 0;
}

.post-body code {
  background: var(--sidebar-bg);
  padding: 0.15em 0.4em;
  border-radius: 3px;
}

.post-body pre code {
  background: none;
  padding: 0;
}

.post-footer {
  margin-top: 4rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--border);
  font-family: var(--sans);
  font-size: 0.8rem;
  color: var(--text-light);
}

.post-footer a {
  color: var(--link);
  text-decoration: underline;
  text-decoration-color: rgba(107, 58, 46, 0.3);
  text-underline-offset: 2px;
}
.post-footer a:hover {
  text-decoration-color: var(--link);
}

/* --- Index page --- */
.index-page h1 {
  font-size: 2.2rem;
  font-weight: 700;
  margin-bottom: 0.3rem;
  letter-spacing: -0.02em;
}

.index-intro {
  color: var(--text-light);
  font-size: 0.95rem;
  margin-bottom: 2.5rem;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid var(--border);
}

.index-list {
  list-style: none;
}

.index-item a {
  display: block;
  padding: 1rem 0.8rem;
  margin: 0 -0.8rem;
  text-decoration: none;
  color: var(--text);
  border-bottom: 1px solid var(--border);
  border-radius: var(--radius);
  transition: background 0.15s;
}

.index-item:first-child a {
  border-top: 1px solid var(--border);
}

.index-item a:hover {
  background: var(--sidebar-bg);
}

.index-title {
  display: block;
  font-size: 1.15rem;
  font-weight: 600;
  line-height: 1.3;
}

.index-meta {
  display: block;
  font-family: var(--sans);
  font-size: 0.78rem;
  color: var(--text-light);
  margin-top: 0.2rem;
}

/* --- Mobile overlay for closing sidebar --- */
.menu-overlay {
  display: none;
}

/* --- Mobile hamburger --- */
.menu-button {
  display: none;
  position: fixed;
  top: 0.8rem;
  left: 0.8rem;
  z-index: 20;
  background: var(--bg);
  border: 1px solid var(--border);
  width: 2.4rem;
  height: 2.4rem;
  padding: 0;
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 1.15rem;
  line-height: 2.4rem;
  text-align: center;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  transition: background 0.15s;
}
.menu-button:hover {
  background: var(--sidebar-bg);
}

@media (max-width: 860px) {
  .menu-button { display: block; }

  .sidebar {
    transform: translateX(-100%);
    transition: transform 0.25s ease;
    box-shadow: none;
  }

  #menu-toggle:checked ~ .sidebar {
    transform: translateX(0);
    box-shadow: 4px 0 24px rgba(0,0,0,0.08);
  }

  #menu-toggle:checked ~ .menu-overlay {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 5;
    background: rgba(0,0,0,0.15);
  }

  main {
    margin-left: 0;
    padding: 4rem 1.5rem 4rem;
  }

  .post-header h1, .index-page h1 {
    font-size: 1.75rem;
  }
}

@media (max-width: 520px) {
  html { font-size: 17px; }

  main {
    padding: 3.5rem 1.2rem 3rem;
  }

  .post-header {
    margin-bottom: 2rem;
  }

  .post-header h1, .index-page h1 {
    font-size: 1.55rem;
  }

  .post-body blockquote {
    margin-left: 0;
    padding-left: 1em;
  }

  .index-item a {
    padding: 0.8rem 0.6rem;
    margin: 0 -0.6rem;
  }
}

/* Respect reduced motion */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
`;
}

// --- RSS feed ---

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildRssFeed(posts) {
  const byDate = [...posts].sort((a, b) => new Date(b.postedAt) - new Date(a.postedAt));
  const buildDate = new Date().toUTCString();
  const items = byDate.map(p => {
    const pubDate = new Date(p.postedAt).toUTCString();
    const link = `${SITE_URL}/${p.slug}.html`;
    return `    <item>
      <title>${escapeXml(p.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${escapeXml(p.title)} — ${estimateReadingTime(p.wordCount)}</description>
      <content:encoded><![CDATA[${cleanHtml(p.htmlBody)}]]></content:encoded>
    </item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(SITE_TITLE)} — ${escapeXml(SITE_SUBTITLE)}</title>
    <link>${SITE_URL}</link>
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml"/>
    <description>${escapeXml(SITE_DESCRIPTION)}</description>
    <language>en</language>
    <lastBuildDate>${buildDate}</lastBuildDate>
${items}
  </channel>
</rss>`;
}

// --- EPUB generation (no dependencies, manual ZIP) ---

function crc32(buf) {
  if (typeof buf === 'string') buf = Buffer.from(buf);
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  return (crc ^ -1) >>> 0;
}

function buildZip(entries) {
  // entries: [{name, data, store}] where data is Buffer
  const centralHeaders = [];
  const parts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name);
    const data = entry.data;
    const store = entry.store || false;
    const compressed = store ? data : zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    // Local file header
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0); // signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(store ? 0 : 8, 8); // compression (0=store, 8=deflate)
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0, 12); // mod date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    nameBuf.copy(local, 30);

    // Central directory header
    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(store ? 0 : 8, 10);
    central.writeUInt16LE(0, 12); // mod time
    central.writeUInt16LE(0, 14); // mod date
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra field length
    central.writeUInt16LE(0, 32); // file comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal file attributes
    central.writeUInt32LE(0, 38); // external file attributes
    central.writeUInt32LE(offset, 42); // relative offset of local header
    nameBuf.copy(central, 46);
    centralHeaders.push(central);

    parts.push(local, compressed);
    offset += local.length + compressed.length;
  }

  const centralDirOffset = offset;
  let centralDirSize = 0;
  for (const c of centralHeaders) centralDirSize += c.length;

  // End of central directory
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with central dir
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(centralDirOffset, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...parts, ...centralHeaders, eocd]);
}

function htmlToXhtml(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*>/gi, '<br/>')
    .replace(/<hr\s*>/gi, '<hr/>')
    .replace(/<img([^>]*?)(?<!\/)>/gi, '<img$1/>')
    .replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;')
    .replace(/<p>\s*<\/p>/g, '')
    .replace(/class="[^"]*"/g, '')
    .replace(/style="[^"]*"/g, '');
}

function buildEpub(posts, sortLabel, bookTitle) {
  const bookId = `tomas-b-fiction-by-${sortLabel}`;
  const entries = [];

  // mimetype must be first and stored (not compressed)
  entries.push({ name: 'mimetype', data: Buffer.from('application/epub+zip'), store: true });

  // META-INF/container.xml
  entries.push({
    name: 'META-INF/container.xml',
    data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`)
  });

  // Chapter XHTML files
  const chapterFiles = posts.map((post, i) => {
    const id = `chapter${i}`;
    const filename = `${id}.xhtml`;
    const readTime = estimateReadingTime(post.wordCount);
    const meta = [formatDate(post.postedAt), readTime].filter(Boolean).join(' \u00b7 ');
    const xhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${post.title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</title>
<style>
body { font-family: serif; line-height: 1.6; margin: 1em; }
h1 { font-size: 1.6em; margin-bottom: 0.3em; }
.meta { font-size: 0.85em; color: #666; margin-bottom: 1.5em; }
blockquote { border-left: 2px solid #999; padding-left: 1em; margin: 1em 0; font-style: italic; color: #555; }
hr { border: none; text-align: center; margin: 2em 0; }
hr::before { content: "\\2022\\2003\\2022\\2003\\2022"; color: #999; }
</style>
</head>
<body>
<h1>${post.title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</h1>
<p class="meta">${meta}</p>
${htmlToXhtml(post.htmlBody)}
</body>
</html>`;
    entries.push({ name: `OEBPS/${filename}`, data: Buffer.from(xhtml) });
    return { id, filename, title: post.title };
  });

  // Table of contents XHTML
  const tocXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Table of Contents</title>
<style>body { font-family: sans-serif; margin: 1em; } li { margin: 0.5em 0; }</style>
</head>
<body>
<h1>Table of Contents</h1>
<nav epub:type="toc">
<ol>
${chapterFiles.map(c => `  <li><a href="${c.filename}">${c.title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</a></li>`).join('\n')}
</ol>
</nav>
</body>
</html>`;
  entries.push({ name: 'OEBPS/toc.xhtml', data: Buffer.from(tocXhtml) });

  // content.opf
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${bookId}</dc:identifier>
    <dc:title>${bookTitle}</dc:title>
    <dc:creator>Tom\u00e1s Bjartur</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z/, 'Z')}</meta>
  </metadata>
  <manifest>
    <item id="toc" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${chapterFiles.map(c => `    <item id="${c.id}" href="${c.filename}" media-type="application/xhtml+xml"/>`).join('\n')}
  </manifest>
  <spine>
    <itemref idref="toc"/>
${chapterFiles.map(c => `    <itemref idref="${c.id}"/>`).join('\n')}
  </spine>
</package>`;
  entries.push({ name: 'OEBPS/content.opf', data: Buffer.from(opf) });

  return buildZip(entries);
}

async function main() {
  console.log('Fetching user...');
  const user = await getUser();
  console.log(`Found user: ${user.displayName} (${user._id})`);

  console.log('Fetching posts...');
  const allPosts = await getUserPosts(user._id);
  console.log(`Fetched ${allPosts.length} total posts`);

  const fiction = filterFiction(allPosts);
  console.log(`Found ${fiction.length} fiction posts`);

  if (fiction.length === 0) {
    console.error('No fiction posts found! Check that posts are tagged with "Fiction".');
    process.exit(1);
  }

  // Create output directory
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Prevent Jekyll processing on GitHub Pages
  fs.writeFileSync(path.join(OUTPUT_DIR, '.nojekyll'), '');

  // Write stylesheet
  fs.writeFileSync(path.join(OUTPUT_DIR, 'style.css'), buildStylesheet());
  console.log('Wrote style.css');

  // Write index page
  fs.writeFileSync(path.join(OUTPUT_DIR, 'index.html'), buildIndexPage(fiction));
  console.log('Wrote index.html');

  // Write individual post pages
  for (const post of fiction) {
    const filename = `${post.slug}.html`;
    fs.writeFileSync(path.join(OUTPUT_DIR, filename), buildPostPage(post, fiction));
    console.log(`Wrote ${filename}`);
  }

  // Generate EPUB
  const collection = orderForCollection(fiction);
  const bookTitle = 'The Company Man and Other Stories by Tom\u00e1s Bjartur';
  const epub = buildEpub(collection, 'collection', bookTitle);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'fiction.epub'), epub);
  console.log(`Wrote fiction.epub (${collection.length} stories)`);

  // Generate RSS feed
  fs.writeFileSync(path.join(OUTPUT_DIR, 'feed.xml'), buildRssFeed(fiction));
  console.log('Wrote feed.xml');

  console.log(`\nDone! ${fiction.length} pages + EPUB + RSS generated in ${OUTPUT_DIR}/`);
}

// Export for testing, run if called directly
module.exports = { buildPostPage, buildIndexPage, buildStylesheet, filterFiction, pageShell, buildSidebar };

if (require.main === module) {
  main().catch(err => {
    console.error('Build failed:', err);
    process.exit(1);
  });
}
