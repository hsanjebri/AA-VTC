// Local server: static site + /api functions, with variables from .env.local.
// Usage: npm run dev  →  http://localhost:3000
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);

const envFile = join(ROOT, '.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !(match[1] in process.env)) process.env[match[1]] = match[2];
  }
} else {
  console.warn('⚠  .env.local introuvable : copiez .env.example vers .env.local et ajoutez vos clés.');
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json',
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5).replace(/\/$/, '');
    if (!/^[a-z-]+$/.test(name)) { res.statusCode = 404; return res.end('Not found'); }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    try { req.body = raw && req.headers['content-type']?.includes('json') ? JSON.parse(raw) : raw; } catch { req.body = raw; }
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (data) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); return res; };
    const file = join(ROOT, 'api', `${name}.js`);
    if (!existsSync(file)) { res.statusCode = 404; return res.end('Not found'); }
    try {
      const { default: handler } = await import(pathToFileURL(file).href);
      return await handler(req, res);
    } catch (err) {
      console.error(err);
      res.statusCode = 500;
      return res.end('Server error');
    }
  }

  const filePath = normalize(join(ROOT, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)));
  if (!filePath.startsWith(ROOT) || /[\\/]\.env/.test(filePath)) { res.statusCode = 403; return res.end(); }
  try {
    const data = await readFile(filePath);
    res.setHeader('Content-Type', TYPES[extname(filePath)] || 'application/octet-stream');
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
}).listen(PORT, () => {
  console.log(`AA-VTC → http://localhost:${PORT}`);
  console.log(`Clé navigateur : ${process.env.GOOGLE_MAPS_BROWSER_KEY ? 'OK' : 'manquante'} · Clé serveur : ${process.env.GOOGLE_MAPS_SERVER_KEY ? 'OK' : 'manquante'}`);
});
