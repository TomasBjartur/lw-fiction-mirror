const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { createCanvas } = require('canvas');

const LW_GRAPHQL = 'https://www.lesswrong.com/graphql';
const USER_SLUG = 'bjartur-tomas';
const OUTPUT_DIR = path.join(__dirname, 'dist');
const FICTION_TAG_SLUG = 'fiction';

// Site config - edit these
const SITE_TITLE = 'The Origami Men and Other Stories';
const SITE_SUBTITLE = 'by Tomás Bjartur';
const SITE_DESCRIPTION = 'Fiction by Tomás Bjartur.';
const SITE_URL = 'https://tomasbjartur.github.io/lw-fiction-mirror';
const SUBSTACK_URL = 'https://tomasbjartur.substack.com/subscribe?';
const BOOK_TITLE = 'The Origami Men and Other Stories by Tom\u00e1s Bjartur';
const EPUB_FILENAME = 'The_Origami_Men_and_Other_Stories.epub';

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

const EXCLUDED_SLUGS = ['beauty-and-the-beast'];
const KARMA_CUTOFF = 30;

// External stories hosted outside LessWrong
const EXTERNAL_STORIES = [
  {
    url: 'https://tomasbjartur.bearblog.dev/remembering-aubrey-chang/',
    slug: 'remembering-aubrey-chang',
    title: 'Remembering Aubrey Chang',
    postedAt: '2025-11-15T00:00:00Z',
  },
  {
    url: 'https://tomasbjartur.bearblog.dev/goldfish/',
    slug: 'goldfish',
    title: 'Goldfish',
    postedAt: '2025-12-28T00:00:00Z',
  },
];

async function fetchExternalStories() {
  const stories = [];
  for (const ext of EXTERNAL_STORIES) {
    console.log(`Fetching external story: ${ext.title}...`);
    const res = await fetch(ext.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; fiction-mirror-build)' },
    });
    if (!res.ok) {
      console.error(`Failed to fetch ${ext.url}: ${res.status}`);
      continue;
    }
    const html = await res.text();
    // Extract content from bearblog <main> or <article> tag
    const match = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
      || html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    let body = match ? match[1] : '';
    // Strip title headings, date wrapper, nav links, upvote form
    body = body.replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, '').trim();
    body = body.replace(/<p>\s*<i>\s*<time[\s\S]*?<\/time>\s*<\/i>\s*<\/p>/i, '').trim();
    body = body.replace(/<a class="(previous|next)-post"[^>]*>[^<]*<\/a>/gi, '').trim();
    body = body.replace(/<form[\s\S]*?<\/form>/gi, '').trim();
    body = body.replace(/<script[\s\S]*?<\/script>/gi, '').trim();
    const wordCount = body.replace(/<[^>]+>/g, '').split(/\s+/).filter(Boolean).length;
    stories.push({
      _id: ext.slug,
      title: ext.title,
      slug: ext.slug,
      postedAt: ext.postedAt,
      baseScore: KARMA_CUTOFF, // ensure it passes the cutoff
      voteCount: 0,
      commentCount: 0,
      tags: [{ _id: 'fiction', name: 'Fiction', slug: 'fiction' }],
      htmlBody: body,
      wordCount,
      external: true,
    });
  }
  return stories;
}

function filterFiction(posts) {
  return posts.filter(p =>
    p.tags && p.tags.some(t => t.slug === FICTION_TAG_SLUG) &&
    p.htmlBody && p.htmlBody.length > 100 && // skip link-only posts
    !EXCLUDED_SLUGS.includes(p.slug)
  );
}

const COLLECTION_ORDER = [
  'the-company-man',
  'our-beloved-monsters',
  'that-mad-olympiad-1',
  'the-maker-of-mind',
  'remembering-aubrey-chang',
  'lobsang-s-children-1',
  'the-liar-and-the-scold',
  'the-elect-2',
  'goldfish',
  'offvermilion',
  'penny-s-hands',
  'the-origami-men',
];

