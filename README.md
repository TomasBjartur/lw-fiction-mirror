# Tomás B. Fiction Mirror

A static site that mirrors fiction posts from [LessWrong](https://www.lesswrong.com/users/bjartur-tomas).
## How it works

- `build.js` queries the LessWrong GraphQL API for posts tagged "Fiction"
- Generates pure static HTML + CSS (no JavaScript required to read)
- A GitHub Action rebuilds every 6 hours and deploys to Cloudflare Pages

## Local development

```bash
node build.js
# Open dist/index.html in a browser
```

## Deploying to Cloudflare Pages

1. Push this repo to GitHub
2. Go to [Cloudflare Pages](https://pages.cloudflare.com/) and create a new project
3. Connect your GitHub repo
4. Set build command: `node build.js`
5. Set build output directory: `dist`
6. Optionally add a custom domain

### Automated deploys via GitHub Actions

Add these secrets to your GitHub repo (Settings → Secrets):

- `CLOUDFLARE_API_TOKEN` — Create one at [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens) with "Cloudflare Pages: Edit" permission
- `CLOUDFLARE_ACCOUNT_ID` — Found on your Cloudflare dashboard

The action runs every 6 hours, on push to main, or manually via workflow_dispatch.

## Customisation

Edit the config block at the top of `build.js`:

```js
const SITE_TITLE = 'Tomás B.';
const SITE_SUBTITLE = 'Fiction';
```

## Architecture

Zero JavaScript on the reader's end. The sidebar navigation, two sort orders (karma and date), and mobile hamburger menu all work with pure HTML + CSS. Google Fonts are the only external dependency; if those are blocked, the site falls back to Georgia/serif.
