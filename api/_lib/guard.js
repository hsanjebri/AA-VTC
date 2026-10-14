// Abuse protection for the public API: same-site check + per-IP and global rate limits.
// Cloudflare absorbs network-level floods; this layer protects the upstream IGN services
// from scripted abuse that gets past the edge.

const WINDOW_MS = 60_000;
const PER_IP_MAX = 15;      // estimates per minute per visitor
const GLOBAL_MAX = 300;     // estimates per minute per Worker isolate (safety net)

const hits = new Map();
let globalWindowStart = 0;
let globalCount = 0;

export const clientIp = (req) =>
  String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
    .split(',')[0].trim();

/** Returns null when allowed, or an error code to answer with 429. */
export function rateLimit(ip) {
  const now = Date.now();

  if (now - globalWindowStart > WINDOW_MS) {
    globalWindowStart = now;
    globalCount = 0;
  }
  if (++globalCount > GLOBAL_MAX) return 'busy';

  const entry = hits.get(ip);
  if (!entry || now - entry.start > WINDOW_MS) {
    if (hits.size > 5000) hits.clear();
    hits.set(ip, { start: now, count: 1 });
    return null;
  }
  entry.count += 1;
  return entry.count > PER_IP_MAX ? 'rate_limited' : null;
}

/** The API is only for this site: browsers always send Origin on POST. */
export function isAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (host && (origin === `https://${host}` || origin === `http://${host}`)) return true;
  const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return allowed.includes(origin);
}

// Matched as prefixes, not whole words: "PostmanRuntime/7.36" and "Python-urllib/3.11"
// both slip past a trailing \b. No browser User-Agent contains any of these.
const AUTOMATED_UA = /\b(curl|wget|python|httpie|scrapy|libwww|java|go-http|okhttp|postman|insomnia|restsharp|httpclient|guzzle|axios|node-fetch|headlesschrome|phantomjs)/;

/** Obvious scripted clients: no browser sends these. Real crawlers never POST here. */
export function looksAutomated(req) {
  const ua = String(req.headers['user-agent'] || '').toLowerCase();
  if (!ua) return true;
  return AUTOMATED_UA.test(ua);
}