function orderForCollection(posts) {
  const eligible = posts.filter(p => p.baseScore >= KARMA_CUTOFF);
  const ordered = [];
  // Place stories in hardcoded order
  for (const slug of COLLECTION_ORDER) {
    const post = eligible.find(p => p.slug === slug);
    if (post) ordered.push(post);
  }
  // Append any new stories not yet in the hardcoded list, sorted by karma
  const remaining = eligible
    .filter(p => !COLLECTION_ORDER.includes(p.slug))
    .sort((a, b) => b.baseScore - a.baseScore);
  ordered.push(...remaining);
  return ordered;
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
      </div>

      <div class="nav-section">
        <div class="sort-toggle">
          <button class="sort-btn active" data-sort="karma">Popular</button>
          <button class="sort-btn" data-sort="date">Recent</button>
        </div>
        <ul class="nav-list" data-sort="karma">
          ${buildNav(posts, currentSlug, 'karma')}
        </ul>
        <ul class="nav-list" data-sort="date" style="display:none">
          ${buildNav(posts, currentSlug, 'date')}
        </ul>
      </div>

      <div class="sidebar-footer">
        <a href="${SUBSTACK_URL}" class="lw-link">${SITE_TITLE}</a>
      </div>
    </nav>`;
}

function pageShell(content, title, posts, currentSlug) {
  const pageTitle = title ? `${title} — ${SITE_TITLE}` : `${SITE_TITLE} · ${SITE_SUBTITLE}`;

  return `<!DOCTYPE html>
<html lang="en" data-theme="auto">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${pageTitle}</title>
  <meta name="description" content="${SITE_DESCRIPTION}">
  <link rel="stylesheet" href="style.css">
  <link rel="alternate" type="application/rss+xml" title="${SITE_TITLE} — ${SITE_SUBTITLE}" href="feed.xml">
  <script>try{var t=localStorage.getItem('theme');if(t)document.documentElement.setAttribute('data-theme',t)}catch(e){}</script>
</head>
<body>

  <input type="checkbox" id="menu-toggle" hidden>
  <label for="menu-toggle" class="menu-overlay" aria-hidden="true"></label>

  <header class="top-bar">
    <label for="menu-toggle" class="menu-button" aria-label="Toggle menu">☰</label>
    <a href="index.html" class="top-bar-title">${SITE_TITLE}</a>
    <div class="top-bar-actions">
      <button class="theme-toggle" id="theme-btn" aria-label="Toggle dark mode"></button>
      <a href="${EPUB_FILENAME}" class="top-bar-btn">EPUB</a>
      <a href="${SUBSTACK_URL}" class="top-bar-btn top-bar-btn-primary">Subscribe</a>
    </div>
  </header>

  ${buildSidebar(posts, currentSlug)}

  <main>
    ${content}
  </main>

  <script>
  (function(){
    // Theme toggle
    var h=document.documentElement,b=document.getElementById('theme-btn');
    function isDark(){var t=h.getAttribute('data-theme');return t==='dark'||(t==='auto'&&window.matchMedia('(prefers-color-scheme:dark)').matches)}
    function updateTheme(){b.textContent=isDark()?'\u2600\uFE0E':'\u263D\uFE0E'}
    b.addEventListener('click',function(){var t=h.getAttribute('data-theme'),n;if(t==='auto')n=isDark()?'light':'dark';else n=t==='dark'?'light':'dark';h.setAttribute('data-theme',n);try{localStorage.setItem('theme',n)}catch(e){}updateTheme()});
    updateTheme();

    // Sort toggle
    var sort;try{sort=localStorage.getItem('sort')}catch(e){}
    if(!sort)sort='karma';
    function applySort(s){
      sort=s;try{localStorage.setItem('sort',s)}catch(e){}
      document.querySelectorAll('.nav-list').forEach(function(ul){ul.style.display=ul.getAttribute('data-sort')===s?'':'none'});
      document.querySelectorAll('.sort-btn').forEach(function(btn){btn.classList.toggle('active',btn.getAttribute('data-sort')===s)});
    }
    document.querySelectorAll('.sort-btn').forEach(function(btn){btn.addEventListener('click',function(){applySort(btn.getAttribute('data-sort'))})});
    applySort(sort);
  })();
  </script>
</body>
</html>`;
}

function buildPostPage(post, allPosts) {
  const readTime = estimateReadingTime(post.wordCount);
  const meta = [formatDate(post.postedAt), readTime].filter(Boolean).join(' · ');

  // Next story is always by date (chronological)
  const byDate = [...allPosts].sort((a, b) => new Date(b.postedAt) - new Date(a.postedAt));
  const dateIdx = byDate.findIndex(p => p.slug === post.slug);
  const nextDate = dateIdx < byDate.length - 1 ? byDate[dateIdx + 1] : null;

  const content = `
    <article>
      <header class="post-header">
        <h1>${post.title}</h1>
        <p class="post-meta">${meta}</p>
      </header>
      <div class="post-body">
        ${cleanHtml(post.htmlBody)}
      </div>
      <footer class="post-footer post-nav">
        <a href="index.html" class="post-nav-link" onclick="try{localStorage.setItem('sort','date')}catch(e){}">Home</a>
        ${nextDate ? `<a href="${nextDate.slug}.html" class="post-nav-link post-nav-next">Next: ${nextDate.title}</a>` : ''}
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
  --serif: Charter, 'Bitstream Charter', 'Noto Serif', 'DejaVu Serif', 'Liberation Serif', Georgia, serif;
  --sans: -apple-system, 'Segoe UI', system-ui, 'Noto Sans', 'DejaVu Sans', 'Liberation Sans', sans-serif;
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
  padding: 1.5rem 0;
  position: fixed;
  top: 3rem;
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

.sort-toggle {
  display: flex;
  gap: 0;
  padding: 0.6rem 1.4rem 0.5rem;
}

.sort-btn {
  flex: 1;
  padding: 0.3rem 0;
  font-family: var(--sans);
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-light);
  background: none;
  border: 1px solid var(--border);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.sort-btn:first-child { border-radius: var(--radius) 0 0 var(--radius); }
.sort-btn:last-child { border-radius: 0 var(--radius) var(--radius) 0; border-left: none; }
.sort-btn.active {
  background: var(--active-bg);
  color: var(--accent);
}
.sort-btn:hover:not(.active) {
  background: var(--active-bg);
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

/* --- Top bar --- */
.top-bar {
  position: fixed;
  top: 0;
  left: var(--sidebar-width);
  right: 0;
  height: 3rem;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  padding: 0 1.5rem;
  z-index: 15;
  font-family: var(--sans);
  gap: 1rem;
}

.top-bar-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text);
  text-decoration: none;
  margin-right: auto;
  display: none;
}

.top-bar-actions {
  display: flex;
  gap: 0.5rem;
  margin-left: auto;
}

.top-bar-btn {
  padding: 0.35rem 0.9rem;
  font-size: 0.75rem;
  font-weight: 600;
  text-decoration: none;
  border-radius: var(--radius);
  transition: background 0.15s, color 0.15s;
  border: 1px solid var(--border);
  color: var(--text);
  background: var(--bg);
}
.top-bar-btn:hover {
  background: var(--sidebar-bg);
  color: var(--accent);
}

