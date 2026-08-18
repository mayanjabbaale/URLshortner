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
