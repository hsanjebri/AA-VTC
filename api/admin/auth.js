// /api/admin/auth — GET: session state + public KDF params · POST: login · DELETE: logout
import {
  clientIp, createSession, getSession, isAllowedOrigin, isHttps, kdfParams, loginThrottled, sessionCookie, verifyProof,
} from '../_lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const secure = isHttps(req);

  if (req.method === 'GET') {
    const session = getSession(req);
    return res.status(200).json({ signedIn: Boolean(session), email: session?.email || null, kdf: kdfParams() });
  }

  if (!isAllowedOrigin(req)) return res.status(403).json({ error: 'forbidden' });

  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', sessionCookie('', { clear: true, secure }));
    return res.status(200).json({ signedIn: false });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const expectedEmail = process.env.ADMIN_EMAIL;
  const expectedHash = process.env.ADMIN_PASSWORD_HASH;
  if (!expectedEmail || !kdfParams() || !process.env.SESSION_SECRET) return res.status(503).json({ error: 'not_configured' });

  if (loginThrottled(clientIp(req))) {
    res.setHeader('Retry-After', '600');
    return res.status(429).json({ error: 'rate_limited' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const email = String(body?.email || '').trim().toLowerCase();

  // Same generic answer whether the email or the password is wrong.
  const ok = email === expectedEmail.trim().toLowerCase() && verifyProof(body?.proof, expectedHash);
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

  res.setHeader('Set-Cookie', sessionCookie(createSession(email), { secure }));
  return res.status(200).json({ signedIn: true, email });
}
