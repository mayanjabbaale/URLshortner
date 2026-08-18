# Product Specification: Zero-Cost Affiliate URL Shortener & Masker

## Project Overview
This project is a high-performance, production-grade URL shortener and referrer masker designed explicitly for affiliate marketing links. It runs entirely on free tiers, incurring zero hosting or database infrastructure costs. 

### Core Architectural Decisions
- **Hosting Platform:** Vercel (Free Hobby Tier).
- **Runtime Environment:** Vercel Serverless Functions (Node.js).
- **Database:** Upstash Redis (Free Tier - 10,000 commands/day).
- **Redirection Architecture:** Meta-Refresh + JS Fallback HTML landing pages (strips raw HTTP `Referer` data to protect traffic origins from ad networks and affiliate platforms).

---

## Technical Specifications & Features

### 1. Advanced Referrer Masking
To prevent target networks from flagging the precise page or origin driving traffic, the system rejects standard HTTP `301/302/307` server redirects. Instead, it serves a minimal `200 OK` HTML payload containing a `<meta http-equiv="refresh">` tag and a `window.location` JavaScript fallback.

### 2. Search Engine & Bot Filtering
The routing logic evaluates the `User-Agent` string. Active crawlers, bots, and spiders are dropped or served an empty payload to prevent useless automated traffic from polluting affiliate link click metrics or exhausting database query quotas.

### 3. Dynamic Query Parameter Pass-Through
Any tracking tags or URL parameters appended to the short link (e.g., `://yoursite.com`) must be dynamically appended onto the target destination link before the client-side redirect fires.

### 4. Edge Caching & Multi-Region Resiliency
To remain well within the Upstash free tier, the edge network caches valid redirection templates for 5 minutes (`Cache-Control: public, max-age=300`). Repeat hits to identical slugs fetch from the global Vercel CDN Edge rather than making downstream roundtrips to Redis.

---

## File System Blueprint

```text
vercel-shortener/
├── api/
│   ├── shorten.js      # Endpoint to create/register short links
│   └── [id].js         # Router, Bot Shield, and Masking Engine
├── package.json        # Manifest and dependencies
└── vercel.json         # Rewrites for clean, aesthetic URLs
```

---

## Code Implementation Files

### `package.json`
```json
{
  "name": "vercel-affiliate-shortener",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@upstash/redis": "^1.34.4",
    "nanoid": "^5.0.9"
  }
}
```

### `vercel.json`
```json
{
  "version": 2,
  "rewrites": [
    {
      "source": "/go/:id",
      "destination": "/api/[id]"
    },
    {
      "source": "/recommend/:id",
      "destination": "/api/[id]"
    }
  ]
}
```

### `api/shorten.js`
```javascript
import { Redis } from '@upstash/redis';
import { nanoid } from 'nanoid';

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  // Enforce POST requests for creating links
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const { url, customSlug } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'Destination url parameter is required.' });
  }

  try {
    // Validate target string format
    new URL(url);
  } catch (_) {
    return res.status(400).json({ error: 'Provided target is not a valid absolute URL.' });
  }

  // Use custom aesthetic slug if provided, otherwise fallback to a secure 6-character random ID
  const slug = customSlug ? customSlug.trim().toLowerCase() : nanoid(6);

  // Strip dangerous alphanumeric characters from slugs to maintain route integrity
  const cleanSlug = slug.replace(/[^a-zA-Z0-9-_]/g, '');

  if (!cleanSlug) {
    return res.status(400).json({ error: 'Invalid custom slug formatting.' });
  }

  try {
    // Check if the custom slug is already allocated
    const existing = await redis.get(cleanSlug);
    if (existing && customSlug) {
      return res.status(409).json({ error: 'This custom slug is already taken.' });
    }

    // Persist mapping to Redis store
    await redis.set(cleanSlug, url);

    const host = req.headers['host'];
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    
    return res.status(201).json({
      slug: cleanSlug,
      targetUrl: url,
      shortUrl: `${protocol}://${host}/go/${cleanSlug}`
    });
  } catch (dbError) {
    return res.status(500).json({ error: 'Database execution failure.', details: dbError.message });
  }
}
```

### `api/[id].js`
```javascript
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

