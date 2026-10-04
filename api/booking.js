// POST /api/booking — records a booking request coming from the public site.
// The visitor still continues to WhatsApp; this only keeps a trace for the dashboard.
import { sql, nextRef } from './_lib/db.js';
import { clientIp, isAllowedOrigin } from './_lib/auth.js';

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 10;
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

const text = (value, max = 300) => {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/\s+/g, ' ').slice(0, max);
  return clean || null;
};
const num = (value, max) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (!isAllowedOrigin(req)) return res.status(403).json({ error: 'forbidden' });
  if (rateLimited(clientIp(req))) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'rate_limited' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'invalid_input' });

  const pickup = text(body.pickup);
  const dropoff = text(body.dropoff);
  const service = ['transfert', 'mise_a_disposition', 'circuit'].includes(body.service) ? body.service : 'transfert';
  if (service === 'transfert' ? !(pickup && dropoff) : !(pickup || dropoff)) {
    return res.status(400).json({ error: 'invalid_input' });
  }

  const name = text(body.name, 120);
  const phone = text(body.phone, 40);
  const email = text(body.email, 160);

  try {
    let clientId = null;
    if (name || phone) {
      const rows = phone
        ? await sql`
            INSERT INTO clients (name, phone, email) VALUES (${name || phone}, ${phone}, ${email})
            ON CONFLICT (phone) WHERE phone IS NOT NULL DO UPDATE SET
              name = COALESCE(EXCLUDED.name, clients.name),
              email = COALESCE(EXCLUDED.email, clients.email)
            RETURNING id`
        : await sql`INSERT INTO clients (name, email) VALUES (${name}, ${email}) RETURNING id`;
      clientId = rows[0].id;
    }

    const ref = await nextRef('AA');
    const rows = await sql`
      INSERT INTO bookings (ref, service, client_id, pickup, dropoff, pickup_at, passengers,
                            round_trip, distance_km, duration_min, price_ht, vat_rate, notes, source)
      VALUES (${ref}, ${service}, ${clientId}, ${pickup}, ${dropoff},
              ${body.pickupAt ? new Date(body.pickupAt).toISOString() : null},
              ${num(body.passengers, 16)}, ${body.roundTrip === true},
              ${num(body.distanceKm, 5000)}, ${num(body.durationMin, 100000)},
              ${num(body.priceHt, 100000)}, ${num(body.vatRate, 100)},
              ${text(body.notes, 1000)}, 'site')
      RETURNING ref, created_at`;

    return res.status(201).json({ ref: rows[0].ref });
  } catch (err) {
    console.error('[booking] failed:', err.message);
    return res.status(500).json({ error: 'server_error' });
  }
}
