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
