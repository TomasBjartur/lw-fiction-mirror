# Tomás B. Fiction Mirror

A static site that mirrors fiction posts from [LessWrong](https://www.lesswrong.com/users/bjartur-tomas), plus a couple of externally hosted stories.

## How it works

- `build.js` queries the LessWrong GraphQL API for posts tagged "Fiction" (plus a hardcoded list of external stories) and generates static HTML + CSS
- Story images are downloaded and self-hosted under `dist/images/`
- An EPUB of the collection, an RSS feed (`feed.xml`), and a shareable cover image (`cover.png`, also used for social previews) are generated in the same pass
- A GitHub Action rebuilds every 6 hours and deploys `dist/` to GitHub Pages

## Local development

```bash
npm install
node build.js
# Open dist/index.html in a browser
```

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

Reading requires no JavaScript. Light and dark themes follow the
reader's system setting; the ◐ button cycles System → Light → Dark and
remembers the choice (a blocking script in `<head>` applies it before
first paint). Each colour token is written once with `light-dark()` in
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
above a thin black rule. The book is its title in the text face,
underlined, followed by "EPUB" and a download mark in the accent red: one
link that downloads the EPUB. From 1200 px up it sits on the name's row
at the size of the nav labels; on narrower screens it goes below the
rule, indented to the list, at story-title size. The footer carries it
too (except on a phone's contents page, where it is already under the
name). Story pages put "TB" (in the name's face) and the EPUB link in
their nav. On screens at least 520 px tall the list fills the window:
one equal row per story, titles scaled to the row, so every story shows
without scrolling (on phones, with the browser's toolbars showing). On
phones (640 px and under) the meta sits on its own line under each
title. Rows never go below 2.1rem, so a long list scrolls. A title too
wide for its space (a long title in a wide face in a list row, or a long
word in a story's title, on a phone) is shrunk to fit by a small script.
Each title is followed by its month and reading time in Inter Light,
upright, the month a weight up (reading time at 260 words a minute, Brysbaert's 2019 mean for
fiction, rounded to the minute under 10 and to 5 minutes above), then its
LessWrong karma and comments and Substack likes, restacks and comments,
small, in EB Garamond with old-style figures (LessWrong from the GraphQL
query, Substack from `/api/v1/archive`; a failed fetch logs `[DEGRADED]`
and the build continues without those numbers). Story pages link to the
newer and older story; the list wraps, so the newest story's "newer" link
is the oldest story and the oldest's "older" link is the newest.

Every font is served by the site, so every device renders the same:
nothing relies on fonts the reader has installed. Inter (standing in for
the system UI font) sets the interface and, in its Light weight, dates and
reading times; EB Garamond sets story text, headings inside stories, the
reader counts and the book; Zallman Caps the initials; Fira Mono any
code.

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
and gets a float sized to the same box. Chrome copies a one-letter
opening word without its space ("Iheard"); Safari and Firefox copy it
whole. `node scripts/initials-check.mjs <chrome|firefox|webkit>` checks
every story's initials in a real engine (its header says how to install
the engines). `scripts/initials-lab.js` writes `dist/initials-lab/`, the
comparison of faces, frequencies and quote treatments behind this
choice; a design tool, not part of the site.

While reading, the nav slides away on scrolling down and returns on any
scroll up, near the top, or on keyboard focus; a hairline across the top
fills with progress through the story text, reaching the end at its last
line rather than the footer. Both copy markusstrasser.org (`Nav.svelte`,
`ReadingProgress.svelte`). Their latin subsets live in `fonts/web/`
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
`build.js` maps slug to [Google css2 spec, size factor, weight]. The
build fetches a subset of just that title's letters per story; a story
without an entry uses the list sans. These subsets, and the name, book
title, hover and marks subsets, are kept in `fonts/subsets/`, which is
committed: CI builds use those files and only ask Google when a title or
story adds characters. A fetch that fails stops the build, so the last
good deploy stays live instead of shipping a title in a fallback face.
Commit `fonts/subsets/` after a local build that changed it (unused
files are pruned). CSS and font URLs carry a hash of the file's bytes
(`?v=`), so no browser or CDN cache serves an old copy after a deploy.

Hovering a title turns it red (the accent of every hover) and, letter
by letter, into Major Mono Display (a build-time subset of just the
letters the titles use). The letters change in a loose left-to-right
sweep: each step turns one of the next three, sometimes two at once,
after a random 4-40 ms, about 10 ms a letter. The morph only plays
forwards; leaving resets it. The title keeps its resting box, so nothing
on the page moves. Major Mono is wider than every title face, so the
mono text takes the geometric mean of the size that matches the title's
width and the size that matches its letters' height, set 0.08em tight:
a hovered title grows a little wider and a little shorter, never much of
either. It may run past the title (the meta beside it fades out) up to
the end of the column, where it shrinks to fit.
Story pages sign the story in the name's face (Send Flowers), as in the
header. Title colours shade from near-black (newest) to dark purple
(oldest); `dist/titles.css` holds them.

A small inline script adds the optional extras: arrow keys for
newer/older and the hover morph (book order, `COLLECTION_ORDER`, now only
shapes the EPUB). The only
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
  now three things stop a build (the last good version stays live):
  a story font that can't be fetched from Google, a `GEO_HIDDEN` slug
  that matches no story, and the usual API failures. Stale slugs in
  `TITLE_FONTS`, `EDITOR_PICKS`, `COLLECTION_ORDER` or
  `FORCE_INCLUDE_SLUGS` (e.g. a story renamed on LessWrong) only log
  `[DEGRADED]`. Is that the split you want, or should every stale slug
  stop the build, or none?
- **Who watches failed builds?** GitHub emails a failed Actions run to
  the repo owner only. If nobody reads those, a stopped build means new
  stories silently don't appear.
- **Fonts for new stories:** fine to take them from the backlog
  automatically, or would you rather pick each one?