.top-bar-btn-primary {
  background: #a0734f;
  color: #fff;
  border-color: #a0734f;
}
.top-bar-btn-primary:hover {
  background: #8b6243;
  border-color: #8b6243;
  color: #fff;
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
  margin-top: 3rem;
  flex: 1;
  padding: 3rem 2.5rem 6rem;
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

.post-nav {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.post-nav-link {
  font-size: 0.85rem;
  font-weight: 600;
}

.post-nav-next {
  text-align: right;
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

/* --- Mobile hamburger (in top bar) --- */
.menu-button {
  display: none;
  background: none;
  border: none;
  width: 2rem;
  height: 2rem;
  padding: 0;
  cursor: pointer;
  font-size: 1.2rem;
  line-height: 2rem;
  text-align: center;
  color: var(--text);
  flex-shrink: 0;
}
.menu-button:hover {
  color: var(--accent);
}

@media (max-width: 860px) {
  .menu-button { display: block; }
  .top-bar-title { display: block; }

  .top-bar {
    left: 0;
  }

  .sidebar {
    transform: translateX(-100%);
    transition: transform 0.25s ease;
    box-shadow: none;
    top: 3rem;
    height: calc(100vh - 3rem);
  }

  #menu-toggle:checked ~ .sidebar {
    transform: translateX(0);
    box-shadow: 4px 0 24px rgba(0,0,0,0.08);
  }

  #menu-toggle:checked ~ .menu-overlay {
    display: block;
    position: fixed;
    inset: 0;
    top: 3rem;
    z-index: 5;
    background: rgba(0,0,0,0.15);
  }

  main {
    margin-left: 0;
    padding: 2rem 1.5rem 4rem;
  }

  .post-header h1, .index-page h1 {
    font-size: 1.75rem;
  }
}

@media (max-width: 520px) {
  html { font-size: 17px; }

  .top-bar-btn { padding: 0.3rem 0.6rem; font-size: 0.7rem; }

  main {
    padding: 1.5rem 1.2rem 3rem;
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

/* Low-res screens: swap serif for more legible sans */
@media (max-resolution: 1.5dppx) {
  :root {
    --serif: 'Segoe UI', system-ui, -apple-system, 'Noto Sans', 'DejaVu Sans', 'Liberation Sans', sans-serif;
  }
  body { line-height: 1.7; }
}

/* --- Dark mode --- */
[data-theme="dark"] {
  --bg: #1a1a1e;
  --text: #e0ddd8;
  --text-light: #9a9590;
  --accent: #c8956a;
  --border: #2e2e33;
  --sidebar-bg: #222226;
  --active-bg: #2a2a2f;
  --link: #c8956a;
}

[data-theme="dark"] ::selection {
  background: rgba(200, 149, 106, 0.25);
}

[data-theme="dark"] .top-bar-btn-primary {
  background: #a0734f;
  border-color: #a0734f;
}
[data-theme="dark"] .top-bar-btn-primary:hover {
  background: #8b6243;
  border-color: #8b6243;
}

[data-theme="dark"] .post-body a {
  text-decoration-color: rgba(200, 149, 106, 0.3);
}
[data-theme="dark"] .post-body a:hover {
  text-decoration-color: var(--link);
}
[data-theme="dark"] .post-footer a {
  text-decoration-color: rgba(200, 149, 106, 0.3);
}

@media (prefers-color-scheme: dark) {
  [data-theme="auto"] {
    --bg: #1a1a1e;
    --text: #e0ddd8;
    --text-light: #9a9590;
    --accent: #c8956a;
    --border: #2e2e33;
    --sidebar-bg: #222226;
    --active-bg: #2a2a2f;
    --link: #c8956a;
  }
  [data-theme="auto"] ::selection {
    background: rgba(200, 149, 106, 0.25);
  }
  [data-theme="auto"] .top-bar-btn-primary {
    background: #a0734f;
    border-color: #a0734f;
  }
  [data-theme="auto"] .top-bar-btn-primary:hover {
    background: #8b6243;
    border-color: #8b6243;
  }
  [data-theme="auto"] .post-body a {
    text-decoration-color: rgba(200, 149, 106, 0.3);
  }
  [data-theme="auto"] .post-body a:hover {
    text-decoration-color: var(--link);
  }
  [data-theme="auto"] .post-footer a {
    text-decoration-color: rgba(200, 149, 106, 0.3);
  }
}

.theme-toggle {
  background: none;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.35rem 0.55rem;
  cursor: pointer;
  font-size: 0.85rem;
  line-height: 1;
  color: var(--text);
  transition: background 0.15s, color 0.15s;
}
.theme-toggle:hover {
  background: var(--sidebar-bg);
  color: var(--accent);
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
    .replace(/&nbsp;/g, '\u00a0')
    .replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;')
    .replace(/<p>\s*<\/p>/g, '')
    .replace(/class="[^"]*"/g, '')
    .replace(/(<(?!img\b)[^>]*)\s+style="[^"]*"/gi, '$1');
}

function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// --- Minimal PNG rasterizer (no dependencies) ---

function createPixelBuffer(w, h) {
  return { w, h, data: new Uint8Array(w * h * 3) };
}

function setPixel(buf, x, y, r, g, b, a) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || x >= buf.w || y < 0 || y >= buf.h) return;
  const i = (y * buf.w + x) * 3;
  const inv = 1 - a;
  buf.data[i]     = Math.round(buf.data[i] * inv + r * a);
  buf.data[i + 1] = Math.round(buf.data[i + 1] * inv + g * a);
  buf.data[i + 2] = Math.round(buf.data[i + 2] * inv + b * a);
}

function drawCircleRing(buf, cx, cy, radius, r, g, b, a, strokeW) {
  const rOuter = radius + strokeW / 2;
  const rInner = radius - strokeW / 2;
  const x0 = Math.max(0, Math.floor(cx - rOuter - 1));
  const x1 = Math.min(buf.w - 1, Math.ceil(cx + rOuter + 1));
  const y0 = Math.max(0, Math.floor(cy - rOuter - 1));
  const y1 = Math.min(buf.h - 1, Math.ceil(cy + rOuter + 1));
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
      // Antialiased ring
      const outer = Math.max(0, Math.min(1, rOuter - dist + 0.5));
      const inner = Math.max(0, Math.min(1, dist - rInner + 0.5));
      const coverage = outer * inner;
      if (coverage > 0) setPixel(buf, px, py, r, g, b, a * coverage);
    }
  }
}

function drawFilledCircle(buf, cx, cy, radius, r, g, b, a) {
  const x0 = Math.max(0, Math.floor(cx - radius - 1));
  const x1 = Math.min(buf.w - 1, Math.ceil(cx + radius + 1));
  const y0 = Math.max(0, Math.floor(cy - radius - 1));
  const y1 = Math.min(buf.h - 1, Math.ceil(cy + radius + 1));
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
      const coverage = Math.max(0, Math.min(1, radius - dist + 0.5));
      if (coverage > 0) setPixel(buf, px, py, r, g, b, a * coverage);
    }
  }
}

function drawLine(buf, x1, y1, x2, y2, r, g, b, a, w) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return;
  const halfW = w / 2;

  // For short or steep segments, stamp circles (original method)
  if (len < 3) {
    const steps = Math.ceil(len * 2);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      drawFilledCircle(buf, x1 + dx * t, y1 + dy * t, halfW, r, g, b, a);
    }
    return;
  }

  // Anti-aliased line using perpendicular distance
  const nx = -dy / len, ny = dx / len; // unit normal
  const pad = Math.ceil(halfW + 1.5);
  const pxMin = Math.max(0, Math.floor(Math.min(x1, x2) - pad));
  const pxMax = Math.min(buf.w - 1, Math.ceil(Math.max(x1, x2) + pad));
  const pyMin = Math.max(0, Math.floor(Math.min(y1, y2) - pad));
  const pyMax = Math.min(buf.h - 1, Math.ceil(Math.max(y1, y2) + pad));

  for (let py = pyMin; py <= pyMax; py++) {
    for (let px = pxMin; px <= pxMax; px++) {
      // Project onto line segment
      const ex = px - x1, ey = py - y1;
      let t = (ex * dx + ey * dy) / (len * len);
      // Perpendicular distance
      let dist;
      if (t < 0) {
        dist = Math.sqrt(ex * ex + ey * ey);
      } else if (t > 1) {
        const fx = px - x2, fy = py - y2;
        dist = Math.sqrt(fx * fx + fy * fy);
      } else {
        dist = Math.abs(ex * nx + ey * ny);
      }
      const coverage = Math.max(0, Math.min(1, halfW - dist + 0.5));
      if (coverage > 0) setPixel(buf, px, py, r, g, b, a * coverage);
    }
  }
}

