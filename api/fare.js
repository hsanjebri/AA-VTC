// POST /api/fare — road distance via IGN Géoplateforme (free, no API key), priced with api/_lib/pricing.js.
import { quote } from './_lib/pricing.js';
import { findKnownPlace, kmBetween, rankScore } from '../places.js';

const GEOCODE_URL = 'https://data.geopf.fr/geocodage/search';
const ROUTE_URL = 'https://data.geopf.fr/navigation/itineraire';
const TIMEOUT_MS = 10000;
// IGN snaps start/end to the nearest routable road. If that road is far away (sea, abroad), the price would be wrong.
const MAX_SNAP_KM = 3;

// Best-effort, per-instance rate limit to stay a fair user of the public IGN services.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 20;
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now - entry.start > RATE_WINDOW_MS) {
    if (hits.size > 5000) hits.clear();
    hits.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_MAX;
}

function isAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false; // browsers always send Origin on POST
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (host && (origin === `https://${host}` || origin === `http://${host}`)) return true;
  const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return allowed.includes(origin);
}

function toWaypoint(input) {
  if (!input || typeof input !== 'object') return null;
  const { lat, lng } = input;
  if (typeof lat === 'number' && typeof lng === 'number' && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    return { lat, lng };
  }
  if (typeof input.address === 'string') {
    const address = input.address.trim().replace(/\s+/g, ' ');
    if (address.length >= 3 && address.length <= 300) return { address };
  }
  return null;
}

async function getJson(url, signal) {
  const res = await fetch(url, { signal, headers: { accept: 'application/json' } });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

async function resolvePoint(waypoint, signal) {
  if (!waypoint.address) return waypoint;
  const known = findKnownPlace(waypoint.address);
  if (known) return { lat: known.lat, lng: known.lng };

  const params = new URLSearchParams({ q: waypoint.address, index: 'address,poi', limit: '10' });
  const { ok, status, data } = await getJson(`${GEOCODE_URL}?${params}`, signal);
  if (!ok) throw new Error(`geocode HTTP ${status}`);
  const best = (data?.features || [])
    .filter((f) => (f.properties?.score ?? 0) >= 0.3 && Array.isArray(f.geometry?.coordinates))
    .map((f) => {
      const [lng, lat] = f.geometry.coordinates;
      return { lat, lng, rank: rankScore(f.properties.score, { lat, lng }) };
    })
    .sort((a, b) => b.rank - a.rank)[0];
  return best ? { lat: best.lat, lng: best.lng } : null;
}

const parseLngLat = (value) => {
  const [lng, lat] = String(value || '').split(',').map(Number);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (!isAllowedOrigin(req)) return res.status(403).json({ error: 'forbidden' });

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  if (rateLimited(ip)) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'rate_limited' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const origin = toWaypoint(body?.origin);
  const destination = toWaypoint(body?.destination);
  if (!origin || !destination) return res.status(400).json({ error: 'invalid_input' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const [from, to] = await Promise.all([resolvePoint(origin, controller.signal), resolvePoint(destination, controller.signal)]);
    if (!from || !to) return res.status(422).json({ error: 'not_found' });

    const params = new URLSearchParams({
      resource: 'bdtopo-osrm',
      profile: 'car',
      optimization: 'fastest',
      start: `${from.lng},${from.lat}`,
      end: `${to.lng},${to.lat}`,
      distanceUnit: 'kilometer',
      timeUnit: 'second',
      geometryFormat: 'polyline',
      getSteps: 'false',
    });
    const { ok, status, data } = await getJson(`${ROUTE_URL}?${params}`, controller.signal);
    if (status === 400 || status === 404) return res.status(422).json({ error: 'no_route' });
    if (!ok) {
      console.error('[fare] IGN routing error', status, data?.error?.message);
      return res.status(502).json({ error: 'upstream' });
    }

    const snappedStart = parseLngLat(data.start);
    const snappedEnd = parseLngLat(data.end);
    const distanceKm = Number(data.distance);
    const durationSeconds = Number(data.duration);
    if (
      !snappedStart || !snappedEnd ||
      kmBetween(from, snappedStart) > MAX_SNAP_KM || kmBetween(to, snappedEnd) > MAX_SNAP_KM ||
      !(distanceKm > 0)
    ) {
      return res.status(422).json({ error: 'no_route' });
    }

    return res.status(200).json({
      ...quote({
        distanceMeters: distanceKm * 1000,
        durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : 0,
        roundTrip: body.roundTrip === true,
        from,
        to,
      }),
      // For the map: encoded polyline (precision 5) plus the two endpoints.
      route: typeof data.geometry === 'string' ? data.geometry : null,
      from,
      to,
    });
  } catch (err) {
    console.error('[fare] IGN request failed:', err.name, err.message);
    return res.status(502).json({ error: 'upstream' });
  } finally {
    clearTimeout(timer);
  }
}
