// /api/admin/stats — counts, revenue and top routes for the dashboard.
import { sql } from '../_lib/db.js';
import { requireAdmin } from '../_lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const months = Math.min(Math.max(Number(url.searchParams.get('months')) || 12, 1), 36);

    const [byStatus, totals, byMonth, topRoutes, clients, upcoming] = await Promise.all([
      sql`SELECT status, COUNT(*)::int AS count FROM bookings GROUP BY status`,
      sql`
        SELECT COUNT(*)::int AS bookings,
               COALESCE(SUM(price_ht), 0)::float AS revenue_ht,
               COALESCE(SUM(CASE WHEN status = 'termine' THEN price_ht ELSE 0 END), 0)::float AS revenue_done_ht,
               COALESCE(AVG(price_ht), 0)::float AS average_ht
        FROM bookings WHERE status <> 'annule'`,
      sql`
        SELECT to_char(date_trunc('month', COALESCE(pickup_at, created_at)), 'YYYY-MM') AS month,
               COUNT(*)::int AS bookings,
               COALESCE(SUM(price_ht), 0)::float AS revenue_ht
        FROM bookings
        WHERE status <> 'annule'
          AND COALESCE(pickup_at, created_at) >= date_trunc('month', now()) - (${months - 1} || ' months')::interval
        GROUP BY 1 ORDER BY 1`,
      sql`
        SELECT pickup, dropoff, COUNT(*)::int AS count, COALESCE(SUM(price_ht), 0)::float AS revenue_ht
        FROM bookings
        WHERE status <> 'annule' AND pickup IS NOT NULL AND dropoff IS NOT NULL
        GROUP BY pickup, dropoff ORDER BY count DESC, revenue_ht DESC LIMIT 8`,
      sql`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE bookings_count > 1)::int AS repeat_clients
        FROM (SELECT c.id, COUNT(b.id)::int AS bookings_count
              FROM clients c LEFT JOIN bookings b ON b.client_id = c.id
              GROUP BY c.id) t`,
      sql`
        SELECT COUNT(*)::int AS count
        FROM bookings
        WHERE status IN ('nouveau', 'confirme') AND pickup_at >= now()`,
    ]);

    return res.status(200).json({
      byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.count])),
      totals: totals[0],
      byMonth,
      topRoutes,
      clients: clients[0],
      upcoming: upcoming[0].count,
    });
  } catch (err) {
    console.error('[admin/stats] failed:', err.message);
    return res.status(500).json({ error: 'server_error' });
  }
}
