// /api/admin/clients — GET list with booking history · PATCH edit · DELETE remove
import { sql } from '../_lib/db.js';
import { isAllowedOrigin, requireAdmin } from '../_lib/auth.js';

const text = (value, max = 300) => {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/\s+/g, ' ').slice(0, max);
  return clean || null;
};

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
      const q = text(url.searchParams.get('q'), 80);
      const rows = await sql`
        SELECT c.*,
               COUNT(b.id) FILTER (WHERE b.status <> 'annule')::int AS bookings_count,
               COALESCE(SUM(b.price_ht) FILTER (WHERE b.status <> 'annule'), 0)::float AS revenue_ht,
               MAX(COALESCE(b.pickup_at, b.created_at)) AS last_booking
        FROM clients c
        LEFT JOIN bookings b ON b.client_id = c.id
        WHERE (${q}::text IS NULL OR c.name ILIKE ${'%' + (q || '') + '%'}
               OR c.phone ILIKE ${'%' + (q || '') + '%'} OR c.email ILIKE ${'%' + (q || '') + '%'})
        GROUP BY c.id
        ORDER BY last_booking DESC NULLS LAST
        LIMIT 300`;
      return res.status(200).json({ clients: rows });
    }

    if (req.method === 'PATCH') {
      const id = Number(body?.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_input' });
      const existing = (await sql`SELECT * FROM clients WHERE id = ${id}`)[0];
      if (!existing) return res.status(404).json({ error: 'not_found' });
      const rows = await sql`
        UPDATE clients SET
          name  = ${'name' in (body || {}) ? text(body.name, 120) || existing.name : existing.name},
          phone = ${'phone' in (body || {}) ? text(body.phone, 40) : existing.phone},
          email = ${'email' in (body || {}) ? text(body.email, 160) : existing.email},
          notes = ${'notes' in (body || {}) ? text(body.notes, 1000) : existing.notes}
        WHERE id = ${id}
        RETURNING *`;
      return res.status(200).json({ client: rows[0] });
    }

    if (req.method === 'DELETE') {
      const id = Number(body?.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_input' });
      await sql`DELETE FROM clients WHERE id = ${id}`;
      return res.status(200).json({ deleted: id });
    }

    res.setHeader('Allow', 'GET, PATCH, DELETE');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error('[admin/clients] failed:', err.message);
    return res.status(500).json({ error: 'server_error' });
  }
}
