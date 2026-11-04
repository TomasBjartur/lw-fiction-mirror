# Tomás B. Fiction Mirror

A static site that mirrors fiction posts from [LessWrong](https://www.lesswrong.com/users/bjartur-tomas), plus a couple of externally hosted stories.

## How it works

- `build.js` queries the LessWrong GraphQL API for posts tagged "Fiction" (plus a hardcoded list of external stories) and generates static HTML + CSS
- Story pages are written as `dist/<slug>/index.html`, so their URLs are `/<slug>/`; each old `dist/<slug>.html` path is a redirect stub, so existing links still land on the clean page
- Story images are downloaded and self-hosted under `dist/images/`
- An EPUB of the collection, an RSS feed (`feed.xml`), and a shareable cover image (`cover.png`, also used for social previews) are generated in the same pass
- A GitHub Action rebuilds every 6 hours and deploys `dist/` to GitHub Pages

## Local development

```bash
npm install
node build.js
python3 -m http.server 8787 -d dist
# Open http://localhost:8787/
```

A local server, not `file://`, because story URLs are clean directories
(`/duane-arnold-1/`). The old `.html` paths still redirect.

Requires Node 18+ and the `canvas` package (used for cover text rendering). The cover typeface, EB Garamond (SIL OFL), is bundled in `fonts/` so local and CI builds render identically.

## Deploying

`.github/workflows/` contains the deploy workflow: it builds the site and publishes `dist/` to GitHub Pages on push to `main`, every 6 hours, or manually via workflow_dispatch. The custom domain is configured in the repo's Pages settings.

## Customisation

Edit the config block at the top of `build.js`:

```js
const SITE_TITLE = 'The Origami Men and Other Stories';
const SITE_SUBTITLE = 'by Tomás Bjartur';
```

Story ordering lives in `COLLECTION_ORDER`. Stories not in the list are inserted before the final entry (the title story keeps closing the book), sorted by karma. `EXCLUDED_SLUGS` hides posts entirely; `FORCE_INCLUDE_SLUGS` admits stories below the karma cutoff.

`GEO_HIDDEN` hides individual stories from readers in a given place. Each rule
matches on whichever of `city` / `region` / `country` it specifies:

```js
const GEO_HIDDEN = [
  { slug: 'our-beloved-monsters', region: 'BC', country: 'CA' },
];
```

A matching reader loses the story from the contents list and the newer/older
links, is redirected to
the index if they open the story URL directly, and gets their EPUB download
pointed at `EPUB_FILENAME_ALT` — a second EPUB built in the same pass, with the
same cover and title, minus the hidden stories.

This is a curtain, not a block. The check runs in the reader's browser against
`GEO_LOOKUP_URL` (ipapi.co) *after* the page HTML has already been delivered, so
view-source, disabling JS, `curl`, a VPN, and the RSS feed all bypass it — as
does the original post on LessWrong, which the site only mirrors. It fails open:
if the lookup errors, times out, or is blocked, nothing is hidden. The result is
cached in `localStorage` for 24h to stay under the free tier's rate limit.

## Architecture

Reading requires no JavaScript. The page is light until the reader
picks dark: the theme button (a sun in light, a crescent in dark)
switches between the two and remembers the choice (a blocking
script in `<head>` applies it before first paint). Each colour token is written once with `light-dark()` in
`style.css`; the dark values (warm near-black page, off-white text at
APCA Lc 88 rather than pure white, accents lifted and desaturated, story
images dimmed to 85%, interface weight 360 instead of 400) come from a
research pass on dark-mode reading (Material, Apple HIG, APCA, polarity
studies). `light-dark()` sets the browser baseline (Safari 17.5, Chrome
123, Firefox 120, all from May 2024 or earlier); older browsers are not
supported.

`style.css` keeps every colour, size, space and duration as a token in
`:root`; components use only tokens, and breakpoints change tokens or
the layout tokens can't express (its header lists the breakpoints). The
contents
page opens with the author's name (Send Flowers), the book and the links
(RSS, X, and a Substack-orange Subscribe button that goes to Substack)
above a thin grey rule. The book is its title in Urbanist Light,
plain (no link), followed by "EPUB" and a download mark in the accent red, the one
link, underlined, that downloads the EPUB. From 1040 px up (65em, so a larger text setting gets it later) it sits in the
nav, its EPUB link a nav item level with RSS and X; on narrower screens it goes below the
rule, indented to the list, at story-title size. In wide windows the list starts on the left edge of a story page's frame, so opening a story keeps the eye on the same line; a narrower window gives that up to keep the widest row whole, then settles on one indent, all from one `padding-left` with no breakpoint. The footer carries it
too (except on a phone's contents page, where it is already under the
name). Story pages put "TB" (in the name's face) and the EPUB link in
their nav. The tab icon is "TB" in the name's face, in the accent red on
the paper colour (dark values in a dark system theme); `scripts/favicon.py`
writes it to `favicon.svg` from the name's font subset, which the build
copies to `dist/` and also draws as a full-bleed `apple-touch-icon.png`.
The build writes `404.html`, `robots.txt` and `sitemap.xml` too. Every story's row is the
same height: a share of the window's height (on phones, with the
browser's toolbars showing), at most 2.875rem and at most what the
list's width lets a title be, with titles scaled to the row, so rows
never sit looser than their titles. Spare height stays under the list
and the footer sits at the bottom of the window. Each row's baseline
falls in the same place whatever its title's face (`--title-base` in
`style.css`), and the date and counts share it, so the rows read as
evenly spaced at every width. The footer is the last row of a one-column grid
that fills the window on every page, so a short story's footer still
sits at the bottom; the author's signature (Homemade Apple, subset) is
at its right. The footer also carries the email signup, copied from
markusstrasser.org's form; its Formspree endpoint is
`NEWSLETTER_FORM_ACTION` in `build.js`, a placeholder until Tomás's form
ID is supplied. Until then a deploy (CI set) leaves the form out and logs
`[DEGRADED]`; a local build keeps it for review. The nav Subscribe button
still goes to Substack, and a successful signup lands on `/subscribed/`. On
phones (40em, 640 px at the default text size, and under) the meta sits on its own line under each
title and the largest faces come partway back to the others
(`--ts-spread`), so San Silvestro's swash clears the date above it. Rows
stop shrinking at 1.9rem, or 2.3rem on phones to keep titles readable,
and past that the page scrolls. A title too
wide for its space (a long title in a wide face in a list row, or a long
word in a story's title, on a phone) is shrunk to fit by a small script
(`site.js`, which holds all the behaviour except the geo curtain; that
stays inline so it can act before first paint).
Each title is followed by its month and reading time in Urbanist Light,
upright (reading time at 260 words a minute, Brysbaert's 2019 mean for
fiction, rounded to the minute under 10 and to 5 minutes above), then its
LessWrong karma and comments and Substack likes, restacks and comments,
small, in Urbanist Light (LessWrong from the GraphQL
query, Substack from `/api/v1/archive`; a failed fetch logs `[DEGRADED]`
and the build continues without those numbers). Story pages link to the
newer and older story; the list wraps, so the newest story's "newer" link
is the oldest story and the oldest's "older" link is the newest.

Every font is served by the site, so every device renders the same:
nothing relies on fonts the reader has installed. Inter (standing in for
the system UI font) sets the interface; Urbanist, in its Light weight,
sets dates, reading times and the reader counts; EB Garamond sets story
text, headings inside stories and the book; Zallman Caps the initials;
Fira Mono any code; Homemade Apple the footer signature.

Story pages are set as a printed book page (treatment A of the reading
lab, Markus's pick): EB Garamond at 19-21.5 px on a ~62-character line,
justified and hyphenated (ragged on phones, where browser justification
opens gaps), 1em indents, a centred spaced-capitals title over the
author's name, and decorated initials with small-caps lead-ins. The
build also typesets story text on the page only (`typeset()` in
`build.js`; the EPUB and feed keep the source): curly quotes, spaced
hyphens to em dashes, `...` to ellipses, and a lone acronym of 3+
capitals (MIND, AGI) in small caps. Runs of capitalised words (a shouted
sign, "[RESPONSE REDACTED]") keep their full capitals.

Initials mark each beginning and resumption of the text, graded as in
manuscripts and in Bringhurst (4.1.4): a three-line initial opens the
story and a two-line one opens each section after a scene break, each
followed by a small-caps lead-in. Ordinary paragraphs get none, and
neither does a paragraph that opens on anything but a word or a quote.
The face is Zallman Caps, Dieter Steffmann's vine-framed capitals from
CTAN; `scripts/initials-lab-fonts.py --site 'Zallman Caps'` converts it
from Type 1 into `fonts/web/` with its cap height set to the whole
decorated box, so `initial-letter` sizes the box. The initial is the
paragraph's `::first-letter`, which also takes any punctuation touching
the letter, so the build keeps the text whole for copying, Reader view
and screen readers: a leading quotation mark stays in the text, where
the initials face draws it as nothing, and CSS hangs a visible one in
the margin at text size (Bringhurst 4.1.5); punctuation right after the
letter (I'm) is cut off from the initial by an invisible word joiner. A
paragraph shorter than its initial is held open to the initial's depth,
so the next paragraph starts below it. Firefox has no `initial-letter`
and gets a float sized to the same box. Chrome drops a space that starts
a line beside an initial, from copies and from what screen readers hear
("Iheard"), so the space after a one-letter first word sits in a
zero-width box. `node scripts/initials-check.mjs
<chrome|firefox|webkit>` checks every story's initials in a real engine,
copying included (its header says how to install the engines).
`scripts/initials-lab.js` writes `dist/initials-lab/`, the comparison of
faces, frequencies and quote treatments behind this choice; a design
tool, not part of the site.

While reading, the nav slides away on scrolling down and returns on any
scroll up, near the top, or on keyboard focus; a hairline across the top
fills with progress through the story text, reaching the end at its last
line rather than the footer. The nav slide and progress bar are small
scripts copied from markusstrasser.org (`Nav.svelte`,
`ReadingProgress.svelte`).

A story remembers where the reader stopped, in `localStorage`, as a paragraph
and how far into it the window's top was, because a scroll offset means
nothing once the width or text size changes. A later visit opens there, and
rotating a phone or resizing the window keeps the place. Back, forward and
reload stay the browser's own, and a link to a place in the story wins. The
first screen of text doesn't count, and reaching the last line clears it, so
a finished story opens at its title again. Only the reader moving saves
anything, so a page left idle in another tab, or an old history entry, can't
erase a later place. `node scripts/reading-check.mjs <chrome|firefox|webkit>`
tries all of this with a real wheel, mouse and keyboard.

The story fonts' latin subsets live in `fonts/web/`
(`scripts/fetch-webfonts.py` refreshes them). Characters outside those
subsets (the nav marks, arrows, and any such character in a story, like
the █ redactions) go into a small Noto Sans JP subset the build fetches.
`bun scripts/font-audit.mjs <url>...` asks Chrome which fonts each page
actually draws with and exits 1 if any came from the device, or if it
measured no fonts at all (a blank or wrong tab). EB Garamond is built
from the full upstream font rather than Google's css2 file, which strips
the old-style figures.

`scripts/reading-lab.js` (with `scripts/reading-lab-fonts.py` for its
fonts) writes `dist/reading-lab/`: three alternative story-page
treatments (book page in EB Garamond, Literata for screens, an editorial
layout in Alegreya Sans) of three stories, to compare against the
current page. A design tool, not part of the site.

Each story's title in the contents list (and in the newer/older links)
has its own display face, from Markus's picks: `TITLE_FONTS` in
`build.js` maps slug to [Google css2 spec, size factor, weight, and an
optional stroke in em for faces drawn in hairlines]. The
build fetches a subset of just that title's letters per story; a story
without an entry uses the list sans. These subsets, and the name, book
title, hover and marks subsets, are kept in `fonts/subsets/`, which is
committed: CI builds use those files and only ask Google when a title or
story adds characters. A fetch that fails stops the build, so the last
good deploy stays live instead of shipping a title in a fallback face.
Commit `fonts/subsets/` after a local build that changed it (unused
files are pruned). CSS and font URLs carry a hash of the file's bytes
(`?v=`), so no browser or CDN cache serves an old copy after a deploy.

Three title faces are colour fonts (Bitcount Double Ink, Kalnia Glaze,
Bungee Spice; Foldit in the backlog too), and Google serves them as
COLRv1, which Safari's engine cannot draw: on Macs and on every iPhone
browser those titles were blank. `scripts/colr-twin.py` adds an OpenType
SVG table to a copy of each file, and the `@font-face` offers the original
with `tech(color-COLRv1)` first, so Chrome and Firefox never fetch the
copy and Safari only fetches the copy. Firefox must stay on the original,
because it prefers SVG and draws that Bitcount black. The copies are
committed as `fonts/subsets/<key>.safari.woff2` and take `uv` to make. CI
has no `uv`, so a retitled colour story logs `[DEGRADED]` there and Safari
sets that title in the sans until a local build commits its copy. Safari
draws Bitcount a little pinker than Chrome does. `node scripts/ink-check.mjs
<chrome|firefox|webkit>` reads the pixels of every title, specimen, date
and count at a desktop and a phone width, and fails on a blank box, a face
that did not load or a colour face drawn without colour. Run it after
changing a title face; the width checks cannot see a blank glyph.

`dist/title-fonts/` (the unlinked `/title-fonts/` page) is a specimen of
every face the site has picked: each story's title face in contents
order, then the backlog. Each shows the family name set in the face, the
title it sets (or the book's title, for a backlog face) and its alphabet;
its faces are one more `text=` subset per family, kept in the same
`fonts/subsets/` cache.

Hovering a title turns it, letter by letter, red (the accent of every
hover) and into Major Mono Display (a build-time subset of just the
letters the titles use). The whole title changes strictly left to right,
one letter at a time, each after a random wait (3-54 ms, mostly short).
A title longer than 20 letters speeds up letter by letter, so the sweep
finishes in about the time a 20-letter title would. The waits follow the
clock rather than the timer: where a step is slow to draw (Safari takes
about 90 ms a step on Customer Satisfaction Opportunities, whose glyphs
are OpenType SVG) several letters turn together and the sweep still takes
the same time. Each
letter turns red as it changes; the rest keep the title's colour. The morph only plays
forwards; leaving resets it. The title keeps its resting box, so nothing
on the page moves. Major Mono is wider than every title face, so the
mono text takes the geometric mean of the size that matches the title's
width and the size that matches its letters' height, set 0.08em tight:
a hovered title grows a little wider and a little shorter, never much of
either. It may run past the title (the meta beside it fades out) up to
the end of the column, or in the newer/older row up to the other link,
where it shrinks to fit. The mono glyphs overflow that box rather than
resize it, so they are not hit-testable: the link's resting box is the
whole hover target, and a hovered title cannot cover its neighbour. A
story's own title, set in EB Garamond capitals, does the same, showing the
letters as they are in the list. Opened by clicking a title with a mouse, it
starts already turned and lets go when the pointer moves off it or on the first
scroll. The click leaves a note in `sessionStorage`; a small script in the next
page's head reads it before first paint and keeps the title hidden until it has
turned, since Firefox and Safari would otherwise flash its resting face. After
0.6 s it shows at rest and stays at rest. `node scripts/hover-check.mjs
<chrome|firefox|webkit>` hovers every title in a real engine (the list, and
each story's title and newer/older links, at three desktop widths) and fails if a
hovered title breaks that rule (width times height off by more than 3%,
either off by more than 40%, a wrapped word growing) or its row moves.
Story pages sign the story in the name's face (Send Flowers), as in the
header. Title colours shade from near-black (newest) to dark purple
(oldest); `dist/titles.css` holds them.

Book order (`COLLECTION_ORDER`) now only shapes the EPUB. The only
external request on the reader's end is the `GEO_HIDDEN` lookup to
ipapi.co, which runs on every page view (cached 24h) while any rule is
configured.

Stories marked as editor's picks (`EDITOR_PICKS`) get a red rule (the
link-hover and EPUB accent, dark fading to mid) in the margin of the contents list. A story with no `TITLE_FONTS`
entry takes the next face from `TITLE_FONT_BACKLOG` (unused faces from
Markus's picks, oldest new story first), and the build log names it so
it can be pinned.

## Open questions for Tomás

- **What should stop a deploy?** The site rebuilds every 6 hours. Right
  now four things stop a build (the last good version stays live):
  a story font that can't be fetched from Google, a `GEO_HIDDEN` slug
  that matches no story, a page whose `src` or `href` points at no file
  in `dist/` (a relative link inside story text only warns), and the
  usual API failures. Stale slugs in
  `TITLE_FONTS`, `EDITOR_PICKS`, `COLLECTION_ORDER` or
  `FORCE_INCLUDE_SLUGS` (e.g. a story renamed on LessWrong) only log
  `[DEGRADED]`. Is that the split you want, or should every stale slug
  stop the build, or none?
- **Who watches failed builds?** GitHub emails a failed Actions run to
  the repo owner only. If nobody reads those, a stopped build means new
  stories silently don't appear.
- **Fonts for new stories:** fine to take them from the backlog
  automatically, or would you rather pick each one?

