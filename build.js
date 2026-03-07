const fs = require('fs');
const path = require('path');

const LW_GRAPHQL = 'https://www.lesswrong.com/graphql';
const USER_SLUG = 'bjartur-tomas';
const OUTPUT_DIR = path.join(__dirname, 'dist');
const FICTION_TAG_SLUG = 'fiction';

// Site config - edit these
const SITE_TITLE = 'Tomás B.';
const SITE_SUBTITLE = 'Fiction';
const SITE_DESCRIPTION = 'Fiction by Tomás B., mirrored from LessWrong.';
const LW_PROFILE = `https://www.lesswrong.com/users/${USER_SLUG}`;

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

function filterFiction(posts) {
  return posts.filter(p =>
    p.tags && p.tags.some(t => t.slug === FICTION_TAG_SLUG) &&
    p.htmlBody && p.htmlBody.length > 100 // skip link-only posts
  );
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
    const score = sortBy === 'karma' ? `<span class="nav-score">${p.baseScore}</span>` : '';
    const date = sortBy === 'date' ? `<span class="nav-date">${formatDate(p.postedAt).replace(/\d{4}$/, m => `'${m.slice(2)}`)}</span>` : '';
    return `<li><a href="${p.slug}.html"${active}>${score}${date}<span class="nav-title">${p.title}</span></a></li>`;
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
        <h3>By Karma</h3>
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
  const meta = [formatDate(post.postedAt), readTime, `${post.baseScore} karma`].filter(Boolean).join(' · ');

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
    const meta = [formatDate(p.postedAt), readTime, `${p.baseScore} karma`].filter(Boolean).join(' · ');
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
  padding: 0 1.4rem 1.5rem;
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

.nav-score {
  min-width: 2.2em;
  text-align: right;
  color: var(--text-light);
  font-size: 0.72rem;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.nav-date {
  min-width: 5.5em;
  color: var(--text-light);
  font-size: 0.72rem;
  flex-shrink: 0;
}

.nav-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

  console.log(`\nDone! ${fiction.length} pages generated in ${OUTPUT_DIR}/`);
}

// Export for testing, run if called directly
module.exports = { buildPostPage, buildIndexPage, buildStylesheet, filterFiction, pageShell, buildSidebar };

if (require.main === module) {
  main().catch(err => {
    console.error('Build failed:', err);
    process.exit(1);
  });
}
