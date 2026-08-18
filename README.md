# URL Shortener

Zero-cost URL shortener + referrer masker for affiliate links. Runs on Vercel + Upstash free tiers.

Try it out - https://surge-daily.vercel.app/

## What it does

- Shortens long URLs into `https://<host>/go/<slug>` (or `/recommend/<slug>`)
- Serves a meta-refresh + JS HTML landing instead of `301/302` so affiliate networks can't see the originating page
- Drops known bots (`googlebot`, `bingbot`, `facebookexternalhit`, etc.) with an empty `204`
- Passes through any query params appended to the short URL onto the destination
- Caches the redirect HTML at the edge for 5 minutes (`stale-while-revalidate=60`)

## Stack

- **Runtime:** Vercel Serverless Functions (Node.js, ESM)
- **Database:** Upstash Redis (free tier)
- **Frontend:** Static HTML/CSS/JS in `public/`

## Project layout

```
api/
  shorten.js     POST /api/shorten → registers a slug
  [id].js        /go/:id, /recommend/:id → masked redirect
public/
  index.html     Shortener UI (served at /)
  home.html      Surge Daily landing (served at /home)
vercel.json      Rewrites
package.json     @upstash/redis + nanoid
.env             Upstash creds (gitignored)
.env.example     Template — copy to .env and fill in
```

## Setup

1. Create a free Upstash Redis database: https://console.upstash.com
2. Copy `.env.example` → `.env` and paste your `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
3. `npm install`

## Deploy

1. Push to GitHub
2. Import the repo in Vercel (https://vercel.com → Add New → Project)
3. Add the two `UPSTASH_*` env vars in **Project Settings → Environment Variables**
4. Deploy. Vercel auto-serves `public/*` and `api/*`.

## API

### `POST /api/shorten`

Body:
```json
{ "url": "https://destination.example.com", "customSlug": "myproduct" }
```
- `url` — required, must be an absolute URL
- `customSlug` — optional. Omit to auto-generate a 6-char nanoid.

Returns `201`:
```json
{ "slug": "myproduct", "targetUrl": "https://destination.example.com", "shortUrl": "https://<host>/go/myproduct" }
```

Errors: `400` (bad URL/slug), `405` (not POST), `409` (slug taken), `500` (DB).

### `GET /go/:slug` or `/recommend/:slug`

Returns a meta-refresh HTML page that redirects to the stored destination, with any query params appended. Bots get `204`. Missing slugs get `404`.

## Notes

- `.env` is in `.gitignore`. Never commit it.
- The Upstash free tier is 10,000 commands/day. The 5-minute edge cache keeps usage well under that.
