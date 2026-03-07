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
  --bg: #faf8f4;
  --text: #2c2825;
  --text-light: #6b6560;
  --accent: #8b4513;
  --border: #e0dbd4;
  --sidebar-bg: #f0ece6;
  --sidebar-width: 260px;
  --active-bg: #e8e2d8;
  --link: #70382e;
  --max-prose: 640px;
  --serif: Charter, 'Bitstream Charter', 'Noto Serif', Georgia, serif;
  --sans: -apple-system, 'Helvetica Neue', Helvetica, 'PingFang SC', 'Microsoft YaHei', sans-serif;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html {
  font-size: 18px;
  -webkit-font-smoothing: antialiased;
}

body {
  font-family: var(--serif);
  color: var(--text);
  background: var(--bg);
  line-height: 1.7;
  display: flex;
  min-height: 100vh;
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
  padding: 0 1.2rem 1.5rem;
  border-bottom: 1px solid var(--border);
  margin-bottom: 1rem;
}

.site-title {
  display: block;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text);
  text-decoration: none;
  letter-spacing: 0.01em;
}

.site-subtitle {
  display: block;
  color: var(--text-light);
  font-size: 0.82rem;
  margin-top: 0.15rem;
}

.nav-section h3 {
  padding: 0.6rem 1.2rem 0.3rem;
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
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
  padding: 0.3rem 1.2rem;
  color: var(--text);
  text-decoration: none;
  transition: background 0.15s;
}

.nav-section li a:hover {
  background: var(--active-bg);
}

.nav-section li a.active {
  background: var(--active-bg);
  font-weight: 600;
}

.nav-score {
  min-width: 2.2em;
  text-align: right;
  color: var(--text-light);
  font-size: 0.72rem;
  flex-shrink: 0;
}

.nav-date {
  min-width: 4.5em;
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
  padding: 1.5rem 1.2rem 0;
  border-top: 1px solid var(--border);
  margin-top: 1rem;
}

.lw-link {
  font-size: 0.75rem;
  color: var(--text-light);
  text-decoration: none;
}
.lw-link:hover { color: var(--accent); }

/* --- Main --- */
main {
  margin-left: var(--sidebar-width);
  flex: 1;
  padding: 3rem 2rem 5rem;
  display: flex;
  justify-content: center;
}

article, .index-page {
  max-width: var(--max-prose);
  width: 100%;
}

/* --- Post --- */
.post-header {
  margin-bottom: 2.5rem;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid var(--border);
}

.post-header h1 {
  font-size: 2rem;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.01em;
  margin-bottom: 0.5rem;
}

.post-meta {
  font-family: var(--sans);
  font-size: 0.82rem;
  color: var(--text-light);
}

.post-body p {
  margin-bottom: 1.2em;
}

.post-body blockquote {
  border-left: 3px solid var(--border);
  padding-left: 1.2em;
  margin: 1.5em 0;
  color: var(--text-light);
  font-style: italic;
}

.post-body h2, .post-body h3 {
  margin: 2em 0 0.8em;
  font-weight: 600;
  line-height: 1.3;
}

.post-body h2 { font-size: 1.4rem; }
.post-body h3 { font-size: 1.15rem; }

.post-body a {
  color: var(--link);
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
}

.post-body hr {
  border: none;
  text-align: center;
  margin: 2.5em 0;
}
.post-body hr::before {
  content: '* * *';
  color: var(--text-light);
  letter-spacing: 0.5em;
  font-size: 0.8rem;
}

.post-body img {
  max-width: 100%;
  height: auto;
}

.post-body pre, .post-body code {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 0.85em;
}

.post-body pre {
  background: var(--sidebar-bg);
  border: 1px solid var(--border);
  padding: 1em;
  overflow-x: auto;
  border-radius: 3px;
  margin: 1.5em 0;
}

.post-body code {
  background: var(--sidebar-bg);
  padding: 0.15em 0.35em;
  border-radius: 2px;
}

.post-body pre code {
  background: none;
  padding: 0;
}

.post-footer {
  margin-top: 3rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--border);
  font-family: var(--sans);
  font-size: 0.82rem;
  color: var(--text-light);
}

.post-footer a {
  color: var(--link);
}

/* --- Index page --- */
.index-page h1 {
  font-size: 2rem;
  font-weight: 600;
  margin-bottom: 0.3rem;
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
  padding: 0.8rem 0;
  text-decoration: none;
  color: var(--text);
  border-bottom: 1px solid var(--border);
  transition: background 0.15s;
}

.index-item a:hover {
  background: var(--sidebar-bg);
  margin: 0 -1rem;
  padding-left: 1rem;
  padding-right: 1rem;
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
  margin-top: 0.15rem;
}

/* --- Mobile hamburger --- */
.menu-button {
  display: none;
  position: fixed;
  top: 0.8rem;
  left: 0.8rem;
  z-index: 20;
  background: var(--sidebar-bg);
  border: 1px solid var(--border);
  padding: 0.3rem 0.6rem;
  border-radius: 3px;
  cursor: pointer;
  font-size: 1.2rem;
  line-height: 1;
}

@media (max-width: 800px) {
  .menu-button { display: block; }

  .sidebar {
    transform: translateX(-100%);
    transition: transform 0.25s ease;
  }

  #menu-toggle:checked ~ .sidebar {
    transform: translateX(0);
  }

  main {
    margin-left: 0;
    padding: 3.5rem 1.2rem 4rem;
  }

  .post-header h1, .index-page h1 {
    font-size: 1.6rem;
  }
}

@media (max-width: 480px) {
  html { font-size: 16px; }
  main { padding: 3rem 1rem 3rem; }
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