function drawText(buf, text, cx, baseY, fontSize, r, g, b, a) {
  // 5x7 bitmap glyphs, rendered at 2x into temp buffer then downsampled for anti-aliasing
  const glyphs = {
    'A': ['01110','10001','10001','11111','10001','10001','10001'],
    'B': ['11110','10001','10001','11110','10001','10001','11110'],
    'C': ['01110','10001','10000','10000','10000','10001','01110'],
    'D': ['11100','10010','10001','10001','10001','10010','11100'],
    'E': ['11111','10000','10000','11110','10000','10000','11111'],
    'F': ['11111','10000','10000','11110','10000','10000','10000'],
    'G': ['01110','10001','10000','10111','10001','10001','01110'],
    'H': ['10001','10001','10001','11111','10001','10001','10001'],
    'I': ['11111','00100','00100','00100','00100','00100','11111'],
    'J': ['00111','00010','00010','00010','00010','10010','01100'],
    'K': ['10001','10010','10100','11000','10100','10010','10001'],
    'L': ['10000','10000','10000','10000','10000','10000','11111'],
    'M': ['10001','11011','10101','10101','10001','10001','10001'],
    'N': ['10001','11001','10101','10011','10001','10001','10001'],
    'O': ['01110','10001','10001','10001','10001','10001','01110'],
    'P': ['11110','10001','10001','11110','10000','10000','10000'],
    'Q': ['01110','10001','10001','10001','10101','10010','01101'],
    'R': ['11110','10001','10001','11110','10100','10010','10001'],
    'S': ['01111','10000','10000','01110','00001','00001','11110'],
    'T': ['11111','00100','00100','00100','00100','00100','00100'],
    'U': ['10001','10001','10001','10001','10001','10001','01110'],
    'V': ['10001','10001','10001','10001','01010','01010','00100'],
    'W': ['10001','10001','10001','10101','10101','10101','01010'],
    'X': ['10001','10001','01010','00100','01010','10001','10001'],
    'Y': ['10001','10001','01010','00100','00100','00100','00100'],
    'Z': ['11111','00001','00010','00100','01000','10000','11111'],
    ' ': ['00000','00000','00000','00000','00000','00000','00000'],
    '.': ['00000','00000','00000','00000','00000','00000','00100'],
    ',': ['00000','00000','00000','00000','00000','00100','01000'],
    '-': ['00000','00000','00000','11111','00000','00000','00000'],
    '\'':['00100','00100','00000','00000','00000','00000','00000'],
    '\u00e1':['00010','00100','01110','00001','01111','10001','01111'], // á
    '0': ['01110','10001','10011','10101','11001','10001','01110'],
    '1': ['00100','01100','00100','00100','00100','00100','01110'],
    '2': ['01110','10001','00001','00010','00100','01000','11111'],
    '3': ['01110','10001','00001','00110','00001','10001','01110'],
    '4': ['00010','00110','01010','10010','11111','00010','00010'],
    '5': ['11111','10000','11110','00001','00001','10001','01110'],
    '6': ['01110','10001','10000','11110','10001','10001','01110'],
    '7': ['11111','00001','00010','00100','01000','01000','01000'],
    '8': ['01110','10001','10001','01110','10001','10001','01110'],
    '9': ['01110','10001','10001','01111','00001','10001','01110'],
    'a': ['00000','00000','01110','00001','01111','10001','01111'],
    'b': ['10000','10000','11110','10001','10001','10001','11110'],
    'c': ['00000','00000','01110','10000','10000','10001','01110'],
    'd': ['00001','00001','01111','10001','10001','10001','01111'],
    'e': ['00000','00000','01110','10001','11111','10000','01110'],
    'f': ['00110','01001','01000','11100','01000','01000','01000'],
    'g': ['00000','00000','01111','10001','01111','00001','01110'],
    'h': ['10000','10000','10110','11001','10001','10001','10001'],
    'i': ['00100','00000','01100','00100','00100','00100','01110'],
    'j': ['00010','00000','00110','00010','00010','10010','01100'],
    'k': ['10000','10000','10010','10100','11000','10100','10010'],
    'l': ['01100','00100','00100','00100','00100','00100','01110'],
    'm': ['00000','00000','11010','10101','10101','10001','10001'],
    'n': ['00000','00000','10110','11001','10001','10001','10001'],
    'o': ['00000','00000','01110','10001','10001','10001','01110'],
    'p': ['00000','00000','11110','10001','11110','10000','10000'],
    'q': ['00000','00000','01111','10001','01111','00001','00001'],
    'r': ['00000','00000','10110','11001','10000','10000','10000'],
    's': ['00000','00000','01110','10000','01110','00001','11110'],
    't': ['01000','01000','11100','01000','01000','01001','00110'],
    'u': ['00000','00000','10001','10001','10001','10011','01101'],
    'v': ['00000','00000','10001','10001','10001','01010','00100'],
    'w': ['00000','00000','10001','10001','10101','10101','01010'],
    'x': ['00000','00000','10001','01010','00100','01010','10001'],
    'y': ['00000','00000','10001','10001','01111','00001','01110'],
    'z': ['00000','00000','11111','00010','00100','01000','11111'],
  };

  // Render at 6x, blur, then downsample for smooth bookish text
  const SS = 6;
  const scale = Math.max(1, Math.round(fontSize / 7)) * SS;
  const charW = 6 * scale;
  const glyphH = 7 * scale;
  const totalW = text.length * charW;
  const tw = totalW;
  const th = glyphH;
  const tmp = new Float32Array(tw * th);

  // Render crisp glyphs into temp buffer
  for (let ci = 0; ci < text.length; ci++) {
    const ch = text[ci];
    const glyph = glyphs[ch] || glyphs[ch.toUpperCase()] || glyphs[ch.toLowerCase()] || glyphs[' '];
    const ox = ci * charW;
    for (let gy = 0; gy < 7; gy++) {
      for (let gx = 0; gx < 5; gx++) {
        if (glyph[gy][gx] === '1') {
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              const px = ox + gx * scale + sx;
              const py = gy * scale + sy;
              if (px >= 0 && px < tw && py >= 0 && py < th) {
                tmp[py * tw + px] = 1;
              }
            }
          }
        }
      }
    }
  }

  // Gaussian blur (separable, radius scales with SS)
  const blurR = Math.round(SS * 0.9);
  const kernel = [];
  let kSum = 0;
  for (let i = -blurR; i <= blurR; i++) {
    const v = Math.exp(-(i * i) / (2 * (blurR * 0.45) * (blurR * 0.45)));
    kernel.push(v);
    kSum += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= kSum;

  // Horizontal pass
  const tmp2 = new Float32Array(tw * th);
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      let v = 0;
      for (let k = -blurR; k <= blurR; k++) {
        const sx = Math.min(tw - 1, Math.max(0, x + k));
        v += tmp[y * tw + sx] * kernel[k + blurR];
      }
      tmp2[y * tw + x] = v;
    }
  }
  // Vertical pass
  const tmp3 = new Float32Array(tw * th);
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      let v = 0;
      for (let k = -blurR; k <= blurR; k++) {
        const sy = Math.min(th - 1, Math.max(0, y + k));
        v += tmp2[sy * tw + x] * kernel[k + blurR];
      }
      tmp3[y * tw + x] = v;
    }
  }

  // Downsample blurred buffer into main buffer
  const outW = Math.ceil(tw / SS);
  const outH = Math.ceil(th / SS);
  const startX = Math.round(cx - outW / 2);
  for (let oy = 0; oy < outH; oy++) {
    for (let ox = 0; ox < outW; ox++) {
      let sum = 0;
      let count = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = ox * SS + sx;
          const py = oy * SS + sy;
          if (px < tw && py < th) { sum += tmp3[py * tw + px]; count++; }
        }
      }
      const coverage = sum / count;
      if (coverage > 0.01) {
        setPixel(buf, startX + ox, baseY + oy, r, g, b, a * Math.min(1, coverage * 1.8));
      }
    }
  }
}

