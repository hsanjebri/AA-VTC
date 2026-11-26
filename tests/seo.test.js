// Unit tests — published site: SEO tags, links, robots.txt, sitemap.xml,
// and security guards (no secret, no leftover of the removed admin area).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PUBLIC = join(process.cwd(), 'public');
const CANONICAL = 'https://ej-vtc.fr';
const html = readFileSync(join(PUBLIC, 'index.html'), 'utf8');
const robots = readFileSync(join(PUBLIC, 'robots.txt'), 'utf8');
const sitemap = readFileSync(join(PUBLIC, 'sitemap.xml'), 'utf8');

function filesIn(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) filesIn(full, out);
    else out.push(full);
  }
  return out;
}

describe('Page meta tags', () => {
  test('the language is French', () => {
    assert.match(html, /<html[^>]+lang="fr"/);
  });

  test('a unique, descriptive title', () => {
    const title = html.match(/<title>([^<]+)<\/title>/)[1];
    assert.ok(title.includes('EJ-VTC'), 'the title must name the business');
    assert.ok(title.length <= 70, `title too long for Google: ${title.length} characters`);
  });

  test('a meta description is present', () => {
    const desc = html.match(/name="description" content="([^"]+)"/)[1];
    assert.ok(desc.length >= 50, 'description too short');
  });

  test('exactly one <h1>', () => {
    const h1 = html.match(/<h1\b/g) || [];
    assert.equal(h1.length, 1, `found ${h1.length} <h1> tags`);
  });

  test('every image has an alt attribute', () => {
    const imgs = html.match(/<img\b[^>]*>/gs) || [];
    assert.ok(imgs.length > 0);
    const missing = imgs.filter((tag) => !/\salt\s*=/s.test(tag));
    assert.equal(missing.length, 0, `${missing.length} image(s) without alt`);
  });
});

describe('Canonical domain (ej-vtc.fr, no www)', () => {
  test('the canonical tag points to https://aa-vtc.fr/', () => {
    assert.match(html, /<link rel="canonical" href="https:\/\/ej-vtc\.fr\/">/);
  });

  test('Open Graph and Twitter use the canonical domain', () => {
    assert.match(html, /property="og:url" content="https:\/\/ej-vtc\.fr\/"/);
    assert.ok(html.includes('og:image'), 'og:image is missing');
    assert.ok(html.includes('twitter:card'), 'twitter:card is missing');
  });

  test('no www URL is left anywhere in the published site', () => {
    const offenders = filesIn(PUBLIC)
      .filter((f) => /\.(html|css|js|txt|xml|json)$/.test(f))
      .filter((f) => readFileSync(f, 'utf8').includes('www.ej-vtc') || readFileSync(f, 'utf8').includes('aa-vtc'));
    assert.deepEqual(offenders, [], 'these files still reference the old domain or a www URL');
  });
});

describe('Structured data (JSON-LD)', () => {
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);

  test('typed as LocalBusiness / TaxiService', () => {
    const types = [].concat(ld['@type']);
    assert.ok(types.includes('LocalBusiness'));
    assert.ok(types.includes('TaxiService'));
  });

  test('identity, phone and email', () => {
    assert.equal(ld.name, 'EJ-VTC');
    assert.equal(ld.telephone, '+33652807488');
    assert.equal(ld.email, 'contact@ej-vtc.fr');
    assert.ok(ld.url.startsWith(CANONICAL));
  });

  test('area served: Le Havre and Normandie', () => {
    const areas = ld.areaServed.map((z) => z.name);
    assert.ok(areas.includes('Le Havre'));
    assert.ok(areas.includes('Normandie'));
  });

  test('open 24/7', () => {
    const h = ld.openingHoursSpecification[0];
    assert.equal(h.dayOfWeek.length, 7, 'all 7 days must be declared');
    assert.equal(h.opens, '00:00');
    assert.ok(h.closes === '23:59' || h.closes === '24:00');
  });
});

describe('robots.txt and sitemap.xml', () => {
  test('robots.txt declares the sitemap on the canonical domain', () => {
    assert.ok(robots.includes(`Sitemap: ${CANONICAL}/sitemap.xml`), 'Sitemap line missing or still on www');
  });

  test('robots.txt does not block indexing', () => {
    assert.ok(!/^\s*Disallow:\s*\/\s*$/m.test(robots), 'the whole site is blocked from crawlers');
    assert.ok(robots.includes('Allow: /'));
  });

  test('the API is not exposed to crawlers', () => {
    assert.ok(robots.includes('Disallow: /api/'));
  });

  test('the sitemap is valid XML and uses only the canonical domain', () => {
    assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert.ok(locs.length > 0, 'the sitemap has no URL');
    for (const loc of locs) assert.ok(loc.startsWith(CANONICAL), `URL outside the canonical domain: ${loc}`);
  });
});

