// Generates ADMIN_PASSWORD_HASH (and a fresh SESSION_SECRET).
// Usage: node scripts/hash-password.mjs "votre-mot-de-passe"
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../api/_lib/auth.js';

const password = process.argv[2];
if (!password || password.length < 12) {
  console.error('Usage: node scripts/hash-password.mjs "mot de passe (12 caractères minimum)"');
  process.exit(1);
}

console.log('\nCloudflare (secrets) :');
console.log('  npx wrangler secret put ADMIN_PASSWORD_HASH   puis collez :');
console.log(`  ${hashPassword(password)}`);
console.log('  npx wrangler secret put SESSION_SECRET        puis collez :');
console.log(`  ${randomBytes(32).toString('base64url')}`);
console.log('\nEn local, mettez les deux mêmes valeurs dans .dev.vars (et ADMIN_EMAIL=contact@aa-vtc.fr).\n');
