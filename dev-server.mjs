// Local server: static site from public/ + /api functions, mirroring the Cloudflare Worker.
// Usage: npm run dev  →  http://localhost:3000
// (npm run preview runs the real Workers runtime instead.)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, 'public'); // only this folder is public, exactly like the Worker's assets
const PORT = Number(process.env.PORT || 3000);

// .dev.vars is the Cloudflare convention; .env.local is kept for backwards compatibility.
const envFiles = [join(ROOT, '.dev.vars'), join(ROOT, '.env.local')].filter(existsSync);
for (const file of envFiles) {
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !(match[1] in process.env)) process.env[match[1]] = match[2];
  }
}
if (!envFiles.length) {
  console.warn('⚠  Aucun .dev.vars : copiez .env.example vers .dev.vars pour l administration.');
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
  '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.pdf': 'application/pdf',
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5).replace(/\/$/, '');
    if (!/^[a-z-]+(\/[a-z-]+)?$/.test(name)) { res.statusCode = 404; return res.end('Not found'); }
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

  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = 'index.html';
  else if (pathname.endsWith('/')) pathname += 'index.html';
  else if (!extname(pathname)) pathname += '/index.html'; // /admin → /admin/index.html
  const filePath = normalize(join(PUBLIC, pathname));
  if (!filePath.startsWith(PUBLIC)) { res.statusCode = 403; return res.end(); }
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
  const ready = (name) => (process.env[name] ? 'OK' : 'manquant');
  console.log(`Base : ${process.env.DATABASE_URL ? 'Neon' : 'PGlite (local)'} · Admin : hash ${ready('ADMIN_PASSWORD_HASH')}, secret ${ready('SESSION_SECRET')}`);
});
