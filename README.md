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

Requires Node 18+ and the `canvas` package (used for cover text rendering).

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

A matching reader loses the story from the sidebar and index, is redirected to
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

Reading requires no JavaScript — the sidebar navigation and mobile hamburger menu are pure HTML + CSS. A small inline script adds the optional niceties: dark-mode toggle and the Book Order / Recent sort switcher (both remembered in localStorage). Fonts are system fonts (Charter/Georgia serif stack); there are no external requests on the reader's end.
