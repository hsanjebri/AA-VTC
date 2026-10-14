// Contrôle de syntaxe, sans dépendance : « node --check » sur chaque script,
// puis validation des fichiers de configuration JSON / JSONC.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SKIP = new Set(['node_modules', '.git', '.wrangler', 'public/vendor', 'private']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = relative(ROOT, full).replace(/\\/g, '/');
    if (SKIP.has(entry) || SKIP.has(rel)) continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.m?js$/.test(entry)) out.push(rel);
  }
  return out;
}

/** JSONC : retire les commentaires // et les virgules traînantes avant de parser. */
function parseJsonc(text) {
  const stripped = text
    .replace(/"(?:[^"\\]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m) => (m.startsWith('"') ? m : ''))
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(stripped);
}

const errors = [];
const files = walk(ROOT).sort();

for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    errors.push(`${file}\n${String(err.stderr || err.message).trim()}`);
  }
}

for (const file of ['package.json', 'wrangler.jsonc']) {
  try {
    const text = readFileSync(join(ROOT, file), 'utf8');
    file.endsWith('.jsonc') ? parseJsonc(text) : JSON.parse(text);
  } catch (err) {
    errors.push(`${file} : ${err.message}`);
  }
}

if (errors.length) {
  console.error(`✖ ${errors.length} erreur(s) de syntaxe :\n\n${errors.join('\n\n')}`);
  process.exit(1);
}
console.log(`✔ ${files.length} scripts et 2 fichiers de configuration valides`);