// Blacklist containing prevalent search bots, scraping spiders, and scrapers
const BOT_USER_AGENTS = [
  'bot', 'crawler', 'spider', 'googlebot', 'bingbot', 'yandexbot', 
  'facebookexternalhit', 'twitterbot', 'linkedinbot', 'duckduckbot',
  'slurp', 'ia_archiver'
];

function isBot(userAgent) {
  if (!userAgent) return false;
  const uaLower = userAgent.toLowerCase();
  return BOT_USER_AGENTS.some(bot => uaLower.includes(bot));
}

export default async function handler(req, res) {
  const { id, ...queryParams } = req.query;
  const userAgent = req.headers['user-agent'];

  if (!id) {
    return res.status(400).send('Missing structural link ID parameters.');
  }

  try {
    // 1. Fetch destination mapping from cached database layer
    const destinationUrl = await redis.get(id);

    if (!destinationUrl) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(404).send('The requested short link mapping does not exist.');
    }

    // 2. Shield affiliate account cookies from automated bots
    if (isBot(userAgent)) {
      res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache negative response for 24h
      return res.status(204).end(); // Drop connection gracefully with zero body output
    }

    // 3. Re-serialize destination URL while retaining structural query components
    const parsedTarget = new URL(destinationUrl);
    Object.entries(queryParams).forEach(([key, value]) => {
      parsedTarget.searchParams.append(key, value);
    });
    const finalDestination = parsedTarget.toString();

    // 4. Formulate response headers with aggressive cache-control validation rules
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');

    // 5. Generate secure, raw referer-stripping client redirect document
    return res.status(200).send(`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="robots" content="noindex, nofollow">
          <meta http-equiv="refresh" content="0; url=${finalDestination}">
          <title>Redirecting safely...</title>
          <script type="text/javascript">
            window.location.replace("${finalDestination}");
          </script>
        </head>
        <body>
          <noscript>
            <p>If you are not redirected automatically, <a href="${finalDestination}" rel="noreferrer nofollow">click here to proceed</a>.</p>
          </noscript>
        </body>
      </html>
    `);
  } catch (error) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).send('Internal infrastructure error routing request.');
  }
}
```

---

## Comprehensive Step-by-Step Free Deployment Guide

Follow these exact operational procedures to guarantee zero-cost implementation across all infrastructure layers.

### Phase 1: Database Provisioning (Upstash)
1. Navigate to the [Upstash Console](https://upstash.com) and create a free account.
2. Select **Create Database**.
3. Set your database name (e.g., `affiliate-shortener`) and select your closest region group (e.g., US-East or EU-West).
4. Leave the primary database configuration set strictly to **Redis (Serverless)**. Ensure you select the **Free Tier**.
5. Once instantiated, scroll to the **REST API** configuration section on the dashboard tab.
6. Copy both the `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` values. Keep them safe.

### Phase 2: Source Code Storage Setup
1. Push your generated files (`package.json`, `vercel.json`, `api/shorten.js`, `api/[id].js`) to a private or public repository on [GitHub](https://github.com).

### Phase 3: Platform Infrastructure Cloud Deployment (Vercel)
1. Sign up or log into [Vercel](https://vercel.com) using your GitHub credentials (choosing the **Hobby / Free Plan**).
2. Click **Add New...** -> **Project**.
3. Import your code repository from your GitHub integrations panel.
4. Expand the **Environment Variables** configuration accordions inside the Vercel workspace.
5. Provide the key/value configurations captured from your Upstash console setup:
   - **Name:** `UPSTASH_REDIS_REST_URL` / **Value:** `[Your copied Upstash REST URL]`
   - **Name:** `UPSTASH_REDIS_REST_TOKEN` / **Value:** `[Your copied Upstash REST Token]`
6. Click the **Deploy** button. Vercel will build the runtime paths and output a public `.vercel.app` project production address.

---

## Verification & Execution Checks

### How to Register a New Affiliate Link
To programmatically shorten an address via an API platform tool (like cURL or Postman), execute a `POST` network string configuration payload:

```bash
curl -X POST https://vercel.app \
  -H "Content-Type: application/json" \
  -d '{"url": "https://partner-network.com", "customSlug": "myproduct"}'
```