function encodePng(buf) {
  const { w, h, data } = buf;
  // Build raw scanlines with filter byte (0 = None)
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0; // filter: None
    data.copy ? Buffer.from(data).copy(raw, y * (1 + w * 3) + 1, y * w * 3, (y + 1) * w * 3)
      : raw.set(data.subarray(y * w * 3, (y + 1) * w * 3), y * (1 + w * 3) + 1);
  }
  const compressed = zlib.deflateSync(Buffer.from(raw), { level: 9 });

  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const typeData = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(typeData) >>> 0);
    return Buffer.concat([len, typeData, crc]);
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}

function perlinNoise() {
  // Classic Perlin noise implementation
  const perm = new Uint8Array(512);
  const grad = [
    [1,1],[-1,1],[1,-1],[-1,-1],
    [1,0],[-1,0],[0,1],[0,-1],
  ];
  // Initialize permutation table
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  // Fisher-Yates shuffle with deterministic seed
  let seed = 42;
  const rand = () => { seed = (seed * 16807 + 0) % 2147483647; return seed / 2147483647; };
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function lerp(a, b, t) { return a + t * (b - a); }
  function dot(g, x, y) { return g[0] * x + g[1] * y; }

  return function noise(x, y) {
    const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = fade(xf), v = fade(yf);
    const aa = perm[perm[xi] + yi] & 7;
    const ab = perm[perm[xi] + yi + 1] & 7;
    const ba = perm[perm[xi + 1] + yi] & 7;
    const bb = perm[perm[xi + 1] + yi + 1] & 7;
    return lerp(
      lerp(dot(grad[aa], xf, yf), dot(grad[ba], xf - 1, yf), u),
      lerp(dot(grad[ab], xf, yf - 1), dot(grad[bb], xf - 1, yf - 1), u),
      v
    );
  };
}

// Cover style: 'flow', 'stipple', 'hatch', 'ridge'
let COVER_STYLE = 'ridge';
// Ridge color palette: 'warm', 'navy', 'teal', 'ink', 'ember'
let RIDGE_PALETTE = 'noir';

const RIDGE_PALETTES = {
  warm:  { bg: [252, 249, 242], front: [35, 28, 22],  back: [70, 60, 52],  title: 'rgba(30,25,20,0.95)',  sub: 'rgba(100,85,70,0.6)',   author: 'rgba(70,55,40,0.8)' },
  navy:  { bg: [240, 243, 250], front: [15, 30, 75],  back: [80, 100, 150], title: 'rgba(15,30,75,0.95)', sub: 'rgba(60,75,120,0.6)',   author: 'rgba(30,50,100,0.8)' },
  teal:  { bg: [240, 250, 248], front: [10, 50, 50],  back: [70, 130, 120], title: 'rgba(10,50,50,0.95)', sub: 'rgba(50,100,90,0.6)',   author: 'rgba(30,70,60,0.8)' },
  ink:   { bg: [248, 248, 248], front: [10, 10, 10],  back: [90, 90, 90],  title: 'rgba(10,10,10,0.95)',  sub: 'rgba(80,80,80,0.6)',    author: 'rgba(40,40,40,0.8)' },
  ember: { bg: [252, 246, 240], front: [80, 20, 10],  back: [160, 80, 50], title: 'rgba(80,20,10,0.95)',  sub: 'rgba(140,70,40,0.6)',   author: 'rgba(100,40,20,0.8)' },
  noir:  { bg: [18, 18, 22],    front: [240, 240, 235], back: [100, 100, 110], title: 'rgba(240,240,235,0.95)', sub: 'rgba(180,180,175,0.6)', author: 'rgba(210,210,205,0.8)' },
};