describe('Links and assets', () => {
  test('every local file referenced actually exists', () => {
    // HTML comments are not references.
    const withoutComments = html.replace(/<!--[\s\S]*?-->/g, '');
    const refs = [...withoutComments.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map((m) => m[1])
      .filter((u) => !/^(https?:|mailto:|tel:|data:|#|\/\/)/.test(u));
    // Cloudflare serves "/x" from "x.html" (html_handling: auto-trailing-slash).
    const resolves = (u) => {
      const rel = u.split('?')[0].split('#')[0].replace(/^\//, '').replace(/\/$/, '');
      return existsSync(join(PUBLIC, rel)) || existsSync(join(PUBLIC, `${rel}.html`));
    };
    const missing = refs.filter((u) => !resolves(u));
    assert.deepEqual(missing, [], 'assets not found in public/');
  });

  test('the official phone number is present', () => {
    assert.ok(html.includes('33652807488'), 'WhatsApp or phone link missing');
  });
});

describe('Security of the published content', () => {
  const published = filesIn(PUBLIC).filter((f) => /\.(html|css|js|txt|xml|json)$/.test(f));

  test('no API key or secret in the published files', () => {
    const patterns = [/AIza[0-9A-Za-z_-]{30,}/, /sk-[A-Za-z0-9]{20,}/, /PASSWORD_HASH/, /SESSION_SECRET/, /BEGIN [A-Z ]*PRIVATE KEY/];
    const found = [];
    for (const f of published) {
      const text = readFileSync(f, 'utf8');
      for (const pattern of patterns) if (pattern.test(text)) found.push(`${f} (${pattern})`);
    }
    assert.deepEqual(found, []);
  });

  test('no leftover of the removed admin area', () => {
    // Le tableau de bord occupe aujourd'hui /admin, légitimement : il passe par
    // l'API du journal, protégée par jeton. Ce qui ne doit pas revenir, c'est
    // l'ancienne API d'administration, ouverte et sans authentification.
    const found = published.filter((f) => /api\/admin|\/api\/booking/.test(readFileSync(f, 'utf8')));
    assert.deepEqual(found, []);
  });

  test('server code is not inside the published folder', () => {
    for (const forbidden of ['worker.js', 'package.json', 'wrangler.jsonc', '.dev.vars', 'api']) {
      assert.ok(!existsSync(join(PUBLIC, forbidden)), `${forbidden} must not be published`);
    }
  });
});

describe('Static pages and PWA files', () => {

  test('the 404 page exists and is excluded from indexing', () => {
    const notFound = join(PUBLIC, '404.html');
    assert.ok(existsSync(notFound), 'Cloudflare is configured for 404-page but the file is missing');
    const page = readFileSync(notFound, 'utf8');
    assert.match(page, /content="noindex/, 'a 404 page must not be indexed');
    assert.ok(page.includes('href="/"'), 'the 404 page must offer a way back home');
  });

  test('the web manifest is valid and referenced', () => {
    const manifest = JSON.parse(readFileSync(join(PUBLIC, 'site.webmanifest'), 'utf8'));
    assert.equal(manifest.short_name, 'EJ-VTC');
    assert.equal(manifest.start_url, '/');
    assert.ok(manifest.icons.length > 0, 'the manifest declares no icon');
    for (const icon of manifest.icons) {
      assert.ok(existsSync(join(PUBLIC, icon.src.replace(/^\//, ''))), `missing icon: ${icon.src}`);
    }
    assert.ok(html.includes('rel="manifest"'), 'the page does not reference the manifest');
  });

  test('security.txt follows RFC 9116 and has not expired', () => {
    const txt = readFileSync(join(PUBLIC, '.well-known', 'security.txt'), 'utf8');
    assert.match(txt, /^Contact:\s*\S+/m, 'a Contact field is required');
    const expires = txt.match(/^Expires:\s*(\S+)/m);
    assert.ok(expires, 'an Expires field is required');
    assert.ok(new Date(expires[1]) > new Date(), 'security.txt has expired');
  });
});
