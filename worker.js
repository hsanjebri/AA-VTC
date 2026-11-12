// Cloudflare Worker entry.
// public/ is served as static assets; the only server endpoint is /api/fare (tariff estimate).
import fare from './api/fare.js';

const ROUTES = { '/api/fare': fare };

const CANONICAL_HOST = 'ej-vtc.fr';
// The former domain keeps working: every address 301s to the canonical one, so
// links, bookmarks and the ranking earned on aa-vtc.fr follow the new name.
const REDIRECT_HOSTS = new Set([
  'www.ej-vtc.fr',
  'ej-vtc.com',
  'www.ej-vtc.com',
  'aa-vtc.fr',
  'www.aa-vtc.fr',
  'aa-vtc.com',
  'www.aa-vtc.com',
]);

// The site loads no third-party scripts; styles/fonts come from Google Fonts,
// photos from Unsplash, maps and routing from IGN. Cloudflare injects its cookieless beacon.
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=(), usb=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://images.unsplash.com https://data.geopf.fr",
    "connect-src 'self' https://data.geopf.fr https://cloudflareinsights.com",
    'upgrade-insecure-requests',
  ].join('; '),
};

/** Minimal Node-ish req/res so the handler keeps its (req, res) shape. */
async function runHandler(handler, request, url) {
  const headers = Object.fromEntries(request.headers);
  let body = '';
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    body = await request.text();
    if ((headers['content-type'] || '').includes('json') && body) {
      try { body = JSON.parse(body); } catch { /* the handler answers 400 */ }
    }
  }

  const req = {
    method: request.method,
    url: url.pathname + url.search,
    headers,
    body,
    socket: { remoteAddress: headers['cf-connecting-ip'] || '' },
  };

  const outHeaders = new Headers();
  let statusCode = 200;
  let payload = null;
  let settle;
  const finished = new Promise((resolve) => { settle = resolve; });

  const res = {
    status(code) { statusCode = code; return res; },
    setHeader(name, value) { outHeaders.set(name, value); return res; },
    getHeader: (name) => outHeaders.get(name),
    json(data) {
      outHeaders.set('Content-Type', 'application/json; charset=utf-8');
      payload = JSON.stringify(data);
      settle();
      return res;
    },
    end(data) { payload = data ?? null; settle(); return res; },
  };

  await Promise.race([Promise.resolve(handler(req, res)).then(() => finished), finished]);
  return new Response(payload, { status: statusCode, headers: outHeaders });
}

export default {
  async fetch(request, env) {
    globalThis.process ??= { env: {} };
    globalThis.process.env = { ...globalThis.process.env, ...env };

    const url = new URL(request.url);

    // One canonical address: https://ej-vtc.fr
    const wrongHost = REDIRECT_HOSTS.has(url.hostname);
    const insecure = url.protocol === 'http:' || request.headers.get('cf-visitor')?.includes('"http"');
    if (wrongHost || insecure) {
      const target = new URL(url);
      if (wrongHost) target.hostname = CANONICAL_HOST;
      target.protocol = 'https:';
      target.port = '';
      return Response.redirect(target.toString(), 301);
    }

    const handler = ROUTES[url.pathname.replace(/\/$/, '')];
    let response;
    if (handler) {
      // Edge-wide limit: Cloudflare counts per key across every isolate.
      const ip = request.headers.get('cf-connecting-ip') || 'unknown';
      let allowed = true;
      if (env.FARE_LIMIT) {
        try {
          allowed = (await env.FARE_LIMIT.limit({ key: ip })).success;
        } catch (err) {
          console.error('[worker] rate limit', err?.message); // fail open: never block real visitors
        }
      }
      if (!allowed) {
        return new Response(JSON.stringify({ error: 'rate_limited' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': '60' },
        });
      }
      try {
        response = await runHandler(handler, request, url);
      } catch (err) {
        console.error('[worker]', url.pathname, err?.message);
        response = Response.json({ error: 'server_error' }, { status: 500 });
      }
    } else if (url.pathname.startsWith('/api/')) {
      response = Response.json({ error: 'not_found' }, { status: 404 });
    } else {
      response = await env.ASSETS.fetch(request);
    }

    response = new Response(response.body, response);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
    return response;
  },
};
