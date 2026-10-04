// /api/admin/bookings — GET list (filters) · POST create · PATCH update · DELETE remove
import { sql, nextRef } from '../_lib/db.js';
import { isAllowedOrigin, requireAdmin } from '../_lib/auth.js';

const STATUSES = ['nouveau', 'confirme', 'termine', 'annule'];
const SERVICES = ['transfert', 'mise_a_disposition', 'circuit'];

const text = (value, max = 300) => {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/\s+/g, ' ').slice(0, max);
  return clean || null;
};
const num = (value, max) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
};
const when = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

async function upsertClient({ name, phone, email, notes }) {
  const cleanName = text(name, 120);
  const cleanPhone = text(phone, 40);
  if (!cleanName && !cleanPhone) return null;
  const rows = cleanPhone
    ? await sql`
        INSERT INTO clients (name, phone, email, notes) VALUES (${cleanName || cleanPhone}, ${cleanPhone}, ${text(email, 160)}, ${text(notes, 500)})
        ON CONFLICT (phone) WHERE phone IS NOT NULL DO UPDATE SET
          name = COALESCE(EXCLUDED.name, clients.name),
          email = COALESCE(EXCLUDED.email, clients.email),
          notes = COALESCE(EXCLUDED.notes, clients.notes)
        RETURNING id`
    : await sql`INSERT INTO clients (name, email, notes) VALUES (${cleanName}, ${text(email, 160)}, ${text(notes, 500)}) RETURNING id`;
  return rows[0].id;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'GET' && !isAllowedOrigin(req)) return res.status(403).json({ error: 'forbidden' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }

  try {
    if (req.method === 'GET') {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const status = url.searchParams.get('status');
      const from = when(url.searchParams.get('from'));
      const to = when(url.searchParams.get('to'));
      const q = text(url.searchParams.get('q'), 80);
      const limit = Math.min(Number(url.searchParams.get('limit')) || 200, 500);

      const rows = await sql`
        SELECT b.*, c.name AS client_name, c.phone AS client_phone, c.email AS client_email
        FROM bookings b
        LEFT JOIN clients c ON c.id = b.client_id
        WHERE (${status}::text IS NULL OR b.status = ${status})
          AND (${from}::timestamptz IS NULL OR COALESCE(b.pickup_at, b.created_at) >= ${from})
          AND (${to}::timestamptz IS NULL OR COALESCE(b.pickup_at, b.created_at) <= ${to})
          AND (${q}::text IS NULL OR b.ref ILIKE ${'%' + (q || '') + '%'}
               OR b.pickup ILIKE ${'%' + (q || '') + '%'} OR b.dropoff ILIKE ${'%' + (q || '') + '%'}
               OR c.name ILIKE ${'%' + (q || '') + '%'} OR c.phone ILIKE ${'%' + (q || '') + '%'})
        ORDER BY COALESCE(b.pickup_at, b.created_at) DESC
        LIMIT ${limit}`;
      return res.status(200).json({ bookings: rows });
    }

    if (req.method === 'POST') {
      const clientId = await upsertClient(body || {});
      const ref = await nextRef('AA');
      const rows = await sql`
        INSERT INTO bookings (ref, status, service, client_id, pickup, dropoff, pickup_at, passengers,
                              round_trip, distance_km, duration_min, price_ht, vat_rate, notes, source)
        VALUES (${ref},
                ${STATUSES.includes(body?.status) ? body.status : 'confirme'},
                ${SERVICES.includes(body?.service) ? body.service : 'transfert'},
                ${clientId}, ${text(body?.pickup)}, ${text(body?.dropoff)}, ${when(body?.pickupAt)},
                ${num(body?.passengers, 16)}, ${body?.roundTrip === true},
                ${num(body?.distanceKm, 5000)}, ${num(body?.durationMin, 100000)},
                ${num(body?.priceHt, 100000)}, ${num(body?.vatRate, 100)},
                ${text(body?.notes, 1000)}, 'admin')
        RETURNING *`;
      return res.status(201).json({ booking: rows[0] });
    }

    if (req.method === 'PATCH') {
      const id = Number(body?.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_input' });

      const existing = (await sql`SELECT * FROM bookings WHERE id = ${id}`)[0];
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const clientId = (body?.name || body?.phone) ? await upsertClient(body) : existing.client_id;
      const pick = (key, fallback) => (key in (body || {}) ? body[key] : fallback);

      const rows = await sql`
        UPDATE bookings SET
          status       = ${STATUSES.includes(body?.status) ? body.status : existing.status},
          service      = ${SERVICES.includes(body?.service) ? body.service : existing.service},
          client_id    = ${clientId},
          pickup       = ${'pickup' in (body || {}) ? text(body.pickup) : existing.pickup},
          dropoff      = ${'dropoff' in (body || {}) ? text(body.dropoff) : existing.dropoff},
          pickup_at    = ${'pickupAt' in (body || {}) ? when(body.pickupAt) : existing.pickup_at},
          passengers   = ${'passengers' in (body || {}) ? num(body.passengers, 16) : existing.passengers},
          round_trip   = ${'roundTrip' in (body || {}) ? body.roundTrip === true : existing.round_trip},
          distance_km  = ${'distanceKm' in (body || {}) ? num(body.distanceKm, 5000) : existing.distance_km},
          duration_min = ${'durationMin' in (body || {}) ? num(body.durationMin, 100000) : existing.duration_min},
          price_ht     = ${'priceHt' in (body || {}) ? num(body.priceHt, 100000) : existing.price_ht},
          vat_rate     = ${'vatRate' in (body || {}) ? num(body.vatRate, 100) : existing.vat_rate},
          notes        = ${'notes' in (body || {}) ? text(body.notes, 1000) : existing.notes},
          updated_at   = now()
        WHERE id = ${id}
        RETURNING *`;
      return res.status(200).json({ booking: rows[0] });
    }

    if (req.method === 'DELETE') {
      const id = Number(body?.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_input' });
      await sql`DELETE FROM bookings WHERE id = ${id}`;
      return res.status(200).json({ deleted: id });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error('[admin/bookings] failed:', err.message);
    return res.status(500).json({ error: 'server_error' });
  }
}
