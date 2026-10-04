// Admin authentication: one account, password hash in an env var, signed HttpOnly session cookie.
// No secret is ever sent to the browser — the cookie only carries "who + until + signature".
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const COOKIE = 'aa_admin';
const SESSION_HOURS = 12;
const LOGIN_WINDOW_MS = 10 * 60_000;
const LOGIN_MAX_ATTEMPTS = Number(process.env.ADMIN_LOGIN_MAX_ATTEMPTS) || 8;
const attempts = new Map();

/** Hash for ADMIN_PASSWORD_HASH: scrypt, stored as "salt:hash" (hex). */
export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 16) throw new Error('SESSION_SECRET missing (min 16 chars)');
  return value;
}

const sign = (payload) => createHmac('sha256', secret()).update(payload).digest('base64url');

export function createSession(email) {
  const payload = Buffer.from(JSON.stringify({ email, exp: Date.now() + SESSION_HOURS * 3600_000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function readSession(token) {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

export function sessionCookie(token, { clear = false } = {}) {
  const parts = [
    `${COOKIE}=${clear ? '' : token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    clear ? 'Max-Age=0' : `Max-Age=${SESSION_HOURS * 3600}`,
  ];
  if (process.env.VERCEL) parts.push('Secure');
  return parts.join('; ');
}

export function getSession(req) {
  const raw = req.headers.cookie || '';
  const match = raw.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE}=`));
  return match ? readSession(match.slice(COOKIE.length + 1)) : null;
}

/** Guard for admin endpoints: returns the session, or answers 401 and returns null. */
export function requireAdmin(req, res) {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  return session;
}

export function loginThrottled(ip) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now - entry.start > LOGIN_WINDOW_MS) {
    if (attempts.size > 2000) attempts.clear();
    attempts.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > LOGIN_MAX_ATTEMPTS;
}

export const clientIp = (req) =>
  String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();

/** Same-site check, shared by the public and admin endpoints. */
export function isAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (host && (origin === `https://${host}` || origin === `http://${host}`)) return true;
  const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return allowed.includes(origin);
}
