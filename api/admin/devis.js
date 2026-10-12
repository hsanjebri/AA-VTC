// /api/admin/devis — GET list or ?id=N (devis + company identity for the PDF) · POST create · DELETE remove
// The PDF itself is built in the admin's browser (public/admin/pdf.js): it would exceed the
// Workers free-plan CPU budget server-side.
import { sql, nextRef } from '../_lib/db.js';
import { isAllowedOrigin, requireAdmin } from '../_lib/auth.js';

/** Company identity printed on the devis — from env vars, nothing invented when they are missing. */
const company = () => ({
  name: process.env.COMPANY_NAME || 'AA-VTC',
  address: process.env.COMPANY_ADDRESS || null,
  siret: process.env.COMPANY_SIRET || null,
  vtc: process.env.COMPANY_VTC || null,
  tva: process.env.COMPANY_TVA || null,
  signer: process.env.COMPANY_SIGNER || null,
  phone: process.env.COMPANY_PHONE || '+33 6 52 80 74 88',
  email: process.env.COMPANY_EMAIL || 'contact@aa-vtc.fr',
  site: process.env.COMPANY_SITE || 'aa-vtc.fr',
});

const text = (value, max = 300) => {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/\s+/g, ' ').slice(0, max);
  return clean || null;
};
const round2 = (n) => Math.round(n * 100) / 100;

function parseLines(input) {
  if (!Array.isArray(input) || !input.length) return null;
  const lines = input.slice(0, 20).map((line) => {
    const label = text(line?.label, 120);
    const qty = Number(line?.qty);
    const unitHt = Number(line?.unitHt);
    if (!label || !Number.isFinite(qty) || qty <= 0 || qty > 1000 || !Number.isFinite(unitHt) || unitHt < 0 || unitHt > 100000) return null;
    return { label, qty: round2(qty), unitHt: round2(unitHt), totalHt: round2(qty * unitHt) };
  });
  return lines.includes(null) ? null : lines;
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
      const id = Number(url.searchParams.get('id'));

      if (Number.isInteger(id) && id > 0) {
        const rows = await sql`
          SELECT d.*, c.name AS client_name, c.phone AS client_phone, c.email AS client_email
          FROM devis d LEFT JOIN clients c ON c.id = d.client_id WHERE d.id = ${id}`;
        if (!rows.length) return res.status(404).json({ error: 'not_found' });
        return res.status(200).json({ devis: rows[0], company: company() });
      }

      const rows = await sql`
        SELECT d.*, c.name AS client_name, c.phone AS client_phone
        FROM devis d LEFT JOIN clients c ON c.id = d.client_id
        ORDER BY d.created_at DESC LIMIT 200`;
      return res.status(200).json({ devis: rows });
    }

    if (req.method === 'POST') {
      const lines = parseLines(body?.lines);
      if (!lines) return res.status(400).json({ error: 'invalid_lines' });

      const vatRate = Number(body?.vatRate);
      if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) return res.status(400).json({ error: 'invalid_input' });

      let clientId = Number.isInteger(Number(body?.clientId)) && Number(body.clientId) > 0 ? Number(body.clientId) : null;
      if (!clientId && (body?.name || body?.phone)) {
        const name = text(body.name, 120);
        const phone = text(body.phone, 40);
        const rows = phone
          ? await sql`
              INSERT INTO clients (name, phone, email) VALUES (${name || phone}, ${phone}, ${text(body.email, 160)})
              ON CONFLICT (phone) WHERE phone IS NOT NULL DO UPDATE SET name = COALESCE(EXCLUDED.name, clients.name)
              RETURNING id`
          : await sql`INSERT INTO clients (name, email) VALUES (${name}, ${text(body.email, 160)}) RETURNING id`;
        clientId = rows[0].id;
      }

      const totalHt = round2(lines.reduce((sum, l) => sum + l.totalHt, 0));
      const totalTtc = round2(totalHt * (1 + vatRate / 100));
      const number = await nextRef('DV');
      const validUntil = body?.validUntil ? new Date(body.validUntil) : new Date(Date.now() + 30 * 86400000);

      const rows = await sql`
        INSERT INTO devis (number, booking_id, client_id, lines, total_ht, vat_rate, total_ttc, valid_until, notes)
        VALUES (${number},
                ${Number.isInteger(Number(body?.bookingId)) && Number(body.bookingId) > 0 ? Number(body.bookingId) : null},
                ${clientId}, ${JSON.stringify(lines)}, ${totalHt}, ${vatRate}, ${totalTtc},
                ${validUntil.toISOString().slice(0, 10)}, ${text(body?.notes, 1000)})
        RETURNING *`;
      return res.status(201).json({ devis: rows[0] });
    }

    if (req.method === 'DELETE') {
      const id = Number(body?.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_input' });
      await sql`DELETE FROM devis WHERE id = ${id}`;
      return res.status(200).json({ deleted: id });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error('[admin/devis] failed:', err.message);
    return res.status(500).json({ error: 'server_error' });
  }
}
