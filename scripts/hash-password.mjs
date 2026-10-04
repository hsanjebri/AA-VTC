// Generates the value for ADMIN_PASSWORD_HASH.
// Usage: node scripts/hash-password.mjs "votre-mot-de-passe"
import { hashPassword } from '../api/_lib/auth.js';
import { randomBytes } from 'node:crypto';

const password = process.argv[2];
if (!password || password.length < 10) {
  console.error('Usage: node scripts/hash-password.mjs "mot de passe (10 caractères minimum)"');
  process.exit(1);
}

console.log('\nAjoutez ces variables (Vercel → Settings → Environment Variables, et .env.local en local) :\n');
console.log(`ADMIN_PASSWORD_HASH=${hashPassword(password)}`);
console.log(`SESSION_SECRET=${randomBytes(32).toString('base64url')}`);
console.log('ADMIN_EMAIL=contact@aa-vtc.fr\n');
