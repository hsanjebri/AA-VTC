// Cloudflare Worker entry.
// Static files are served from public/ by the assets binding; /api/* runs the handlers in api/,
// which keep their Node-style (req, res) signature through the small adapter below.
import fare from './api/fare.js';
import booking from './api/booking.js';
import adminAuth from './api/admin/auth.js';
import adminBookings from './api/admin/bookings.js';
import adminClients from './api/admin/clients.js';
import adminDevis from './api/admin/devis.js';
import adminStats from './api/admin/stats.js';
import adminSignature from './api/admin/signature.js';

const ROUTES = {
  '/api/fare': fare,
  '/api/booking': booking,
  '/api/admin/auth': adminAuth,
  '/api/admin/bookings': adminBookings,
  '/api/admin/clients': adminClients,
  '/api/admin/devis': adminDevis,
  '/api/admin/stats': adminStats,
  '/api/admin/signature': adminSignature,
};

// Sent on every response. The site loads no third-party scripts: everything is same-origin,
// except Google Fonts (styles) and Unsplash/IGN images and API calls.
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=(), usb=(), interest-cohort=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "script-src 'self' 'unsafe-inline'",            // one small inline bootstrap in index.html
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://images.unsplash.com https://data.geopf.fr",
    "connect-src 'self' https://data.geopf.fr",
    "worker-src 'self' blob:",
    'upgrade-insecure-requests',
  ].join('; '),
};

/** Minimal Node-ish req/res so the existing handlers run unchanged. */
async function runHandler(handler, request, url) {
  const headers = Object.fromEntries(request.headers);
  const contentType = headers['content-type'] || '';
  let body = '';
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    body = await request.text();
    if (contentType.includes('json') && body) {
      try { body = JSON.parse(body); } catch { /* handlers re-check and answer 400 */ }
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
    setHeader(name, value) {
      if (Array.isArray(value)) value.forEach((v) => outHeaders.append(name, v));
      else outHeaders.set(name, value);
      return res;
    },
    getHeader: (name) => outHeaders.get(name),
    json(data) {
      outHeaders.set('Content-Type', 'application/json; charset=utf-8');
      payload = JSON.stringify(data);
      settle();
      return res;
    },
    end(data) {
      payload = data ?? null;
      settle();
      return res;
    },
  };

  await Promise.race([Promise.resolve(handler(req, res)).then(() => finished), finished]);
  return new Response(payload, { status: statusCode, headers: outHeaders });
}

export default {
  async fetch(request, env, ctx) {
    // Handlers read configuration through process.env; Workers pass it in `env`.
    globalThis.process ??= { env: {} };
    globalThis.process.env = { ...globalThis.process.env, ...env };

    const url = new URL(request.url);
    const handler = ROUTES[url.pathname.replace(/\/$/, '')];

    let response;
    if (handler) {
      try {
        response = await runHandler(handler, request, url);
      } catch (err) {
        console.error('[worker]', url.pathname, err?.message);
        response = new Response(JSON.stringify({ error: 'server_error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }
    } else if (url.pathname.startsWith('/api/')) {
      response = new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    } else {
      response = await env.ASSETS.fetch(request);
    }

    response = new Response(response.body, response);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
    if (url.pathname.startsWith('/admin') || url.pathname.startsWith('/api/')) {
      response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    }
    return response;
  },
};