function buildCoverPng(posts, bookTitle) {
  const W = 1200;
  const H = 1800;
  const n = posts.length;
  const coverPal = RIDGE_PALETTES[RIDGE_PALETTE] || RIDGE_PALETTES.warm;

  // Art occupies top ~70% of cover
  const artH = Math.round(H * 0.70);

  const buf = createPixelBuffer(W, H);
  // Fill background with palette color
  for (let i = 0; i < buf.data.length; i += 3) {
    buf.data[i] = coverPal.bg[0]; buf.data[i + 1] = coverPal.bg[1]; buf.data[i + 2] = coverPal.bg[2];
  }

  // Seed Perlin noise from story data
  const noise = perlinNoise();

  // Multi-octave noise for richer detail
  function fbm(x, y, octaves) {
    let val = 0, amp = 1, freq = 1, max = 0;
    for (let i = 0; i < octaves; i++) {
      val += noise(x * freq, y * freq) * amp;
      max += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return val / max;
  }

  // --- Ridge style: displaced horizontal lines creating a terrain effect ---
  if (COVER_STYLE === 'ridge') {
    const pal = RIDGE_PALETTES[RIDGE_PALETTE] || RIDGE_PALETTES.warm;
    const lineCount = 120 + n * 3;
    const lineSpacing = artH / (lineCount + 1);
    const amplitude = lineSpacing * 10;
    const nScale = 0.0018;
    const xStep = 1;

    // Fill background with palette color
    for (let i = 0; i < buf.data.length; i += 3) {
      buf.data[i] = pal.bg[0]; buf.data[i + 1] = pal.bg[1]; buf.data[i + 2] = pal.bg[2];
    }

    // Draw from top to bottom — each line's fill occludes lines above (behind)
    for (let li = 0; li <= lineCount; li++) {
      const baseY = (li + 1) * lineSpacing;
      const yNorm = li / lineCount; // 0=top, 1=bottom
      const vertEnv = Math.pow(Math.sin(yNorm * Math.PI), 0.5);

      // Build polyline with noise displacement
      const pts = [];
      for (let x = 0; x <= W; x += xStep) {
        const nVal = fbm(x * nScale, baseY * nScale * 0.5, 5);
        const bump = fbm(x * nScale * 3, baseY * nScale * 2, 3) * 0.3;
        const xNorm = x / W;
        const horzEnv = Math.pow(Math.sin(xNorm * Math.PI), 0.3);
        const disp = (nVal + bump) * amplitude * vertEnv * horzEnv;
        pts.push({ x, y: baseY - Math.abs(disp) });
      }

      // Fill below the polyline with background color to occlude lines behind
      const fillBottom = baseY + amplitude + 5;
      for (let i = 0; i < pts.length - 1; i++) {
        const x0 = pts[i].x, y0 = pts[i].y;
        const x1 = pts[i + 1].x, y1 = pts[i + 1].y;
        const xMin = Math.floor(Math.min(x0, x1));
        const xMax = Math.ceil(Math.max(x0, x1));
        for (let fx = xMin; fx <= xMax && fx < W; fx++) {
          if (fx < 0) continue;
          const t = x1 !== x0 ? (fx - x0) / (x1 - x0) : 0;
          const topY = Math.floor(y0 + (y1 - y0) * Math.max(0, Math.min(1, t)));
          const botY = Math.min(Math.floor(fillBottom), artH);
          for (let fy = Math.max(0, topY); fy < botY; fy++) {
            const idx = (fy * W + fx) * 3;
            buf.data[idx] = pal.bg[0];
            buf.data[idx + 1] = pal.bg[1];
            buf.data[idx + 2] = pal.bg[2];
          }
        }
      }

      // Draw the polyline — interpolate color from back to front
      const depth = yNorm;
      const lineR = Math.round(pal.back[0] + (pal.front[0] - pal.back[0]) * depth);
      const lineG = Math.round(pal.back[1] + (pal.front[1] - pal.back[1]) * depth);
      const lineB = Math.round(pal.back[2] + (pal.front[2] - pal.back[2]) * depth);
      const weight = 0.8 + depth * 1.5;
      for (let i = 1; i < pts.length; i++) {
        drawLine(buf, pts[i-1].x, pts[i-1].y, pts[i].x, pts[i].y,
          lineR, lineG, lineB, 0.9, weight);
      }
    }

    // Skip the flow field code below — jump to text rendering
  } else {

  // Build angle field using Perlin noise
  // Scale and offset influenced by number of stories
  const noiseScale = 0.0008 + n * 0.00005; // very low frequency = big sweeping forms
  const octaves = 2;                        // smooth, minimal detail

  function getAngle(x, y) {
    return fbm(x * noiseScale, y * noiseScale, octaves) * Math.PI * 3;
  }

  // Distance grid to enforce minimum spacing between curves
  const cellSize = 4;
  const gridW = Math.ceil(W / cellSize);
  const gridH = Math.ceil(artH / cellSize);
  const occupied = new Uint8Array(gridW * gridH);
  const minSpacing = 10; // minimum pixels between curves

  function isOccupied(x, y) {
    const gx = Math.floor(x / cellSize);
    const gy = Math.floor(y / cellSize);
    if (gx < 0 || gx >= gridW || gy < 0 || gy >= gridH) return false;
    return occupied[gy * gridW + gx];
  }

  function markOccupied(x, y) {
    const r = Math.ceil(minSpacing / cellSize);
    const gx = Math.floor(x / cellSize);
    const gy = Math.floor(y / cellSize);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = gx + dx, ny = gy + dy;
        if (nx >= 0 && nx < gridW && ny >= 0 && ny < gridH) {
          occupied[ny * gridW + nx] = 1;
        }
      }
    }
  }

  // Generate seed points distributed across the art area
  const seedPoints = [];
  const seedSpacing = 20;
  for (let y = seedSpacing; y < artH - seedSpacing; y += seedSpacing) {
    for (let x = seedSpacing; x < W - seedSpacing; x += seedSpacing) {
      seedPoints.push({ x, y });
    }
  }
  // Shuffle for random draw order (deterministic)
  let shuffleSeed = 137;
  const srand = () => { shuffleSeed = (shuffleSeed * 16807) % 2147483647; return shuffleSeed / 2147483647; };
  for (let i = seedPoints.length - 1; i > 0; i--) {
    const j = Math.floor(srand() * (i + 1));
    [seedPoints[i], seedPoints[j]] = [seedPoints[j], seedPoints[i]];
  }

  // Trace curves through the flow field
  const stepLen = 2;
  const maxSteps = 600;
  const pad = 5;

  for (const seed of seedPoints) {
    if (isOccupied(seed.x, seed.y)) continue;

    // Trace in both directions from seed
    const segments = [];
    for (const dir of [1, -1]) {
      let x = seed.x, y = seed.y;
      const pts = [{ x, y }];
      for (let s = 0; s < maxSteps; s++) {
        const angle = getAngle(x, y);
        const nx = x + Math.cos(angle) * stepLen * dir;
        const ny = y + Math.sin(angle) * stepLen * dir;
        if (nx < -pad || nx > W + pad || ny < -pad || ny > artH + pad) break;
        if (isOccupied(nx, ny) && s > 3) break;
        x = nx; y = ny;
        pts.push({ x, y });
      }
      segments.push(pts);
    }

    // Combine: reverse the backward segment + forward segment
    const curve = [...segments[1].reverse(), ...segments[0].slice(1)];
    if (curve.length < 15) continue;

    // Mark all points as occupied
    for (const p of curve) markOccupied(p.x, p.y);

    const len = curve.length;

    if (COVER_STYLE === 'stipple') {
      // Dots placed along the curve, density varies with noise
      for (let i = 0; i < len; i++) {
        const px = curve[i].x, py = curve[i].y;
        const density = 0.3 + Math.abs(noise(px * 0.004, py * 0.004)) * 0.7;
        // Skip dots based on density — sparser in quiet areas
        if ((i % Math.max(1, Math.round(8 * (1 - density)))) !== 0) continue;
        const endFade = Math.min(i / len * 8, (1 - i / len) * 8, 1);
        const radius = 1.0 + density * 2.0;
        const op = 0.4 * endFade * density;
        drawFilledCircle(buf, px, py, radius, 55, 45, 38, op);
      }
    } else if (COVER_STYLE === 'hatch') {
      // Draw the curve, but also draw a second layer at a different noise offset
      for (let i = 1; i < len; i++) {
        const t = i / len;
        const px = curve[i].x, py = curve[i].y;
        const endFade = Math.min(t * 8, (1 - t) * 8, 1);
        const density = Math.abs(noise(px * 0.005, py * 0.005));
        const weight = 0.8 + density * 0.8;
        const op = 0.35 * endFade;
        drawLine(buf, curve[i - 1].x, curve[i - 1].y, px, py, 55, 45, 38, op, weight);
      }
    } else {
      // 'flow' — original flowing lines with variable weight
      for (let i = 1; i < len; i++) {
        const t = i / len;
        const px = curve[i].x, py = curve[i].y;
        const endFade = Math.min(t * 8, (1 - t) * 8, 1);
        const op = 0.45 * endFade;
        const density = Math.abs(noise(px * 0.005, py * 0.005));
        const weight = 1.0 + density * 1.2;
        const r = 60, g = 50, b = 42;
        drawLine(buf, curve[i - 1].x, curve[i - 1].y, px, py, r, g, b, op, weight);
      }
    }
  }

  // Hatch style: draw a second pass with a different noise field rotated ~60°
  if (COVER_STYLE === 'hatch') {
    const occupied2 = new Uint8Array(gridW * gridH);
    function isOcc2(x, y) {
      const gx = Math.floor(x / cellSize), gy = Math.floor(y / cellSize);
      if (gx < 0 || gx >= gridW || gy < 0 || gy >= gridH) return false;
      return occupied2[gy * gridW + gx] || occupied[gy * gridW + gx];
    }
    function markOcc2(x, y) {
      const r2 = Math.ceil(minSpacing / cellSize);
      const gx = Math.floor(x / cellSize), gy = Math.floor(y / cellSize);
      for (let dy = -r2; dy <= r2; dy++) {
        for (let dx = -r2; dx <= r2; dx++) {
          const nx = gx + dx, ny = gy + dy;
          if (nx >= 0 && nx < gridW && ny >= 0 && ny < gridH) occupied2[ny * gridW + nx] = 1;
        }
      }
    }
    function getAngle2(x, y) {
      return fbm((x + 500) * noiseScale * 1.3, (y + 500) * noiseScale * 1.3, octaves) * Math.PI * 3 + Math.PI * 0.6;
    }
    // Reuse shuffled seeds in different order
    let ss2 = 293;
    const sr2 = () => { ss2 = (ss2 * 16807) % 2147483647; return ss2 / 2147483647; };
    const seeds2 = [...seedPoints];
    for (let i = seeds2.length - 1; i > 0; i--) {
      const j = Math.floor(sr2() * (i + 1));
      [seeds2[i], seeds2[j]] = [seeds2[j], seeds2[i]];
    }
    for (const seed of seeds2) {
      if (isOcc2(seed.x, seed.y)) continue;
      const segs = [];
      for (const dir of [1, -1]) {
        let x = seed.x, y = seed.y;
        const pts = [{ x, y }];
        for (let s = 0; s < maxSteps; s++) {
          const angle = getAngle2(x, y);
          const nx2 = x + Math.cos(angle) * stepLen * dir;
          const ny2 = y + Math.sin(angle) * stepLen * dir;
          if (nx2 < -pad || nx2 > W + pad || ny2 < -pad || ny2 > artH + pad) break;
          if (isOcc2(nx2, ny2) && s > 3) break;
          x = nx2; y = ny2;
          pts.push({ x, y });
        }
        segs.push(pts);
      }
      const crv = [...segs[1].reverse(), ...segs[0].slice(1)];
      if (crv.length < 15) continue;
      for (const p of crv) markOcc2(p.x, p.y);
      for (let i = 1; i < crv.length; i++) {
        const t = i / crv.length;
        const endFade = Math.min(t * 8, (1 - t) * 8, 1);
        const density = Math.abs(noise(crv[i].x * 0.005, crv[i].y * 0.005));
        const weight = 0.8 + density * 0.8;
        drawLine(buf, crv[i-1].x, crv[i-1].y, crv[i].x, crv[i].y, 55, 45, 38, 0.25 * endFade, weight);
      }
    }
  }

  } // end else (non-ridge styles)

  // Composite pixel buffer onto canvas, then add text with proper fonts
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Paint pixel buffer onto canvas
  const imgData = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const si = (y * W + x) * 3;
      const di = (y * W + x) * 4;
      imgData.data[di] = buf.data[si];
      imgData.data[di + 1] = buf.data[si + 1];
      imgData.data[di + 2] = buf.data[si + 2];
      imgData.data[di + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  // Title text with system fonts
  const titleParts = bookTitle.split(' and Other Stories by ');
  const mainTitle = titleParts[0] || bookTitle;
  const subtitle = titleParts.length > 1 ? 'and Other Stories' : '';
  const author = titleParts.length > 1 ? titleParts[1] : '';

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  // Main title
  ctx.font = '300 72px "Georgia", "Noto Serif", "DejaVu Serif", serif';
  ctx.fillStyle = coverPal.title;
  ctx.fillText(mainTitle, W / 2, H * 0.735);

  // Subtitle
  ctx.font = '300 26px "Georgia", "Noto Serif", "DejaVu Serif", serif';
  ctx.fillStyle = coverPal.sub;
  ctx.fillText(subtitle.toLowerCase(), W / 2, H * 0.735 + 90);

  // Author
  ctx.font = '300 34px "Georgia", "Noto Serif", "DejaVu Serif", serif';
  ctx.fillStyle = coverPal.author;
  ctx.fillText(author, W / 2, H * 0.865);

  return canvas.toBuffer('image/png');
}

