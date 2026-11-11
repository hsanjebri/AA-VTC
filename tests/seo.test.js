// Unit tests — published site: SEO tags, links, robots.txt, sitemap.xml,
// and security guards (no secret, no leftover of the removed admin area).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PUBLIC = join(process.cwd(), 'public');
const CANONICAL = 'https://aa-vtc.fr';
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
    assert.ok(title.includes('AJ-VTC'), 'the title must name the business');
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

describe('Canonical domain (no www)', () => {
  test('the canonical tag points to https://aa-vtc.fr/', () => {
    assert.match(html, /<link rel="canonical" href="https:\/\/aa-vtc\.fr\/">/);
  });

  test('Open Graph and Twitter use the canonical domain', () => {
    assert.match(html, /property="og:url" content="https:\/\/aa-vtc\.fr\/"/);
    assert.ok(html.includes('og:image'), 'og:image is missing');
    assert.ok(html.includes('twitter:card'), 'twitter:card is missing');
  });

  test('no www URL is left anywhere in the published site', () => {
    const offenders = filesIn(PUBLIC)
      .filter((f) => /\.(html|css|js|txt|xml|json)$/.test(f))
      .filter((f) => readFileSync(f, 'utf8').includes('www.aa-vtc'));
    assert.deepEqual(offenders, [], 'these files still contain www.aa-vtc');
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
    assert.equal(ld.name, 'AJ-VTC');
    assert.equal(ld.telephone, '+33652807488');
    assert.equal(ld.email, 'contact@aa-vtc.fr');
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
    const missing = refs.filter((u) => !existsSync(join(PUBLIC, u.split('?')[0].replace(/^\//, ''))));
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
    // "AdministrativeArea" (Normandie, in the JSON-LD) is legitimate: we target /admin.
    const found = published.filter((f) => /\/admin\b|api\/admin|\/api\/booking/.test(readFileSync(f, 'utf8')));
    assert.deepEqual(found, []);
  });

  test('server code is not inside the published folder', () => {
    for (const forbidden of ['worker.js', 'package.json', 'wrangler.jsonc', '.dev.vars', 'api']) {
      assert.ok(!existsSync(join(PUBLIC, forbidden)), `${forbidden} must not be published`);
    }
  });
});
