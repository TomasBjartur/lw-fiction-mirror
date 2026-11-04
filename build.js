const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { createCanvas, registerFont, loadImage } = require('canvas');

// Cover typeface, bundled so the CI runner (which has no Georgia) renders the
// same cover as a local Mac build. EB Garamond, SIL OFL — see fonts/OFL.txt.
registerFont(path.join(__dirname, 'fonts', 'EBGaramond.ttf'), { family: 'EB Garamond' });
registerFont(path.join(__dirname, 'fonts', 'EBGaramond-Italic.ttf'), { family: 'EB Garamond', style: 'italic' });

const LW_GRAPHQL = 'https://www.lesswrong.com/graphql';
const USER_SLUG = 'bjartur-tomas';
const OUTPUT_DIR = path.join(__dirname, 'dist');
const FICTION_TAG_SLUG = 'fiction';

// Site config - edit these
const SITE_TITLE = 'The Origami Men and Other Stories';
const AUTHOR = 'Tomás Bjartur';
const SITE_SUBTITLE = `by ${AUTHOR}`;
const SITE_DESCRIPTION = 'Fiction by Tomás Bjartur.';
const SITE_URL = 'https://tomasbjartur.com';
const SUBSTACK_URL = 'https://tomasbjartur.substack.com/subscribe?';
// The footer email signup's form action. Placeholder: replace this with
// Tomás's own Formspree form URL (or another provider's POST endpoint)
// before the signup can work.
const NEWSLETTER_FORM_ACTION = 'https://formspree.io/f/REPLACE_WITH_YOUR_FORM_ID';
// A deploy leaves the form out until then, since every signup would fail; a
// local build keeps it, so the footer can still be reviewed.
const SHOW_SIGNUP = !NEWSLETTER_FORM_ACTION.includes('REPLACE_WITH') || !process.env.CI;
const BOOK_TITLE = 'The Origami Men and Other Stories by Tom\u00e1s Bjartur';
const EPUB_FILENAME = 'The_Origami_Men_and_Other_Stories.epub';
// Variant EPUB served to readers matched by GEO_HIDDEN: same cover and title,
// minus the hidden stories.
const EPUB_FILENAME_ALT = 'The_Origami_Men_and_Other_Stories_b.epub';

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

const EXCLUDED_SLUGS = ['beauty-and-the-beast', 'offvermilion', 'harry-potter-and-the-rules-of-quidditch-1'];
const KARMA_CUTOFF = 30;
// Stories to always include in the collection even if they're under KARMA_CUTOFF.
const FORCE_INCLUDE_SLUGS = ['san-silvestro', 'the-distaff-texts'];

// Stories hidden from readers who appear to be in a given place, checked in the
// browser against a geo-IP lookup. This is a curtain, not a block: the full HTML
// is served to everyone before the check runs, so view-source, JS off, curl, a
// VPN and the RSS feed all bypass it. Matched readers are also served
// EPUB_FILENAME_ALT, which omits the hidden stories. Each rule matches on whichever
// of city/region/country it specifies; omitted fields are ignored.
const GEO_HIDDEN = [
  { slug: 'our-beloved-monsters', region: 'BC', country: 'CA' },
];
const GEO_LOOKUP_URL = 'https://ipapi.co/json/';

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
  'san-silvestro',
  'remembering-aubrey-chang',
  'lobsang-s-children-1',
  'the-liar-and-the-scold',
  'the-elect-2',
  'goldfish',
  'customer-satisfaction-opportunities-1',
  'penny-s-hands',
  'the-distaff-texts',
  'the-origami-men',
];

// Every slug written into this file must name a story the APIs return
// (LessWrong slugs, like 'the-elect-2', are the canonical ones in its post
// URLs). A GEO_HIDDEN slug that matches nothing fails the build, since the
// story would otherwise show where it must not (the last good deploy stays
// live). Any other stale slug only costs a face, a pick mark or a book
// position, so it logs [DEGRADED] and the build goes on: new stories keep
// deploying.
function checkSlugs(posts) {
  const known = new Set(posts.map(p => p.slug));
  const stale = slugs => slugs.filter(s => !known.has(s));
  const geo = stale(GEO_HIDDEN.map(r => r.slug));
  if (geo.length) throw new Error(`GEO_HIDDEN slugs match no story (renamed on LessWrong?): ${geo.join(', ')}; known: ${[...known].join(', ')}`);
  const lists = {
    COLLECTION_ORDER, FORCE_INCLUDE_SLUGS, TITLE_FONTS: Object.keys(TITLE_FONTS), EDITOR_PICKS: [...EDITOR_PICKS],
  };
  for (const [name, slugs] of Object.entries(lists)) {
    for (const s of stale(slugs)) console.error(`[DEGRADED] ${name} names '${s}', which matches no story (renamed on LessWrong?)`);
  }
}

// Arrange posts in collection order. Stories not yet in COLLECTION_ORDER are
// inserted (sorted by karma) before the final entry, so the title story keeps
// closing the book.
function bookOrder(posts) {
  const closer = COLLECTION_ORDER[COLLECTION_ORDER.length - 1];
  const bySlug = new Map(posts.map(p => [p.slug, p]));
  const ordered = [];
  for (const slug of COLLECTION_ORDER) {
    if (slug === closer) continue;
    if (bySlug.has(slug)) ordered.push(bySlug.get(slug));
  }
  const remaining = posts
    .filter(p => !COLLECTION_ORDER.includes(p.slug))
    .sort((a, b) => b.baseScore - a.baseScore);
  ordered.push(...remaining);
  if (bySlug.has(closer)) ordered.push(bySlug.get(closer));
  return ordered;
}

function orderForCollection(posts) {
  const eligible = posts.filter(p =>
    p.baseScore >= KARMA_CUTOFF || FORCE_INCLUDE_SLUGS.includes(p.slug)
  );
  return bookOrder(eligible);
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
// "17 September 2025"
function formatDate(dateStr) {
  const d = new Date(dateStr);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// "Sep 2025"
function formatMonthYear(dateStr) {
  const d = new Date(dateStr);
  return `${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}`;
}

// Minutes to read: 260 words a minute, the mean silent reading rate for
// English fiction in Brysbaert's 2019 meta-analysis (190 studies; 238 for
// non-fiction). Rounded to the nearest minute under 10 and to the nearest
// 5 above, since a reader's own speed varies far more than one minute.
function readingMinutes(wordCount) {
  if (!wordCount) return 0;
  const m = wordCount / 260;
  return m < 9.5 ? Math.max(1, Math.round(m)) : Math.round(m / 5) * 5;
}

function estimateReadingTime(wordCount) {
  const minutes = readingMinutes(wordCount);
  return minutes ? `${minutes} min read` : '';
}

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201C', rdquo: '\u201D',
  mdash: '\u2014', ndash: '\u2013', hellip: '\u2026',
};

function decodeEntities(str) {
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? ' ');
}

