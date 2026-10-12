// Admin authentication: one account, signed HttpOnly session cookie.
//
// Password check is split so the server stays inside Cloudflare's free CPU budget (10 ms):
//   browser:  proof = PBKDF2-SHA256(password, salt, 600 000 rounds)   (Web Crypto, ~0.5 s once per login)
//   server:   SHA-256(proof) === stored digest                          (~0.05 ms)
// ADMIN_PASSWORD_HASH = "v2$<iterations>$<salt base64url>$<sha256 hex of proof>"
// A leaked hash still costs an attacker 600 000 PBKDF2 rounds per guess, as with a server-side KDF.
// No secret is ever sent to the browser — the cookie only carries "who + until + signature".
import { createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

const COOKIE = 'aa_admin';
const SESSION_HOURS = 12;
const LOGIN_WINDOW_MS = 10 * 60_000;
const LOGIN_MAX_ATTEMPTS = Number(process.env.ADMIN_LOGIN_MAX_ATTEMPTS) || 8;
export const KDF_ITERATIONS = 600_000;
const attempts = new Map();

const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Used by scripts/hash-password.mjs (runs in Node, never in the Worker). */
export function hashPassword(password, salt = randomBytes(16).toString('base64url'), iterations = KDF_ITERATIONS) {
  const proof = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  return `v2$${iterations}$${salt}$${sha256Hex(proof)}`;
}

function parseStored(stored) {
  const [version, iterations, salt, digest] = String(stored || '').split('$');
  if (version !== 'v2' || !salt || !/^[0-9a-f]{64}$/.test(digest || '') || !(Number(iterations) > 0)) return null;
  return { iterations: Number(iterations), salt, digest };
}

/** Public KDF parameters the login page needs (salt and round count are not secrets). */
export function kdfParams() {
  const parsed = parseStored(process.env.ADMIN_PASSWORD_HASH);
  return parsed ? { salt: parsed.salt, iterations: parsed.iterations } : null;
}

/** proof: base64url of the 32-byte PBKDF2 output computed by the browser. */
export function verifyProof(proof, stored) {
  const parsed = parseStored(stored);
  if (!parsed || typeof proof !== 'string' || !/^[A-Za-z0-9_-]{40,64}$/.test(proof)) return false;
  const actual = Buffer.from(sha256Hex(Buffer.from(proof, 'base64url')), 'hex');
  const expected = Buffer.from(parsed.digest, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error('SESSION_SECRET missing (min 32 chars)');
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
  const a = Buffer.from(signature);
  const b = Buffer.from(sign(payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

/** True when the request reached us over HTTPS (Cloudflare and the Worker adapter set this header). */
export const isHttps = (req) => String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';

export function sessionCookie(token, { clear = false, secure = true } = {}) {
  // __Host- prefix: browser enforces Secure, Path=/ and no Domain — only usable over HTTPS.
  const name = secure ? `__Host-${COOKIE}` : COOKIE;
  const parts = [
    `${name}=${clear ? '' : token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    clear ? 'Max-Age=0' : `Max-Age=${SESSION_HOURS * 3600}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function getSession(req) {
  const raw = req.headers.cookie || '';
  const cookies = Object.fromEntries(raw.split(';').map((s) => {
    const i = s.indexOf('=');
    return i < 0 ? [s.trim(), ''] : [s.slice(0, i).trim(), s.slice(i + 1).trim()];
  }));
  const token = cookies[`__Host-${COOKIE}`] ?? cookies[COOKIE];
  return token ? readSession(token) : null;
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
  String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
    .split(',')[0].trim();

/** Same-site check, shared by the public and admin endpoints. */
export function isAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (host && (origin === `https://${host}` || origin === `http://${host}`)) return true;
  const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return allowed.includes(origin);
}
