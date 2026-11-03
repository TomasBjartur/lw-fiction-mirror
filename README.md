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

Reading requires no JavaScript. The contents page is a numbered list,
newest first, with each story's LessWrong karma and comments and its
Substack likes, restacks and comments, fetched at build time (LessWrong
from the GraphQL query, Substack from `/api/v1/archive`; a failed fetch
logs `[DEGRADED]` and the build continues without those numbers). Story
pages link to the newer and older story.

Every font is served by the site, so every device renders the same:
nothing relies on fonts the reader has installed. The faces follow
markusstrasser.org: Cormorant Garamond for headings, Inter (standing in
for the system UI font) for the list of titles and the interface, Charis
SIL (the open build of Charter) for story text and Fira Mono for code.
Their latin subsets live in `fonts/web/` (`scripts/fetch-webfonts.py`
refreshes them). Characters outside those subsets (the nav marks,
arrows, and any such character in a story, like the █ redactions) go into a small Noto Sans JP subset the build fetches.
`bun scripts/font-audit.mjs <url>...` asks Chrome which fonts each page
actually draws with and exits 1 if any came from the device.

Hovering a title turns it letter by letter (25 ms a letter, forwards only; leaving resets it) into Major Mono Display (a
build-time subset of just the letters the titles use). The mono letters
are set at one smaller size (0.62em) so every title fits its resting
width; glyphs are never stretched and nothing on the page moves. Title colours shade from
near-black (newest) to dark purple (oldest); `dist/titles.css` holds them.

A small inline script adds the optional extras: the dark-mode toggle, a
recent / book-order switch (remembered in localStorage; book order is
`COLLECTION_ORDER`, as in the EPUB), arrow keys for newer/older, and the hover
morph. The only
external request on the reader's end is the `GEO_HIDDEN` lookup to
ipapi.co, which runs on every page view (cached 24h) while any rule is
configured.