// Plain-text opening of a story. Returns unescaped text: escape it for the
// context it goes into (escapeAttr / escapeHtml).
function extractExcerpt(html, maxLen = 160) {
  const text = decodeEntities((html || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[\s,;:.\u2014\u2013-]+$/, '') + '\u2026';
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

// Book typesetting for story pages (the reading lab's treatment A, picked
// by Markus 2026-11-04): typographer's quotes, dashes and ellipses in text
// nodes only (tags and attributes untouched; the source mixes straight and
// curly), acronyms of 3+ capitals wrapped for small caps, and the opening
// words of the first paragraph wrapped for a small-caps lead-in under the
// drop cap. Feed and EPUB keep the source text.
function smarten(text) {
  return text
    .replace(/&quot;/g, '"')
    .replace(/(^|[\s(\[\u2014\u2013])"/g, '$1\u201c')
    .replace(/"/g, '\u201d')
    .replace(/(^|[\s(\[\u2014\u2013\u201c])'/g, '$1\u2018')
    .replace(/'/g, '\u2019')
    .replace(/ - /g, '\u202f\u2014\u2009') // a dash never starts a line
    .replace(/\.\.\./g, '\u2026')
    .replace(/ {2,}/g, ' ');
}

function typeset(body) {
  // A quote at the start of a text node that follows an inline tag keeps
  // the previous character's context; code is left alone.
  let out = '', prev = ' ', inCode = 0;
  for (const part of body.split(/(<[^>]+>)/)) {
    if (part.startsWith('<')) {
      if (/^<(pre|code)\b/i.test(part)) inCode++;
      else if (/^<\/(pre|code)>/i.test(part)) inCode = Math.max(0, inCode - 1);
      if (/^<\/?(p|hr|div|blockquote|li|h\d)\b/i.test(part)) prev = ' ';
      out += part;
    } else if (inCode) {
      out += part;
    } else {
      const t = smarten(prev + part).slice(1);
      // Only a lone acronym (MIND, AGI): a run of capitalised words is
      // shouting, a sign or a redaction ("GIVE ME MONEY FOR FENT",
      // "[RESPONSE REDACTED]") and keeps the author's full capitals.
      out += t.replace(/(^|[^A-Z\s]\s*|[a-z][^A-Za-z]*)\b([A-Z]{3,})\b(?!\W{0,3}[A-Z]{2,}\b)/g, (m, before, word) =>
        /[A-Z]{2,}\W{0,3}$/.test(before) ? m : `${before}<span class="caps">${word}</span>`);
      if (part) prev = part.slice(-1);
    }
  }
  out = out.replace(/\s+<\/p>/g, '</p>');
  // Mark each beginning and resumption of the text (Bringhurst 4.1.4): the
  // story's first paragraph (.first) and the first after each scene break
  // (.sect) get an initial (CSS: three lines, two after a break, as in a
  // manuscript's major and minor initials) and their first words in small
  // caps, a bridge from the initial into the text.
  const inline = '((?:<(?:span|i|em|b|strong)\\b[^>]*>)*)([^<]*)';
  out = out.replace(new RegExp('^<p>' + inline), (m, open, text) => markOpening(m, '', open, text, 'first'));
  return out.replace(new RegExp('(<hr>\\s*)<p>' + inline, 'g'), (m, hr, open, text) => markOpening(m, hr, open, text, 'sect'));
}

// One opening paragraph, matched as `before`<p>`open``text`: up to five
// opening words in a small-caps lead-in, stopping at a sentence or clause
// end or a dash. Only when the paragraph opens on a word (or a quote): an
// opening like an indented "[RESPONSE REDACTED]" gets no initial.
// LessWrong's HTML often opens with inline tags (<span>, <i><span>); the
// lead-in goes inside them.
// The initial is the paragraph's ::first-letter, which takes any punctuation
// touching the letter. Text stays whole for copying, Reader view and
// screen readers, so:
// - a leading quotation mark stays in front of the letter; the initials face
//   draws it as nothing, and CSS hangs a visible one (data-q) in the margin
//   at text size (Bringhurst 4.1.5);
// - punctuation right after the letter (I'm) would be drawn at initial size;
//   a word joiner (U+2060, invisible) ends ::first-letter at the letter;
// - after a one-letter word (I, A) the space starts the line beside the
//   initial, where Chrome drops it from copies and from what screen readers
//   hear ("Iheard"). It goes in a zero-width box (.sp) that keeps it without
//   moving the line, and a word joiner keeps the letter's text node from
//   being emptied by ::first-letter, which would drop the letter from
//   Chrome's accessibility tree.
function markOpening(m, before, open, text, cls) {
  if (!/^[\u201c\u2018]?\p{L}/u.test(text)) return m;
  const q = /^[\u201c\u2018]/.test(text) ? text[0] : '';
  const rest = text.slice(q.length).replace(/^\p{L}(?=\p{P})/u, '$&\u2060');
  const head = rest.split(/[\u2009\u202f]?\u2014/)[0];
  const words = head.split(' ');
  let n = 0;
  while (n < Math.min(5, head === rest ? words.length - 1 : words.length)) { n++; if (/[.,;:!?\u201d]$/.test(words[n - 1])) break; }
  let lead = words.slice(0, n).join(' '), tail = rest.slice(lead.length);
  const sp = '\u2060<span class="sp"> </span>';
  if (/^\p{L} /u.test(lead)) lead = lead.replace(' ', sp);
  else if (/^\p{L}$/u.test(lead) && tail.startsWith(' ')) { lead += sp; tail = tail.slice(1); }
  const attrs = q ? ` class="${cls} oq" data-q="${q}"` : ` class="${cls}"`;
  const body = lead ? `<span class="lead">${q}${lead}</span>${tail}` : q + rest;
  return `${before}<p${attrs}>${open}${body}`;
}

function cleanHtml(html, { forFeed = false } = {}) {
  if (!html) return '';
  // Remove LW-specific widgets, voting buttons, etc.
  // Keep the prose clean
  return html
    // Remove empty paragraphs and headings
    .replace(/<p>\s*<\/p>/g, '')
    .replace(/<h[1-6][^>]*>(?:\s|&nbsp;|<br\s*\/?>)*<\/h[1-6]>/gi, '')
    // Remove LW internal link styling classes but keep links
    .replace(/class="[^"]*"/g, '')
    // Remove style attributes
    .replace(/style="[^"]*"/g, '')
    // Double spaces typed after full stops show up as " &nbsp;"; justified
    // text would stretch them, so set a single word space.
    .replace(/(?:[ \t]+&nbsp;|&nbsp;[ \t]+)(?=\S)/g, ' ')
    // Paragraphs holding only spaces/&nbsp; are spacer lines from the editor
    .replace(/<p>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, '')
    // Feed readers ignore our stylesheet, so scene breaks there need visible text;
    // the site keeps <hr> and draws it in CSS.
    .replace(/<hr\s*\/?>/gi, forFeed ? SCENE_BREAK_INLINE : '<hr>');
}

const SCENE_BREAK_INLINE = '<p style="text-align:center;margin:2em 0;color:#999">&#8226; &ensp; &#8226; &ensp; &#8226;</p>';
// --- Title typography -------------------------------------------------------

// Fonts the build subsets from Google Fonts with `text=`, so each file holds
// only the characters used and readers never contact Google:
// - Major Mono Display: the title hover morph (letters of the titles).
// - Send Flowers as 'Author Name': the author's name (the contents page
//   h1) and the TB home link on story pages.
// - Noto Sans JP as 'Site Marks': the nav and arrow marks, and any other
//   character in a story that the latin text faces lack. Without it they come from
//   whatever font the reader's device has. The stacks in style.css put
//   'Site Marks' right after each text face.
const SUBSET_FONTS = [
  { family: 'Major Mono Display', as: 'Major Mono Display', file: 'fonts/hover-major-mono.woff2', display: 'block',
    text: posts => posts.map(p => p.title).join('') + 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ' },
  { family: 'Send Flowers', as: 'Author Name', file: 'fonts/author-send-flowers.woff2', display: 'block',
    text: () => AUTHOR },
  { family: 'Homemade Apple', as: 'Signature', file: 'fonts/signature-homemade-apple.woff2', display: 'block',
    text: () => 'Tomás B.' },
  // Dates, reading times and counts, the book's title, EPUB and the small
  // labels. Its Light weight is the face. The whole alphabet, so a wording
  // change can't quietly drop a letter to the reader's device font.
  { family: 'Urbanist:wght@300', as: 'Urbanist Meta', file: 'fonts/urbanist-meta.woff2', display: 'swap', weight: 300,
    text: () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,:;·—–-&?!\'’()/' },
  { family: 'Noto Sans JP', as: 'Site Marks', file: 'fonts/marks-noto-sans-jp.woff2', display: 'swap',
    text: posts => '△←→↗' + outsideLatin(posts.map(p => p.title + ' ' + textOf(p.htmlBody)).join(' ')) },
];

// The unicode-range of Google Fonts' "latin" subset, which is what the
// served text faces in fonts/web/ hold.
const LATIN_RANGES = [[0x0, 0xff], [0x131, 0x131], [0x152, 0x153], [0x2bb, 0x2bc], [0x2c6, 0x2c6], [0x2da, 0x2da],
  [0x2dc, 0x2dc], [0x304, 0x304], [0x308, 0x308], [0x329, 0x329], [0x2000, 0x206f], [0x20ac, 0x20ac], [0x2122, 0x2122],
  [0x2191, 0x2191], [0x2193, 0x2193], [0x2212, 0x2212], [0x2215, 0x2215], [0xfeff, 0xfeff], [0xfffd, 0xfffd]];
function outsideLatin(text) {
  return [...new Set(text)].filter(ch => { const c = ch.codePointAt(0); return !LATIN_RANGES.some(([lo, hi]) => c >= lo && c <= hi); }).join('');
}
function textOf(html = '') {
  return html.replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d));
}

// Fetches a Google Fonts `text=` subset (spec as in css2, e.g. 'Astloch:wght@700')
// and returns the woff2 bytes. Results are kept in fonts/subsets/ by spec and
// text, and that folder is committed: CI builds use the committed files and
// only ask Google when a title or story adds characters. A fetch that fails
// stops the build, so a deploy never ships a title in the wrong face (the
// last good deploy stays live). Commit fonts/subsets/ after a local build.
const SUBSET_DIR = path.join(__dirname, 'fonts', 'subsets');
const usedSubsets = new Set();

// Deletes subset files this build did not use, so the committed set holds
// only the current titles' and stories' characters.
function pruneSubsets() {
  for (const f of fs.readdirSync(SUBSET_DIR)) {
    if (f.endsWith('.woff2') && !usedSubsets.has(f)) fs.unlinkSync(path.join(SUBSET_DIR, f));
  }
}

function subsetKey(spec, text) {
  const chars = [...new Set(text)].sort().join('');
  return require('crypto').createHash('sha1').update(spec + '\n' + chars).digest('hex').slice(0, 16);
}

async function fetchGoogleSubset(spec, text) {
  const chars = [...new Set(text)].sort().join('');
  const key = subsetKey(spec, text);
  const cached = path.join(SUBSET_DIR, `${key}.woff2`);
  usedSubsets.add(`${key}.woff2`);
  if (fs.existsSync(cached)) return fs.readFileSync(cached);
  const url = `https://fonts.googleapis.com/css2?family=${spec.replace(/ /g, '+')}&text=${encodeURIComponent(chars)}`;
  for (let attempt = 1; ; attempt++) {
    try { return await downloadSubset(url, cached); } catch (err) {
      if (attempt === 3) throw err;
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
}

async function downloadSubset(url, cached) {
  const css = await (await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' } })).text();
  const m = css.match(/src:\s*url\(([^)]+)\)\s*format\('woff2'\)/);
  if (!m) throw new Error(`no woff2 in CSS response: ${css.slice(0, 120)}`);
  const res = await fetch(m[1]);
  if (!res.ok) throw new Error(`font HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(cached), { recursive: true });
  fs.writeFileSync(cached, buf);
  return buf;
}

// True if a woff2 file has a COLR table. WOFF2's table directory numbers the
// known tags; COLR is 34, and 63 means a four-byte tag follows.
function woff2HasColr(buf) {
  let o = 48;
  const skipVarint = () => { while (buf[o++] & 0x80); };
  for (let i = 0, n = buf.readUInt16BE(12); i < n; i++) {
    const flags = buf[o++], tag = flags & 63, transform = flags >> 6;
    if (tag === 34) return true;
    if (tag === 63) o += 4;
    skipVarint();
    if (tag === 10 || tag === 11 ? transform === 0 : transform !== 0) skipVarint();
  }
  return false;
}

// Safari's engine, so every iPhone browser, has no COLRv1 and draws those
// faces as nothing. scripts/colr-twin.py makes the copy it can draw, kept in
// fonts/subsets/ beside the subset and committed, so CI (which has no uv) only
// needs it for a new colour title. Without a twin the @font-face offers just
// the COLR file: Safari then sets that title in the list's sans, never blank.
function colrTwin(spec, text) {
  const key = subsetKey(spec, text), name = `${key}.safari.woff2`, twin = path.join(SUBSET_DIR, name);
  usedSubsets.add(name);
  if (fs.existsSync(twin)) return fs.readFileSync(twin);
  const made = require('child_process').spawnSync('uv', ['run', '--quiet', '--python', '3.12', '--with', 'nanoemoji', '--with', 'brotli',
    'python3', path.join(__dirname, 'scripts', 'colr-twin.py'), path.join(SUBSET_DIR, `${key}.woff2`), twin], { stdio: 'inherit' });
  if (made.status === 0) return fs.readFileSync(twin);
  console.warn(`[DEGRADED] no Safari copy of ${spec} ("${text.slice(0, 40)}"): Safari sets it in the fallback sans. Run node build.js where uv is installed and commit fonts/subsets/.`);
  return null;
}

// Writes a title or specimen face to dist/ and returns what its @font-face
// needs: the file, and for a colour face the twin (null if it could not be made).
async function writeTitleFace(spec, text, file) {
  const buf = await fetchGoogleSubset(spec, text);
  fs.writeFileSync(path.join(OUTPUT_DIR, file), buf);
  if (!woff2HasColr(buf)) return { file };
  const twin = colrTwin(spec, text), twinFile = file.replace(/\.woff2$/, '.safari.woff2');
  if (twin) fs.writeFileSync(path.join(OUTPUT_DIR, twinFile), twin);
  return { file, twin: twin ? twinFile : null, colour: true };
}

// The src of a title face. tech() keeps Chrome and Firefox on the COLR file
// and sends everything else to the twin.
function titleFaceSrc(face) {
  if (!face.colour) return `url('${assetUrl(face.file)}') format('woff2')`;
  const colr = `url('${assetUrl(face.file)}') format('woff2') tech(color-COLRv1)`;
  return face.twin ? `${colr},url('${assetUrl(face.twin)}') format('woff2')` : colr;
}

// Writes every subset font; any failure throws (see fetchGoogleSubset).
async function fetchSubsetFonts(posts) {
  fs.mkdirSync(path.join(OUTPUT_DIR, 'fonts'), { recursive: true });
  return Promise.all(SUBSET_FONTS.map(async f => {
    try {
      fs.writeFileSync(path.join(OUTPUT_DIR, f.file), await fetchGoogleSubset(f.family, f.text(posts)));
    } catch (err) {
      throw new Error(`subset font ${f.family}: ${err.message}`);
    }
    console.log(`Wrote ${f.file}`);
    return f;
  }));
}

// Each story's title has its own display face, picked by Markus from his
// "reviewed and cool experimental fonts" (2026-11-03). [Google css2 spec,
// size factor against the list's base size, weight, and optionally a stroke
// in em that thickens a face whose outlines are hairlines]. The build fetches a
// subset of just that title's letters per story; a story missing here falls
// back to the list's sans, and a failed fetch stops the build.
const TITLE_FONTS = {
  'duane-arnold-1': ['Monoton', 0.95, 400],
  'san-silvestro': ['Ballet', 1.7, 400],
  'the-distaff-texts': ['Astloch:wght@700', 1.35, 700],
  'customer-satisfaction-opportunities-1': ['Bitcount Prop Double Ink', 1.0, 400],
  'the-elect-2': ['Jacques Francois Shadow', 1.1, 400],
  'goldfish': ['Kalnia Glaze:wght@500', 1.1, 500],
  'lobsang-s-children-1': ['Tilt Prism', 1.0, 400],
  'remembering-aubrey-chang': ['Moirai One', 1.1, 400, 0.01],
  'penny-s-hands': ['League Script', 1.4, 400],
  'that-mad-olympiad-1': ['Faster One', 1.0, 400],
  'the-origami-men': ['Tourney', 1.0, 400],
  'our-beloved-monsters': ['Bungee Spice', 1.0, 400],
  'the-company-man': ['Tilt Warp', 1.0, 400],
  'the-liar-and-the-scold': ['Workbench', 1.05, 400],
  'the-maker-of-mind': ['Turret Road:wght@500', 1.1, 500],
};

// Editor's picks (Markus, 2026-11-03): marked in the contents list by a
// faint purple rule in the margin.
const EDITOR_PICKS = new Set(['that-mad-olympiad-1', 'the-origami-men', 'the-distaff-texts', 'the-company-man']);

// Faces for stories that arrive without a TITLE_FONTS entry: Markus's
// reviewed picks not currently on a title, ordered so neighbours differ. A new
// story takes the next one, oldest new story first, so each story keeps
// its face as more arrive; when the backlog runs out the faces are reused
// from the top. To pin a face (or change one), add the story to
// TITLE_FONTS. Left out: Coral Pixels, Wallpoet and Delius Swash Caps
// (tried on titles, didn't land), Shizuru and Neonderthaw ("too
// familiar" on titles), Send Flowers (the author's name) and Zen Tokyo
// Zoo (the book title).
const TITLE_FONT_BACKLOG = [
  ['Jersey 10', 1.15, 400],
  ['Climate Crisis', 0.85, 400],
  ['Josefin Sans:wght@300', 1.05, 300],
  ['Bungee Shade', 0.9, 400],
  ['Twinkle Star', 1.2, 400],
  ['Urbanist:wght@300', 1.05, 300],
  ['Foldit:wght@500', 1.15, 500],
];

// Slug -> [spec, size, weight, stroke?] for every story: its pick, or a backlog face.
function titleFontFor(posts) {
  const map = new Map();
  let next = 0;
  for (const p of [...posts].sort((a, b) => new Date(a.postedAt) - new Date(b.postedAt))) {
    if (TITLE_FONTS[p.slug]) { map.set(p.slug, TITLE_FONTS[p.slug]); continue; }
    const f = TITLE_FONT_BACKLOG[next++ % TITLE_FONT_BACKLOG.length];
    console.log(`Title font for ${p.slug}: ${f[0]} (from the backlog; pin it in TITLE_FONTS to keep it)`);
    map.set(p.slug, f);
  }
  return map;
}

// One entry per distinct face in TITLE_FONTS and TITLE_FONT_BACKLOG, with
// the stories that actually wear it. A pick whose story has gone still
// appears (under "Waiting"), so the page never loses a reviewed face.
function titleFaceCatalog(posts, assigned = titleFontFor(posts)) {
  const faces = new Map();
  const add = (f, backlogIndex = null) => {
    const spec = f[0];
    if (!faces.has(spec)) {
      faces.set(spec, {
        spec,
        name: spec.split(':')[0],
        size: f[1],
        weight: f[2],
        stroke: f[3] || 0,
        backlogIndex,
        posts: [],
      });
    }
    return faces.get(spec);
  };
  for (const slug of Object.keys(TITLE_FONTS)) add(TITLE_FONTS[slug]);
  TITLE_FONT_BACKLOG.forEach((f, i) => add(f, i));
  for (const p of posts) {
    const f = assigned.get(p.slug);
    if (f && faces.has(f[0]) && !faces.get(f[0]).posts.some(q => q.slug === p.slug)) {
      faces.get(f[0]).posts.push(p);
    }
  }
  return [...faces.values()];
}

// The /title-fonts/ page gets one `text=` subset per face: its name, its
// stories' titles and the alphabet, written to dist/fonts/.
const SPECIMEN_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789&?!.,:;\'’—';

async function fetchTitleFontSpecimens(faces) {
  const files = new Array(faces.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(6, faces.length) }, async () => {
    while (next < faces.length) {
      const i = next++;
      const f = faces[i];
      const text = SPECIMEN_CHARS + f.name + f.posts.map(p => p.title).join('');
      try {
        files[i] = await writeTitleFace(f.spec, text, `fonts/title-specimen-${i}.woff2`);
      } catch (err) {
        throw new Error(`title specimen for ${f.name} (${f.spec}): ${err.message}`);
      }
    }
  }));
  console.log(`Title specimens: ${faces.length} faces`);
  return files;
}

// Returns Map slug -> { face, size, weight, stroke } for the faces that were written.
async function fetchTitleFonts(posts, faces = titleFontFor(posts)) {
  const out = new Map();
  await Promise.all(posts.map(async p => {
    const [spec, size, weight, stroke = 0] = faces.get(p.slug);
    try {
      out.set(p.slug, { face: await writeTitleFace(spec, p.title, `fonts/title-${p.slug}.woff2`), size, weight, stroke });
    } catch (err) {
      throw new Error(`title font for ${p.slug} (${spec}): ${err.message}`);
    }
  }));
  console.log(`Title fonts: ${out.size}/${posts.length} stories`);
  return out;
}

function titleColor(rank, n) {
  const t = n > 1 ? rank / (n - 1) : 0;
  const mix = (a, b) => (a + (b - a) * t).toFixed(3);
  // Newest is the highest-contrast in both themes: dark mirrors the ramp.
  return `light-dark(oklch(${mix(0.2, 0.36)} ${mix(0.005, 0.15)} 305), oklch(${mix(0.9, 0.76)} ${mix(0.005, 0.12)} 305))`;
}

// Per-story recency colour and the hover face, written to dist/titles.css.
function buildTitlesCss(posts, subsetFonts, titleFonts) {
  const byDate = sortByDate(posts);
  const face = subsetFonts
    .map(f => `@font-face{font-family:'${f.as}';src:url('${assetUrl(f.file)}') format('woff2')${f.weight ? `;font-weight:${f.weight}` : ''};font-display:${f.display}}\n`)
    .join('');
  const titleFaces = [...titleFonts].map(([slug, f]) =>
    `@font-face{font-family:'tf-${slug}';src:${titleFaceSrc(f.face)};font-weight:${f.weight};font-display:block}\n`).join('');
  return face + titleFaces + byDate.map((p, rank) => {
    const f = titleFonts.get(p.slug);
    const font = f ? `;--tf:'tf-${p.slug}';--tw:${f.weight};--ts:${f.size}${f.stroke ? `;--tk:${f.stroke}em` : ''}` : '';
    return `.t-${p.slug}{--tc:${titleColor(rank, byDate.length)}${font}}`;
  }).join('\n') + '\n';
}

// The /title-fonts/ page's faces and layout. One @font-face per catalog
// face, with its own family name, then the page styles from title-fonts.css.
function buildTitleFontsCss(faces, files) {
  const generated = faces.map((f, i) =>
    `@font-face{font-family:'TF${i}';src:${titleFaceSrc(files[i])};font-weight:${f.weight};font-display:block}\n`
    + `.tf-face-${i}{--f:'TF${i}';--w:${f.weight};--sz:${f.size};--stroke:${f.stroke}em}`).join('\n');
  return `/* Title fonts specimen; faces generated by build.js. */\n${generated}\n\n`
    + fs.readFileSync(path.join(__dirname, 'title-fonts.css'), 'utf8');
}

// /title-fonts/ (dist/title-fonts/index.html): every face on a story in
// contents order, then the backlog. The big line is the family name set in
// the face; under it the story title (or the book's) and the alphabet.
function buildTitleFontsPage(posts, faces, files) {
  const newest = f => Math.max(...f.posts.map(p => new Date(p.postedAt).getTime()));
  const inUse = faces.filter(f => f.posts.length).sort((a, b) => newest(b) - newest(a));
  const waiting = faces.filter(f => !f.posts.length);
  const faceIndex = new Map(faces.map((f, i) => [f, i]));

  const card = (f, n) => {
    const i = faceIndex.get(f);
    const assigned = f.posts.length > 0;
    const uses = assigned
      ? `Sets ${f.posts.map(p => `<a href="../${p.slug}/">${escapeHtml(p.title)}</a>`).join('<span class="tf-sep" aria-hidden="true"> · </span>')}`
      : (f.backlogIndex == null ? 'No story in the collection' : 'Waiting in the backlog');
    const sample = escapeHtml(assigned ? f.posts.map(p => p.title).join(' · ') : SITE_TITLE);
    const detail = [f.weight, `${f.size}×`, f.stroke ? `${f.stroke}em stroke` : ''].filter(Boolean).join(' · ');
    return `<section class="tf-face tf-face-${i}${assigned ? ` t-${f.posts[0].slug}` : ''}">
      <div class="tf-aside">
        <span class="tf-no" aria-hidden="true">${String(n).padStart(2, '0')}</span>
        <h3 class="tf-use">${uses}</h3>
        <p class="tf-specs">${escapeHtml(f.name)}<br>${detail}</p>
      </div>
      <div class="tf-body">
        <p class="tf-specimen">${escapeHtml(f.name)}</p>
        <p class="tf-sample">${sample}</p>
        <p class="tf-alpha" aria-hidden="true"><span>ABCDEFGHIJKLMNOPQRSTUVWXYZ</span><span>abcdefghijklmnopqrstuvwxyz 0123456789 &amp;?!.,:;’—</span></p>
      </div>
    </section>`;
  };

  const content = `
    <a class="tf-back" href="../">← Contents</a>
    <header class="tf-head">
      <p class="tf-eyebrow">Type specimens</p>
      <h1 class="tf-h1">Title <em>fonts</em></h1>
      <p class="tf-intro">One display face for every story title in <a href="../">the collection</a>, and the ones waiting their turn. All are open fonts served by this site, so a title looks the same on every reader's device.</p>
      <p class="tf-counts"><b>${inUse.length}</b> in use · <b>${waiting.length}</b> waiting · <b>${faces.length}</b> faces</p>
    </header>
    <section class="tf-section" aria-labelledby="tf-in-use">
      <h2 class="tf-section-h" id="tf-in-use">In use <b>${inUse.length}</b></h2>
      ${inUse.map((f, i) => card(f, i + 1)).join('\n')}
    </section>${waiting.length ? `
    <section class="tf-section" aria-labelledby="tf-waiting">
      <h2 class="tf-section-h" id="tf-waiting">Waiting <b>${waiting.length}</b></h2>
      <p class="tf-note">A new story without a face of its own takes the next of these. Their specimen line is the book's title.</p>
      ${waiting.map((f, i) => card(f, i + 1)).join('\n')}
    </section>` : ''}`;

  return pageShell(content, 'Title fonts', posts, null, {
    description: 'The display faces behind the story titles.',
    canonicalUrl: `${SITE_URL}/title-fonts/`,
    bodyClass: 'is-fonts',
    base: '../',
    skipLabel: 'title fonts',
    robots: 'noindex',
    styles: ['title-fonts.css'],
    preload: ['fonts/eb-garamond-latin-normal-400-v1.woff2'],
  });
}

// Where the email form lands after a successful signup.
function buildSuccessPage(posts) {
  const content = `
    <section class="success-page">
      <h1>Thank you.<br>The next story will come by email.</h1>
      <p class="success-back"><a href="../">Back to the stories</a></p>
    </section>`;

  return pageShell(content, 'Subscribed', posts, null, {
    description: 'Thank you for subscribing.',
    canonicalUrl: `${SITE_URL}/subscribed/`,
    bodyClass: 'is-success',
    base: '../',
    nav: true,
    skipLabel: 'confirmation',
    robots: 'noindex',
    // The name's face first: while it loads, Chrome reaches for the next face in
    // its stack, which would fetch EB Garamond for a page that sets no story.
    preload: ['fonts/author-send-flowers.woff2', 'fonts/urbanist-meta.woff2'],
  });
}


// GitHub Pages serves this for any missing path at any depth, so its links are
// root-absolute.
function buildNotFoundPage(posts) {
  const content = `
    <section class="success-page">
      <h1>This page isn’t here</h1>
      <p class="success-back"><a href="/">Back to the stories</a></p>
    </section>`;

  return pageShell(content, 'Not found', posts, null, {
    description: 'This page isn’t here.',
    canonicalUrl: `${SITE_URL}/`,
    bodyClass: 'is-success',
    base: '/',
    nav: true,
    skipLabel: 'message',
    robots: 'noindex',
    preload: ['fonts/author-send-flowers.woff2', 'fonts/urbanist-meta.woff2'],
  });
}

function buildSitemap(posts) {
  const urls = [`  <url><loc>${SITE_URL}/</loc></url>`].concat(sortByDate(posts).map(p =>
    `  <url><loc>${SITE_URL}/${p.slug}/</loc><lastmod>${new Date(p.postedAt).toISOString().slice(0, 10)}</lastmod></url>`));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

function sortByDate(posts) {
  return [...posts].sort((a, b) => new Date(b.postedAt) - new Date(a.postedAt));
}

// --- Reader metrics ----------------------------------------------------------

const SUBSTACK_BASE = SUBSTACK_URL.replace(/\/subscribe.*$/, '');
const normTitle = t => String(t).toLowerCase().replace(/[‘’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Likes, restacks and comments for each Substack post, keyed by normalised
// title. Fails loud and returns an empty map, so the site still builds.
async function fetchSubstackMetrics() {
  const out = new Map();
  try {
    for (let offset = 0; ; offset += 50) {
      const res = await fetch(`${SUBSTACK_BASE}/api/v1/archive?sort=new&offset=${offset}&limit=50`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const page = await res.json();
      for (const p of page) {
        out.set(normTitle(p.title), {
          url: p.canonical_url,
          likes: p.reaction_count ?? 0,
          restacks: p.restacks ?? 0,
          comments: p.comment_count ?? 0,
        });
      }
      if (page.length < 50) break;
    }
    console.log(`Fetched Substack metrics for ${out.size} posts`);
  } catch (err) {
    console.error(`[DEGRADED] Substack metrics unavailable: ${err.message}`);
  }
  return out;
}

function attachMetrics(posts, substack) {
  for (const p of posts) {
    p.lw = p.external ? null : {
      url: `https://www.lesswrong.com/posts/${p._id}/${p.slug}`,
      karma: p.baseScore,
      comments: p.commentCount,
    };
    p.ss = substack.get(normTitle(p.title)) || null;
  }
}

const ICON_LW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6l-4.6 6L18 18l-6-4.6L6 18l4.6-6L6 6l6 4.6z" opacity=".55"/><path d="M12 0l2.2 9.8L24 12l-9.8 2.2L12 24l-2.2-9.8L0 12l9.8-2.2z"/></svg>';
const ICON_SS = '<svg viewBox="0 0 11 12" aria-hidden="true"><path d="M0 0h11v1.4H0zM0 2.7h11v1.4H0zM0 5.4h11V12L5.5 9 0 12z"/></svg>';
// Substack's mark, struck through: the form's "email, not Substack" field.
const ICON_SS_OFF = `<svg viewBox="0 0 11 12" aria-hidden="true"><path d="M0 0h11v1.4H0zM0 2.7h11v1.4H0zM0 5.4h11V12L5.5 9 0 12z"/><path class="slash-bg" d="M1.2 11.1L9.8 0.9" fill="none" stroke-width="2.4" stroke-linecap="round"/><path class="slash" d="M1.2 11.1L9.8 0.9" fill="none" stroke-width="1.2" stroke-linecap="round"/></svg>`;

// Month and reading time, set inline after a title in the contents list.
function whenText(p) {
  const mins = readingMinutes(p.wordCount);
  const read = mins ? ` · <span title="${mins} min read">${mins}m</span>` : '';
  return `<span class="when"><span title="${formatDate(p.postedAt)}">${formatMonthYear(p.postedAt)}</span>${read}</span>`;
}

// Reader counts from LessWrong and Substack, each group led by its source
// icon (a link to the story there); a number's kind is the small icon after it.
function stats(p) {
  const n = (v, k, label) => `<span class="n k-${k}" title="${v} ${label}">${v}<span class="sr-only"> ${label}</span></span>`;
  const lw = p.lw
    ? `<span class="m"><a class="src src-lw" href="${p.lw.url}" title="On LessWrong" aria-label="On LessWrong">${ICON_LW}</a>${n(p.lw.karma, 'karma', 'karma')}${n(p.lw.comments, 'cmts', 'comments')}</span>`
    : '';
  const ss = p.ss
    ? `<span class="m"><a class="src src-ss" href="${p.ss.url}" title="On Substack" aria-label="On Substack">${ICON_SS}</a>${n(p.ss.likes, 'likes', 'likes')}${n(p.ss.restacks, 'restacks', 'restacks')}${n(p.ss.comments, 'cmts', 'comments')}</span>`
    : '';
  return lw + ss;
}

// --- Pages -------------------------------------------------------------------

// style.css's --paper as hex, for the browser's own chrome before CSS loads
// and for the phone toolbar tint.
const PAPER = { light: '#fefcf7', dark: '#13110f' };

// Set in main() once they exist: the cover's size for share cards, and whether
// the touch icon could be drawn.
let coverSize = null;
let hasTouchIcon = false;

// The home-screen icon: "TB" from favicon.svg (scripts/favicon.py writes it),
// 180px. iOS ignores SVG icons and rounds the corners itself, so it fills the
// square, in the light colours only.
async function buildTouchIcon() {
  const svg = fs.readFileSync(path.join(__dirname, 'favicon.svg'), 'utf8');
  const [, accent] = svg.match(/path\{fill:(#[0-9a-f]+)/);
  const [, transform, d] = svg.match(/<path transform='([^']+)' d='([^']+)'/);
  const flat = `<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180' viewBox='0 0 100 100'><rect width='100' height='100' fill='${PAPER.light}'/><path transform='${transform}' d='${d}' fill='${accent}' stroke='${accent}' stroke-width='45' stroke-linejoin='round'/></svg>`;
  const canvas = createCanvas(180, 180);
  canvas.getContext('2d').drawImage(await loadImage(Buffer.from(flat)), 0, 0, 180, 180);
  return canvas.toBuffer('image/png');
}

// The bird from markusstrasser.org's Icon.svelte.
const ICON_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z"/></svg>';
// Theme toggle marks, one per mode; CSS shows the current one. Light: a
// sun with long and short rays; dark: a crescent with two sparks.
const ICON_THEME = '<svg class="ti ti-light" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M19 12L22 12M16.95 16.95L18.08 18.08M12 19L12 22M7.05 16.95L5.92 18.08M5 12L2 12M7.05 7.05L5.92 5.92M12 5L12 2M16.95 7.05L18.08 5.92" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'
  + '<svg class="ti ti-dark" viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 15.2A8 8 0 1 1 9.8 3.6a6.6 6.6 0 0 0 9.7 11.6z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M17 3.2l.55 1.45 1.45.55-1.45.55L17 7.2l-.55-1.45L15 5.2l1.45-.55zM20.6 8.6l.35.9.9.35-.9.35-.35.9-.35-.9-.9-.35.9-.35z"/></svg>';
// Download mark: an arrow into a tray, so an EPUB link reads as a file.
const ICON_DL = '<svg class="dl-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11.5M7 10l5 5 5-5M4.5 16.5V20h15v-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
// The author's signature, from the supplied SVG; set in Homemade Apple and
// inlined so it can use the site's self-hosted subset and follow the theme.
const SIGNATURE_SVG = `<svg class="signature-mark" viewBox="0 0 420 170" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <g transform="rotate(0.11 210.0 85.0)">
    <text x="34.9" y="95.8" font-family="Signature, serif" font-size="67.2" fill="currentColor" stroke="currentColor" stroke-width="0.78" transform="skewX(-12.1) translate(20.5 0)">Tomás B.</text>
    <path d="M 44.9 117.8 c 10.3 -20.1, 20.7 -20.1, 10.3 0 c -10.3 14.1, 103.5 4.3, 194.1 2.6 c 38.8 -1.3, 51.8 -4.3, 64.7 -9.5" fill="none" stroke="currentColor" stroke-width="2.18" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>
  </g>
</svg>`;
// The book as a download: its title (plain text) and, as the one link,
// the underlined EPUB mark. `base` lets a page in a subdirectory link back
// up to the root (the title-fonts specimen).
const bookLink = (cls, base = '') => `<span class="book ${cls}"><span class="bk-title">${SITE_TITLE}</span> <a href="${base}${EPUB_FILENAME}" class="bk-dl epub-link" title="The whole collection as a free EPUB" download>EPUB${ICON_DL}</a></span>`;
const X_HANDLE = 'BjarturTomas';
const X_URL = `https://x.com/${X_HANDLE}`;

// One line at the foot of every page, with the email signup above it.
function siteFoot(base = '') {
  // The book with its separator, so a phone's contents page (where the
  // book sits under the name) can drop it and keep the footer to a line.
  const sep = '<span class="sep" aria-hidden="true">·</span>';
  return `<div class="site-foot-wrap">
    <div class="site-foot-main">
      ${SHOW_SIGNUP ? `<div class="site-signup" id="subscribe">
        <form class="subscribe" action="${NEWSLETTER_FORM_ACTION}" method="POST" data-success="${base}subscribed/">
          <input type="hidden" name="_source" value="footer">
          <input type="hidden" name="_page" value="">
          <input type="hidden" name="_next" value="${SITE_URL}/subscribed/">
          <div class="subscribe-field">
            <span class="subscribe-mark" aria-hidden="true">${ICON_SS_OFF}</span>
            <input type="email" name="email" aria-label="Email address" placeholder="Direct Email" required autocomplete="email" autocapitalize="off" spellcheck="false">
          </div>
          <button type="submit">Subscribe</button>
        </form>
        <p class="subscribe-message" role="status" aria-live="polite"></p>
      </div>` : ''}
      <p class="site-foot"><span class="foot-copy">© ${new Date().getFullYear()} ${AUTHOR}</span>${sep}<a href="${X_URL}" class="x-link" rel="me noopener">${ICON_X}@${X_HANDLE}</a><span class="foot-book-item">${sep}${bookLink('foot-book', base)}</span></p>
    </div>${SIGNATURE_SVG}
  </div>`;
}

// Site links: in the fixed bar on story pages, beside the title on the
// contents page. Subscribe looks like Substack's own button, so readers
// know where it goes. `base` is '../' on story pages, whose clean URLs are
// one directory down; the contents page is at the site root.
function navItems(currentSlug, base = '') {
  return `<a href="${base || 'index.html'}" class="nav-item nav-home" title="Contents"${currentSlug ? '' : ' aria-current="page"'}>TB</a><a href="${base}${EPUB_FILENAME}" class="nav-item nav-epub epub-link" title="The whole collection as a free EPUB" download>EPUB${ICON_DL}</a><a href="${base}feed.xml" class="nav-item nav-rss" title="RSS feed">RSS</a><a href="${X_URL}" class="nav-item nav-x" title="@${X_HANDLE} on X" aria-label="@${X_HANDLE} on X" rel="me noopener">${ICON_X}</a><button type="button" class="nav-item theme-toggle" id="theme-btn">${ICON_THEME}</button><a href="${SUBSTACK_URL}" class="nav-sub" title="New stories by email, on Substack">${ICON_SS}<span>Subscribe</span></a>`;
}

function pageShell(content, title, posts, currentSlug, opts = {}) {
  const pageTitle = escapeHtml(title ? `${title} — ${SITE_TITLE}` : `${SITE_TITLE} · ${SITE_SUBTITLE}`);
  const description = opts.description || SITE_DESCRIPTION;
  const canonicalUrl = opts.canonicalUrl || (currentSlug ? `${SITE_URL}/${currentSlug}/` : `${SITE_URL}/`);
  const ogType = currentSlug ? 'article' : 'website';
  const ogTitle = title || `${SITE_TITLE} · ${SITE_SUBTITLE}`;
  // Pages in a subdirectory (the title-fonts specimen) pass '../' so every
  // root-relative asset and link resolves from the site root.
  const base = opts.base || '';
  const styles = opts.styles || [];
  const preloads = opts.preload || [
    currentSlug ? 'fonts/eb-garamond-latin-normal-400-v1.woff2' : 'fonts/author-send-flowers.woff2',
    'fonts/urbanist-meta.woff2',
  ];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${pageTitle}</title>
  <meta name="description" content="${escapeAttr(description)}">
  ${opts.robots ? `<meta name="robots" content="${opts.robots}">` : ''}
  <link rel="canonical" href="${canonicalUrl}">
  <link rel="icon" href="${base}${assetUrl('favicon.svg')}" type="image/svg+xml">
  ${hasTouchIcon ? `<link rel="apple-touch-icon" href="${base}apple-touch-icon.png">` : ''}
  <meta property="og:type" content="${ogType}">
  <meta property="og:site_name" content="${escapeAttr(SITE_TITLE)}">
  <meta property="og:title" content="${escapeAttr(ogTitle)}">
  <meta property="og:description" content="${escapeAttr(description)}">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:image" content="${SITE_URL}/cover.png">
  ${coverSize ? `<meta property="og:image:width" content="${coverSize.width}">
  <meta property="og:image:height" content="${coverSize.height}">` : ''}
  <meta property="og:image:alt" content="${escapeAttr(`Cover of ${SITE_TITLE}`)}">
  ${opts.published ? `<meta property="article:published_time" content="${new Date(opts.published).toISOString()}">` : ''}
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${escapeAttr(ogTitle)}">
  <meta name="twitter:description" content="${escapeAttr(description)}">
  <meta name="twitter:image" content="${SITE_URL}/cover.png">
  <meta name="twitter:image:alt" content="${escapeAttr(`Cover of ${SITE_TITLE}`)}">
  <meta name="color-scheme" content="light">
  <meta name="theme-color" content="${PAPER.light}">
  <script>try{if(localStorage.getItem('theme')==='dark'){document.documentElement.setAttribute('data-theme','dark');document.querySelector('meta[name=color-scheme]').content='dark';document.querySelector('meta[name=theme-color]').content='${PAPER.dark}'}}catch(e){}</script>
  <script src="${base}${assetUrl('site.js')}" defer></script>
  <link rel="stylesheet" href="${base}${assetUrl('style.css')}">
  <link rel="stylesheet" href="${base}${assetUrl('titles.css')}">
  ${styles.map(s => `<link rel="stylesheet" href="${base}${assetUrl(s)}">`).join('\n  ')}
  <link rel="preload" href="${base}${assetUrl('fonts/inter-latin-normal-300-700-v1.woff2')}" as="font" type="font/woff2" crossorigin fetchpriority="high">
  ${preloads.map(f => `<link rel="preload" href="${base}${assetUrl(f)}" as="font" type="font/woff2" crossorigin>`).join('\n  ')}
  <script type="speculationrules">{"prerender":[{"where":{"href_matches":"/*/"},"eagerness":"moderate"}]}</script>
  <link rel="alternate" type="application/rss+xml" title="${SITE_TITLE} — ${SITE_SUBTITLE}" href="${base}feed.xml">
</head>
<body class="${opts.bodyClass || (currentSlug ? 'is-post' : 'is-index')}">
  <a class="skip-link" href="#content">Skip to ${opts.skipLabel || (currentSlug ? 'story' : 'contents')}</a>

${(currentSlug || opts.nav) ? `  <header class="nav">
    <nav class="navbar" aria-label="Site">${navItems(currentSlug || (opts.nav ? 'page' : null), base)}</nav>
  </header>
` : ''}${currentSlug ? `  <div class="reading-progress" aria-hidden="true"><div class="progress-bar"></div></div>
` : ''}
  <main id="content" tabindex="-1">
    ${content}
  </main>

  ${siteFoot(base)}

  <script>
  (function(){
    // Geo curtain for GEO_HIDDEN. The page HTML is already delivered by the time
    // this runs, so it is a curtain, not a block: view-source, JS off, curl, a
    // VPN and the RSS feed all bypass it. Fails open by design — if the
    // lookup errors, times out or is blocked, nothing is hidden.
    var RULES=${JSON.stringify(GEO_HIDDEN)},CUR=${JSON.stringify(currentSlug)};
    var ALT_EPUB=${JSON.stringify(base + EPUB_FILENAME_ALT)};
    if(!RULES.length)return;
    var KEY='geo',TTL=864e5;
    function eq(a,b){return !b||String(a||'').toLowerCase()===String(b).toLowerCase()}
    function apply(loc){
      RULES.forEach(function(r){
        if(!(eq(loc.city,r.city)&&eq(loc.region,r.region)&&eq(loc.country,r.country)))return;
        var els=document.querySelectorAll('[data-slug="'+r.slug+'"]');
        for(var i=0;i<els.length;i++)els[i].remove();
        var ol=document.querySelector('.stories');if(ol)ol.style.setProperty('--n',ol.querySelectorAll('.story').length);
        var navs=document.querySelectorAll('[data-geo-slug="'+r.slug+'"]');
        for(var k=0;k<navs.length;k++){var a=navs[k],h=a.getAttribute('data-alt-href');
          if(h){a.href=h;a.textContent=a.getAttribute('data-alt-label');a.className=a.className.replace(/\\bt-\\S+/,'t-'+a.getAttribute('data-alt-slug'))}
          else{a.removeAttribute('href');a.textContent=''}}
        var eps=document.querySelectorAll('.epub-link');
        for(var j=0;j<eps.length;j++)eps[j].href=ALT_EPUB;
        if(CUR===r.slug)location.replace(${JSON.stringify(base || 'index.html')});
      });
    }
    var cached=null;
    try{var raw=localStorage.getItem(KEY),o=raw&&JSON.parse(raw);
      if(o&&Date.now()-o.t<TTL)cached=o.loc}catch(e){}
    if(cached){apply(cached);return}
    var ctl=typeof AbortController!=='undefined'?new AbortController():null;
    var timer=setTimeout(function(){ctl&&ctl.abort()},2500);
    fetch(${JSON.stringify(GEO_LOOKUP_URL)},ctl?{signal:ctl.signal}:{})
      .then(function(r){return r.ok?r.json():Promise.reject()})
      .then(function(d){
        clearTimeout(timer);
        var loc={city:d.city,region:d.region_code,country:d.country_code};
        try{localStorage.setItem(KEY,JSON.stringify({t:Date.now(),loc:loc}))}catch(e){}
        apply(loc);
      })
      .catch(function(){clearTimeout(timer)});
  })();
  </script>

</body>
</html>`;
}

// Newer/older link from list[idx] one step in direction `step` (-1 newer,
// 1 older). When the target is a GEO_HIDDEN story, the link also carries the
// next story past it (skipping every GEO_HIDDEN slug), which the geo curtain
// swaps in.
// The list wraps: the newest story's "newer" link is the oldest story and
// the oldest's "older" link is the newest, so both links always lead on.
function postNavLink(list, idx, step, base = '') {
  const cls = step < 0 ? 'post-nav-prev' : 'post-nav-next';
  const at = i => list[((i % list.length) + list.length) % list.length];
  const target = list.length > 1 ? at(idx + step) : null;
  if (!target) return `<span class="${cls}"></span>`;
  let geo = '';
  if (GEO_HIDDEN.some(r => r.slug === target.slug)) {
    let i = idx + step, guard = list.length;
    while (guard-- > 0 && GEO_HIDDEN.some(r => r.slug === at(i).slug)) i += step;
    const alt = guard >= 0 && at(i).slug !== list[idx].slug ? at(i) : null;
    geo = ` data-geo-slug="${target.slug}" data-alt-href="${alt ? `${base}${alt.slug}/` : ''}" data-alt-label="${alt ? escapeAttr(alt.title) : ''}" data-alt-slug="${alt ? alt.slug : ''}"`;
  }
  return `<a href="${base}${target.slug}/" class="post-nav-link ${cls} morph t-${target.slug}"${geo} rel="${step < 0 ? 'prev' : 'next'}">${escapeHtml(target.title)}</a>`;
}

// A story's images, as they appear on its page: post bodies hold site-relative
// paths (the EPUB and the feed read those), and a story's page is one directory
// down, so they need the step up, plus their size and lazy loading.
function storyImages(html) {
  return html.replace(/<img\b[^>]*>/gi, tag => {
    const src = tag.match(/\ssrc="(images\/[^"]+)"/i);
    if (!src) return tag;
    const { width, height } = LOCAL_IMAGES.get(src[1]) || {};
    const size = width && height ? ` width="${width}" height="${height}"` : '';
    return tag.replace(src[0], ` src="../${src[1]}"`).replace(/^<img/i, `<img${size} loading="lazy" decoding="async"`);
  });
}

function buildPostPage(post, allPosts) {
  const date = formatDate(post.postedAt);
  const readTime = estimateReadingTime(post.wordCount);
  const social = stats(post);
  const metaLine = [readTime ? `<span class="when">${readTime}</span>` : '', social].filter(Boolean).join('');
  const byDate = sortByDate(allPosts);
  const idx = byDate.findIndex(p => p.slug === post.slug);

  const content = `
    <article>
      <header class="post-header">
        <h1>${escapeHtml(post.title)}</h1>
        <p class="post-byline"><span class="byline">${AUTHOR}</span><span class="when">${date}</span></p>
        ${metaLine ? `<p class="post-meta meta">${metaLine}</p>` : ''}
        <span class="orn" aria-hidden="true"></span>
      </header>
      <div class="post-body">
        ${storyImages(typeset(cleanHtml(post.htmlBody).trim()))}
      </div>
      <p class="end-mark" aria-hidden="true">· · ·</p>
      <footer class="post-footer">
        <nav class="post-nav" aria-label="Newer and older stories">
          ${postNavLink(byDate, idx, -1, '../')}
          ${postNavLink(byDate, idx, 1, '../')}
        </nav>
      </footer>
    </article>`;

  return pageShell(content, post.title, allPosts, post.slug, {
    description: extractExcerpt(post.htmlBody),
    base: '../',
    published: post.postedAt,
  });
}

// Old /slug.html links keep working: a tiny page that sends the reader to
// the story's clean /slug/ URL. Static GitHub Pages cannot return a 301,
// so this is the HTML equivalent (meta refresh plus script), with a
// canonical so search engines see only the clean page.
function buildPostRedirect(post) {
  const href = `${post.slug}/`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(post.title)} — ${escapeHtml(SITE_TITLE)}</title>
<link rel="canonical" href="${SITE_URL}/${post.slug}/">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url=${href}">
<script>location.replace(${JSON.stringify(href)})</script>
</head>
<body><p><a href="${href}">${escapeHtml(post.title)}</a></p></body>
</html>`;
}

function buildIndexPage(posts) {
  const rows = sortByDate(posts).map((p, i) => `
        <li class="story${EDITOR_PICKS.has(p.slug) ? ' pick' : ''}" data-slug="${p.slug}"${EDITOR_PICKS.has(p.slug) ? ' title="Editor\'s pick"' : ''}>
          <span class="title-cell"><a class="story-title morph t-${p.slug}" href="${p.slug}/">${escapeHtml(p.title)}</a>${EDITOR_PICKS.has(p.slug) ? '<span class="sr-only"> (editor\'s pick)</span>' : ''} <span class="meta">${whenText(p)}${stats(p)}</span></span>
        </li>`).join('');

  const content = `
    <header class="site-head">
      <h1 class="site-h1">${AUTHOR}</h1>
      ${bookLink('head-book')}
      <nav class="navbar" aria-label="Site">${navItems(null).replace(/^<a[^>]*nav-home[^>]*>TB<\/a>/, '').replace(/<a[^>]*nav-epub[^>]*>EPUB.*?<\/a>/, m => `<span class="nav-bk-title">${SITE_TITLE}</span>${m}`)}</nav>
      <hr class="head-rule">
    </header>
    <ol class="stories" style="--n:${posts.length}">${rows}
    </ol>`;

  return pageShell(content, null, posts, null);
}

// URL of a file already written to dist/, stamped with a hash of its bytes,
// so a browser or CDN holding an older copy fetches the new one at once and
// every reader sees the current CSS and fonts.
const assetVersions = new Map();
function assetUrl(rel) {
  if (!assetVersions.has(rel)) {
    const bytes = fs.readFileSync(path.join(OUTPUT_DIR, rel));
    assetVersions.set(rel, require('crypto').createHash('sha1').update(bytes).digest('hex').slice(0, 10));
  }
  return `${rel}?v=${assetVersions.get(rel)}`;
}

// The stylesheet lives in style.css so it can be edited as CSS; font URLs get
// their content stamp (the fonts must be in dist/ first).
function buildStylesheet() {
  return fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8')
    .replace(/url\('(fonts\/[^']+\.woff2)'\)/g, (_, rel) => `url('${assetUrl(rel)}')`);
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
    const link = `${SITE_URL}/${p.slug}/`;
    // Keep the old .html URL as the GUID: it is the item's stable identity,
    // and changing it would make every story reappear as new in readers.
    const guid = `${SITE_URL}/${p.slug}.html`;
    return `    <item>
      <title>${escapeXml(p.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${guid}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${escapeXml(p.title)} — ${estimateReadingTime(p.wordCount)}</description>
      <content:encoded><![CDATA[${cleanHtml(p.htmlBody, { forFeed: true }).replace(/src="images\//g, `src="${SITE_URL}/images/`)}<p style="margin-top:2em;font-size:0.9em;color:#888"><a href="${SUBSTACK_URL}" style="color:#a0734f">Subscribe via email</a></p>]]></content:encoded>
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
    .replace(/<hr[^>]*\/?>/gi, '<p class="scene-break">&#x2022;&#x2003;&#x2022;&#x2003;&#x2022;</p>')
    .replace(/<img([^>]*?)(?<!\/)>/gi, '<img$1/>')
    .replace(/&nbsp;/g, '\u00a0')
    .replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;')
    .replace(/<p>\s*<\/p>/g, '')
    .replace(/<h[1-6][^>]*>(?:\s| |<br\s*\/?>)*<\/h[1-6]>/gi, '')
    .replace(/class="(?!scene-break")[^"]*"/g, '')
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

  // Title text in the bundled cover font
  const titleParts = bookTitle.split(' and Other Stories by ');
  const mainTitle = titleParts[0] || bookTitle;
  const subtitle = titleParts.length > 1 ? 'and Other Stories' : '';
  const author = titleParts.length > 1 ? titleParts[1] : '';

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  // Main title
  ctx.font = '84px "EB Garamond"';
  ctx.fillStyle = coverPal.title;
  ctx.fillText(mainTitle, W / 2, H * 0.73);

  // Subtitle
  ctx.font = 'italic 36px "EB Garamond"';
  ctx.fillStyle = coverPal.sub;
  ctx.fillText(subtitle.toLowerCase(), W / 2, H * 0.73 + 100);

  // Author
  ctx.font = '40px "EB Garamond"';
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

// Local copies of story images, keyed by site-relative path ('images/…').
// Filled by localizeImages(); used for dist/, the EPUB, and RSS absolutization.
const LOCAL_IMAGES = new Map();

// Pixel size, for the width and height attributes that keep a page from
// shifting as its images arrive. A format canvas cannot read just goes without.
async function imageSize(data, name) {
  try {
    const { width, height } = await loadImage(data);
    return { width, height };
  } catch (err) {
    console.warn(`  [DEGRADED] no size for ${name}: ${err.message}`);
    return {};
  }
}

// Download every remote image referenced in post bodies and rewrite the srcs
// to site-relative paths, so the site doesn't hotlink LessWrong's CDN.
async function localizeImages(posts) {
  const urlToPath = new Map();
  for (const post of posts) {
    // LessWrong ships responsive srcset/sizes pointing at its Cloudinary CDN.
    // Browsers prefer srcset over the localized src, and EPUB forbids remote
    // resources, so keep only src. Images LW gives no alt text get alt="".
    post.htmlBody = post.htmlBody.replace(/<img\b[^>]*>/gi, tag => {
      let t = tag.replace(/\s(?:srcset|sizes)="[^"]*"/gi, '');
      if (!/\salt=/i.test(t)) t = t.replace(/^<img/i, '<img alt=""');
      return t;
    });
    const urls = [...post.htmlBody.matchAll(/<img[^>]*?src="([^"]+)"/gi)].map(m => m[1]);
    for (const url of urls) {
      if (url.startsWith('data:') || url.startsWith('images/')) continue;
      if (!urlToPath.has(url)) {
        console.log(`  Localizing image: ${url.slice(0, 80)}...`);
        const img = await downloadImage(url);
        if (!img) continue;
        const name = `images/img-${hashStr(url).toString(36)}.${img.ext}`;
        LOCAL_IMAGES.set(name, { data: img.data, mediaType: img.mediaType, ...await imageSize(img.data, name) });
        urlToPath.set(url, name);
      }
      post.htmlBody = post.htmlBody.split(url).join(urlToPath.get(url));
    }
  }
}

async function buildEpub(posts, sortLabel, bookTitle, coverPng = null) {
  const bookId = `tomas-b-fiction-by-${sortLabel}`;
  const entries = [];
  const allImages = []; // { id, filename, mediaType, data }
  const embeddedLocal = new Set();

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
  if (!coverPng) coverPng = buildCoverPng(posts, bookTitle);
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
    // Find all image URLs in the post HTML and embed them
    let body = htmlToXhtml(post.htmlBody);
    const imgRegex = /<img([^>]*?)src="([^"]+)"([^>]*?)\/?>/gi;
    const imgMatches = [...body.matchAll(imgRegex)];
    for (const match of imgMatches) {
      const url = match[2];
      if (url.startsWith('data:')) continue;
      if (url.startsWith('images/')) {
        // Already localized by localizeImages() — embed the cached copy
        if (embeddedLocal.has(url)) continue;
        const local = LOCAL_IMAGES.get(url);
        if (!local) continue;
        allImages.push({ id: `img-${allImages.length}`, filename: url, mediaType: local.mediaType, data: local.data });
        entries.push({ name: `OEBPS/${url}`, data: local.data });
        embeddedLocal.add(url);
        continue;
      }
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
.scene-break { text-align: center; margin: 2em 0; color: #999; }
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
    <itemref idref="cover"/>
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
  checkSlugs(fiction);
  console.log(`Found ${fiction.length} fiction posts (${external.length} external)`);

  if (fiction.length === 0) {
    console.error('No fiction posts found! Check that posts are tagged with "Fiction".');
    process.exit(1);
  }

  // Create output directory
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Prevent Jekyll processing on GitHub Pages
  fs.writeFileSync(path.join(OUTPUT_DIR, '.nojekyll'), '');

  // Self-host story images instead of hotlinking LessWrong's CDN
  await localizeImages(fiction);
  if (LOCAL_IMAGES.size > 0) {
    fs.mkdirSync(path.join(OUTPUT_DIR, 'images'), { recursive: true });
    for (const [name, img] of LOCAL_IMAGES) {
      fs.writeFileSync(path.join(OUTPUT_DIR, name), img.data);
    }
    console.log(`Wrote ${LOCAL_IMAGES.size} images to images/`);
  }

  // Self-hosted text faces (fonts/web/), then the stylesheet that stamps them
  const webFonts = path.join(__dirname, 'fonts', 'web');
  fs.mkdirSync(path.join(OUTPUT_DIR, 'fonts'), { recursive: true });
  for (const name of fs.readdirSync(webFonts).filter(n => n.endsWith('.woff2'))) {
    fs.copyFileSync(path.join(webFonts, name), path.join(OUTPUT_DIR, 'fonts', name));
  }
  fs.writeFileSync(path.join(OUTPUT_DIR, 'style.css'), buildStylesheet());
  console.log('Wrote style.css');
  for (const f of ['favicon.svg', 'site.js']) fs.copyFileSync(path.join(__dirname, f), path.join(OUTPUT_DIR, f));
  try {
    fs.writeFileSync(path.join(OUTPUT_DIR, 'apple-touch-icon.png'), await buildTouchIcon());
    hasTouchIcon = true;
  } catch (err) {
    console.warn(`[DEGRADED] no apple-touch-icon.png: ${err.message}`);
  }
  if (!SHOW_SIGNUP) console.warn('[DEGRADED] no Formspree form ID, so the footer signup is left out of this build');

  // The cover (shared by the EPUB and og:image), before the pages that state its size
  const collection = orderForCollection(fiction);
  const coverPng = buildCoverPng(collection, BOOK_TITLE);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'cover.png'), coverPng);
  coverSize = { width: coverPng.readUInt32BE(16), height: coverPng.readUInt32BE(20) };
  console.log('Wrote cover.png');

  // Reader metrics and per-title fonts
  attachMetrics(fiction, await fetchSubstackMetrics());
  const assignedFaces = titleFontFor(fiction);
  const titleFaceList = titleFaceCatalog(fiction, assignedFaces);
  const [subsetFonts, titleFonts, specimenFiles] = await Promise.all([
    fetchSubsetFonts(fiction),
    fetchTitleFonts(fiction, assignedFaces),
    fetchTitleFontSpecimens(titleFaceList),
  ]);
  pruneSubsets();
  fs.writeFileSync(path.join(OUTPUT_DIR, 'titles.css'), buildTitlesCss(fiction, subsetFonts, titleFonts));
  console.log('Wrote titles.css');
  fs.writeFileSync(path.join(OUTPUT_DIR, 'title-fonts.css'), buildTitleFontsCss(titleFaceList, specimenFiles));
  console.log('Wrote title-fonts.css');

  // Write index page
  fs.writeFileSync(path.join(OUTPUT_DIR, 'index.html'), buildIndexPage(fiction));
  console.log('Wrote index.html');

  // Write the title-fonts specimen page
  const titleFontsDir = path.join(OUTPUT_DIR, 'title-fonts');
  fs.mkdirSync(titleFontsDir, { recursive: true });
  fs.writeFileSync(path.join(titleFontsDir, 'index.html'), buildTitleFontsPage(fiction, titleFaceList, specimenFiles));
  console.log('Wrote title-fonts/index.html');

  // Success page for the footer email signup
  const subscribedDir = path.join(OUTPUT_DIR, 'subscribed');
  fs.mkdirSync(subscribedDir, { recursive: true });
  fs.writeFileSync(path.join(subscribedDir, 'index.html'), buildSuccessPage(fiction));
  console.log('Wrote subscribed/index.html');

  fs.writeFileSync(path.join(OUTPUT_DIR, '404.html'), buildNotFoundPage(fiction));
  fs.writeFileSync(path.join(OUTPUT_DIR, 'sitemap.xml'), buildSitemap(fiction));
  fs.writeFileSync(path.join(OUTPUT_DIR, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`);
  console.log('Wrote 404.html, sitemap.xml, robots.txt');

  // Write individual post pages as clean directory URLs (/slug/) and keep
  // the old /slug.html paths as redirects, so existing links still resolve.
  for (const post of fiction) {
    const dir = path.join(OUTPUT_DIR, post.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), buildPostPage(post, fiction));
    fs.writeFileSync(path.join(OUTPUT_DIR, `${post.slug}.html`), buildPostRedirect(post));
    console.log(`Wrote ${post.slug}/index.html (+ ${post.slug}.html redirect)`);
  }

  // Generate EPUB
  const epub = await buildEpub(collection, 'collection', BOOK_TITLE, coverPng);
  fs.writeFileSync(path.join(OUTPUT_DIR, EPUB_FILENAME), epub);
  console.log(`Wrote ${EPUB_FILENAME} (${collection.length} stories)`);

  // Variant EPUB without the GEO_HIDDEN stories, linked in place of the full one
  // for matching readers. Shares the full EPUB's cover so the two look alike.
  const geoHiddenSlugs = GEO_HIDDEN.map(r => r.slug);
  const altCollection = collection.filter(p => !geoHiddenSlugs.includes(p.slug));
  if (altCollection.length !== collection.length) {
    const epubAlt = await buildEpub(altCollection, 'collection', BOOK_TITLE, coverPng);
    fs.writeFileSync(path.join(OUTPUT_DIR, EPUB_FILENAME_ALT), epubAlt);
    console.log(`Wrote ${EPUB_FILENAME_ALT} (${altCollection.length} stories)`);
  }

  // Generate RSS feed
  const feedXml = buildRssFeed(fiction);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'feed.xml'), feedXml);
  console.log('Wrote feed.xml');

  // /rss redirect for browsers (RSS readers should use feed.xml directly)
  const rssDir = path.join(OUTPUT_DIR, 'rss');
  fs.mkdirSync(rssDir, { recursive: true });
  fs.writeFileSync(path.join(rssDir, 'index.html'),
    '<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=../feed.xml"/></head><body></body></html>');
  console.log('Wrote rss/index.html (redirect to feed.xml)');

  // /subscribe redirect to Substack (useful for sharing on platforms that downweight Substack links)
  const subscribeDir = path.join(OUTPUT_DIR, 'subscribe');
  fs.mkdirSync(subscribeDir, { recursive: true });
  fs.writeFileSync(path.join(subscribeDir, 'index.html'),
    `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${SUBSTACK_URL}"/></head><body></body></html>`);
  console.log('Wrote subscribe/index.html (redirect to Substack)');

  checkLocalReferences();

  console.log(`\nDone! ${fiction.length} pages + EPUB + RSS generated in ${OUTPUT_DIR}/`);
}

// Every src and href on every page must resolve to a file in dist/, the way a
// browser would resolve it from that page. A broken one stops the build, so
// the last good deploy stays live: story images once 404ed for a day because
// nothing looked. Links inside story text are the author's, so a relative one
// there only warns.
function checkLocalReferences() {
  const pages = [];
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.html')) pages.push(full);
    }
  };
  walk(OUTPUT_DIR);
  const broken = [], soft = [];
  for (const page of pages) {
    const html = fs.readFileSync(page, 'utf8');
    const start = html.indexOf('<div class="post-body">'), end = html.indexOf('<p class="end-mark"');
    for (const m of html.matchAll(/\s(src|href)="([^"]+)"/g)) {
      const url = m[2].replace(/&amp;/g, '&').split(/[?#]/)[0];
      if (!url || /^[a-z][a-z0-9+.-]*:|^\/\//i.test(m[2])) continue;
      const target = url.startsWith('/') ? path.join(OUTPUT_DIR, url) : path.resolve(path.dirname(page), url);
      if (fs.existsSync(target) && (!fs.statSync(target).isDirectory() || fs.existsSync(path.join(target, 'index.html')))) continue;
      const where = `${path.relative(OUTPUT_DIR, page)}: ${m[2]}`;
      (m[1] === 'href' && m.index > start && start >= 0 && m.index < end ? soft : broken).push(where);
    }
  }
  for (const w of soft) console.warn(`[DEGRADED] relative link in story text goes nowhere: ${w}`);
  if (broken.length) throw new Error(`broken references:\n  ${broken.join('\n  ')}`);
  console.log(`Checked local references on ${pages.length} pages`);
}

// Export for testing, run if called directly
function setCoverStyle(s) { COVER_STYLE = s; }
function setRidgePalette(p) { RIDGE_PALETTE = p; }
module.exports = { buildPostPage, buildIndexPage, buildStylesheet, filterFiction, pageShell, buildCoverPng, setCoverStyle, setRidgePalette };

if (require.main === module) {
  main().catch(err => {
    console.error('Build failed:', err);
    process.exit(1);
  });
}
