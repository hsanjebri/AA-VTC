// /api/admin/signature — the signature image, for signed-in admins only (used to build devis PDFs in the browser).
import { requireAdmin } from '../_lib/auth.js';
import { SIGNATURE_PNG_BASE64 } from '../_lib/signature-data.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  res.setHeader('Content-Type', 'image/png');
  return res.status(200).end(Buffer.from(SIGNATURE_PNG_BASE64, 'base64'));
}