async function downloadImage(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    const buf = Buffer.from(await res.arrayBuffer());
    let ext = 'png';
    let mediaType = 'image/png';
    if (contentType.includes('jpeg') || contentType.includes('jpg') || url.match(/\.jpe?g/i)) {
      ext = 'jpg'; mediaType = 'image/jpeg';
    } else if (contentType.includes('gif') || url.match(/\.gif/i)) {
      ext = 'gif'; mediaType = 'image/gif';
    } else if (contentType.includes('svg') || url.match(/\.svg/i)) {
      ext = 'svg'; mediaType = 'image/svg+xml';
    } else if (contentType.includes('webp') || url.match(/\.webp/i)) {
      ext = 'webp'; mediaType = 'image/webp';
    } else if (contentType.includes('png') || url.match(/\.png/i)) {
      ext = 'png'; mediaType = 'image/png';
    }
    return { data: buf, ext, mediaType };
  } catch (e) {
    console.warn(`  Warning: failed to download ${url}: ${e.message}`);
    return null;
  }
}

async function buildEpub(posts, sortLabel, bookTitle) {
  const bookId = `tomas-b-fiction-by-${sortLabel}`;
  const entries = [];
  const allImages = []; // { id, filename, mediaType, data }

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

  // Cover — rasterized PNG for universal reader compatibility
  const coverPng = buildCoverPng(posts, bookTitle);
  entries.push({ name: 'OEBPS/cover.png', data: coverPng });

  const coverXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Cover</title>
<style>body { margin: 0; padding: 0; text-align: center; background: #fcf9f2; } img { max-width: 100%; max-height: 100vh; }</style>
</head>
<body epub:type="cover">
<img src="cover.png" alt="Cover"/>
</body>
</html>`;
  entries.push({ name: 'OEBPS/cover.xhtml', data: Buffer.from(coverXhtml) });

  // Half title page
  const halfTitlePageXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${bookTitle}</title>
<style>
body { font-family: serif; margin: 2em; text-align: center; }
h1 { font-size: 2em; margin-top: 8em; }
</style>
</head>
<body>
<h1>${bookTitle.split(' and Other Stories')[0]}</h1>
</body>
</html>`;
  entries.push({ name: 'OEBPS/halftitle.xhtml', data: Buffer.from(halfTitlePageXhtml) });

  // Title page
  const year = new Date().getFullYear();
  const titlePageXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Title Page</title>
<style>
body { font-family: serif; margin: 2em; text-align: center; }
h1 { font-size: 2em; margin-top: 6em; margin-bottom: 0.3em; }
p { text-align: center; }
.subtitle { font-size: 1.1em; color: #666; margin-bottom: 2em; }
.author { font-size: 1.3em; }
</style>
</head>
<body>
<h1>${bookTitle.split(' and Other Stories')[0]}</h1>
<p class="subtitle">and Other Stories</p>
<p class="author">Tom\u00e1s Bjartur</p>
</body>
</html>`;
  entries.push({ name: 'OEBPS/titlepage.xhtml', data: Buffer.from(titlePageXhtml) });

  // Copyright page
  const copyrightPageXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Copyright</title>
<style>
body { font-family: serif; margin: 2em; text-align: center; }
p { font-size: 0.85em; color: #888; margin-top: 0.5em; }
p a { color: #555; }
.spacer { margin-top: 20em; }
</style>
</head>
<body>
<p class="spacer">\u00a9 ${year} Tom\u00e1s Bjartur. All rights reserved.</p>
<p><a href="${SUBSTACK_URL}">tomasbjartur.substack.com</a></p>
</body>
</html>`;
  entries.push({ name: 'OEBPS/copyright.xhtml', data: Buffer.from(copyrightPageXhtml) });

  // Dedication page
  const dedicationPageXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Dedication</title>
<style>
body { font-family: serif; margin: 2em; text-align: center; }
p { font-style: italic; margin-top: 8em; max-width: 20em; margin-left: auto; margin-right: auto; }
</style>
</head>
<body epub:type="dedication">
<p>To those who told me to write more, even the one who changed his mind.</p>
</body>
</html>`;
  entries.push({ name: 'OEBPS/dedication.xhtml', data: Buffer.from(dedicationPageXhtml) });

  // Chapter XHTML files — download and embed images
  const chapterFiles = [];
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    const id = `chapter${i}`;
    const filename = `${id}.xhtml`;
    // Find all image URLs in the post HTML and download them
    let body = htmlToXhtml(post.htmlBody);
    const imgRegex = /<img([^>]*?)src="([^"]+)"([^>]*?)\/?>/gi;
    const imgMatches = [...body.matchAll(imgRegex)];
    for (const match of imgMatches) {
      const url = match[2];
      if (url.startsWith('data:') || url.startsWith('images/')) continue;
      console.log(`  Downloading image: ${url.slice(0, 80)}...`);
      const img = await downloadImage(url);
      if (!img) continue;
      const imgId = `img-${allImages.length}`;
      const imgFilename = `images/${imgId}.${img.ext}`;
      allImages.push({ id: imgId, filename: imgFilename, mediaType: img.mediaType, data: img.data });
      entries.push({ name: `OEBPS/${imgFilename}`, data: img.data });
      body = body.split(match[2]).join(imgFilename);
    }

    const safeTitle = post.title.replace(/&/g, '&amp;').replace(/</g, '&lt;');

    // Half-title page — story title centered on its own page
    const halfTitleId = `halftitle${i}`;
    const halfTitleFile = `${halfTitleId}.xhtml`;
    const halfTitleXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${safeTitle}</title>
<style>
body { font-family: serif; margin: 0; padding: 0; display: flex; align-items: center; justify-content: center; min-height: 90vh; text-align: center; }
.half-title { font-size: 1.8em; font-weight: normal; font-style: italic; letter-spacing: 0.02em; }
.ornament { margin-top: 0.8em; font-size: 0.9em; color: #999; letter-spacing: 0.3em; }
</style>
</head>
<body>
<div>
<p class="half-title">${safeTitle}</p>
<p class="ornament">\u2022 \u2022 \u2022</p>
</div>
</body>
</html>`;
    entries.push({ name: `OEBPS/${halfTitleFile}`, data: Buffer.from(halfTitleXhtml) });

    // Story body — no date or read time
    const xhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${safeTitle}</title>
<style>
body { font-family: serif; margin: 1em; }
h1 { font-size: 1.6em; margin-bottom: 1.5em; }
img { max-width: 100%; height: auto; }
blockquote { border-left: 2px solid #999; padding-left: 1em; margin: 1em 0; font-style: italic; color: #555; }
hr { border: none; text-align: center; margin: 2em 0; }
hr::before { content: "\\2022\\2003\\2022\\2003\\2022"; color: #999; }
</style>
</head>
<body>
${body}
</body>
</html>`;
    entries.push({ name: `OEBPS/${filename}`, data: Buffer.from(xhtml) });
    chapterFiles.push({ halfTitleId, halfTitleFile, id, filename, title: post.title });
  }

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
    <dc:title id="main-title">${bookTitle.split(' and Other Stories')[0]}</dc:title>
    <meta refines="#main-title" property="title-type">main</meta>
    <dc:title id="subtitle">And Other Stories</dc:title>
    <meta refines="#subtitle" property="title-type">subtitle</meta>
    <dc:creator>Tom\u00e1s Bjartur</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z/, 'Z')}</meta>
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover-image" href="cover.png" media-type="image/png" properties="cover-image"/>
    <item id="halftitle" href="halftitle.xhtml" media-type="application/xhtml+xml"/>
    <item id="titlepage" href="titlepage.xhtml" media-type="application/xhtml+xml"/>
    <item id="copyright" href="copyright.xhtml" media-type="application/xhtml+xml"/>
    <item id="dedication" href="dedication.xhtml" media-type="application/xhtml+xml"/>
    <item id="toc" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${chapterFiles.map(c => `    <item id="${c.halfTitleId}" href="${c.halfTitleFile}" media-type="application/xhtml+xml"/>
    <item id="${c.id}" href="${c.filename}" media-type="application/xhtml+xml"/>`).join('\n')}
${allImages.map(img => `    <item id="${img.id}" href="${img.filename}" media-type="${img.mediaType}"/>`).join('\n')}
  </manifest>
  <spine>
    <itemref idref="cover" linear="no"/>
    <itemref idref="halftitle"/>
    <itemref idref="titlepage"/>
    <itemref idref="copyright"/>
    <itemref idref="dedication"/>
    <itemref idref="toc"/>
${chapterFiles.map(c => `    <itemref idref="${c.halfTitleId}"/>
    <itemref idref="${c.id}"/>`).join('\n')}
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
  const external = await fetchExternalStories();
  fiction.push(...external);
  console.log(`Found ${fiction.length} fiction posts (${external.length} external)`);

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
  const epub = await buildEpub(collection, 'collection', BOOK_TITLE);
  fs.writeFileSync(path.join(OUTPUT_DIR, EPUB_FILENAME), epub);
  console.log(`Wrote ${EPUB_FILENAME} (${collection.length} stories)`);

  // Generate RSS feed
  fs.writeFileSync(path.join(OUTPUT_DIR, 'feed.xml'), buildRssFeed(fiction));
  console.log('Wrote feed.xml');

  console.log(`\nDone! ${fiction.length} pages + EPUB + RSS generated in ${OUTPUT_DIR}/`);
}

// Export for testing, run if called directly
function setCoverStyle(s) { COVER_STYLE = s; }
function setRidgePalette(p) { RIDGE_PALETTE = p; }
module.exports = { buildPostPage, buildIndexPage, buildStylesheet, filterFiction, pageShell, buildSidebar, buildCoverPng, setCoverStyle, setRidgePalette };

if (require.main === module) {
  main().catch(err => {
    console.error('Build failed:', err);
    process.exit(1);
  });
}
