// Tests du site publié : balises SEO, liens, robots.txt, sitemap.xml,
// et garde-fous de sécurité (aucun secret, aucune trace de l'ancienne administration).
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

describe('Balises de la page', () => {
  test('la langue est le français', () => {
    assert.match(html, /<html[^>]+lang="fr"/);
  });

  test('un titre unique et descriptif', () => {
    const title = html.match(/<title>([^<]+)<\/title>/)[1];
    assert.ok(title.includes('AA-VTC'), 'le titre doit nommer l’entreprise');
    assert.ok(title.length <= 70, `titre trop long pour Google : ${title.length} caractères`);
  });

  test('une méta description présente', () => {
    const desc = html.match(/name="description" content="([^"]+)"/)[1];
    assert.ok(desc.length >= 50, 'description trop courte');
  });

  test('un seul <h1>', () => {
    const h1 = html.match(/<h1\b/g) || [];
    assert.equal(h1.length, 1, `${h1.length} balises <h1> trouvées`);
  });

  test('toutes les images ont un attribut alt', () => {
    const imgs = html.match(/<img\b[^>]*>/gs) || [];
    assert.ok(imgs.length > 0);
    const sansAlt = imgs.filter((tag) => !/\salt\s*=/s.test(tag));
    assert.equal(sansAlt.length, 0, `${sansAlt.length} image(s) sans alt`);
  });
});

describe('Domaine canonique (sans www)', () => {
  test('la balise canonical pointe vers https://aa-vtc.fr/', () => {
    assert.match(html, /<link rel="canonical" href="https:\/\/aa-vtc\.fr\/">/);
  });

  test('Open Graph et Twitter utilisent le domaine canonique', () => {
    assert.match(html, /property="og:url" content="https:\/\/aa-vtc\.fr\/"/);
    assert.ok(html.includes('og:image'), 'og:image manquante');
    assert.ok(html.includes('twitter:card'), 'twitter:card manquante');
  });

  test('aucune URL en www ne subsiste dans le site publié', () => {
    const fautifs = filesIn(PUBLIC)
      .filter((f) => /\.(html|css|js|txt|xml|json)$/.test(f))
      .filter((f) => readFileSync(f, 'utf8').includes('www.aa-vtc'));
    assert.deepEqual(fautifs, [], 'ces fichiers contiennent encore www.aa-vtc');
  });
});

describe('Données structurées (JSON-LD)', () => {
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);

  test('type LocalBusiness / TaxiService', () => {
    const types = [].concat(ld['@type']);
    assert.ok(types.includes('LocalBusiness'));
    assert.ok(types.includes('TaxiService'));
  });

  test('identité, téléphone et e-mail', () => {
    assert.equal(ld.name, 'AA-VTC');
    assert.equal(ld.telephone, '+33652807488');
    assert.equal(ld.email, 'contact@aa-vtc.fr');
    assert.ok(ld.url.startsWith(CANONICAL));
  });

  test('zone desservie : Le Havre et la Normandie', () => {
    const zones = ld.areaServed.map((z) => z.name);
    assert.ok(zones.includes('Le Havre'));
    assert.ok(zones.includes('Normandie'));
  });

  test('ouvert 24h/24, 7j/7', () => {
    const h = ld.openingHoursSpecification[0];
    assert.equal(h.dayOfWeek.length, 7, 'les 7 jours doivent être déclarés');
    assert.equal(h.opens, '00:00');
    assert.ok(h.closes === '23:59' || h.closes === '24:00');
  });
});

describe('robots.txt et sitemap.xml', () => {
  test('robots.txt déclare le sitemap sur le domaine canonique', () => {
    assert.ok(robots.includes(`Sitemap: ${CANONICAL}/sitemap.xml`), 'ligne Sitemap absente ou en www');
  });

  test('robots.txt n’interdit pas l’indexation du site', () => {
    assert.ok(!/^\s*Disallow:\s*\/\s*$/m.test(robots), 'le site entier est interdit aux robots');
    assert.ok(robots.includes('Allow: /'));
  });

  test('l’API n’est pas exposée aux robots', () => {
    assert.ok(robots.includes('Disallow: /api/'));
  });

  test('le sitemap est un XML valide et n’utilise que le domaine canonique', () => {
    assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert.ok(locs.length > 0, 'aucune URL dans le sitemap');
    for (const loc of locs) assert.ok(loc.startsWith(CANONICAL), `URL hors domaine canonique : ${loc}`);
  });
});

describe('Liens et ressources', () => {
  test('tous les fichiers locaux référencés existent', () => {
    // Les commentaires HTML ne sont pas des références.
    const sansCommentaires = html.replace(/<!--[\s\S]*?-->/g, '');
    const refs = [...sansCommentaires.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map((m) => m[1])
      .filter((u) => !/^(https?:|mailto:|tel:|data:|#|\/\/)/.test(u));
    const manquants = refs.filter((u) => !existsSync(join(PUBLIC, u.split('?')[0].replace(/^\//, ''))));
    assert.deepEqual(manquants, [], 'ressources introuvables dans public/');
  });

  test('le numéro de téléphone officiel est présent', () => {
    assert.ok(html.includes('33652807488'), 'lien WhatsApp ou téléphone manquant');
  });
});

describe('Sécurité du contenu publié', () => {
  const publies = filesIn(PUBLIC).filter((f) => /\.(html|css|js|txt|xml|json)$/.test(f));

  test('aucune clé d’API ni secret dans les fichiers publiés', () => {
    const motifs = [/AIza[0-9A-Za-z_-]{30,}/, /sk-[A-Za-z0-9]{20,}/, /PASSWORD_HASH/, /SESSION_SECRET/, /BEGIN [A-Z ]*PRIVATE KEY/];
    const trouves = [];
    for (const f of publies) {
      const texte = readFileSync(f, 'utf8');
      for (const motif of motifs) if (motif.test(texte)) trouves.push(`${f} (${motif})`);
    }
    assert.deepEqual(trouves, []);
  });

  test('aucune trace de l’ancienne administration', () => {
    // « AdministrativeArea » (Normandie, dans le JSON-LD) est légitime : on cible /admin.
    const trouves = publies.filter((f) => /\/admin\b|api\/admin|\/api\/booking/.test(readFileSync(f, 'utf8')));
    assert.deepEqual(trouves, []);
  });

  test('le code serveur n’est pas dans le dossier publié', () => {
    for (const interdit of ['worker.js', 'package.json', 'wrangler.jsonc', '.dev.vars', 'api']) {
      assert.ok(!existsSync(join(PUBLIC, interdit)), `${interdit} ne doit pas être publié`);
    }
  });
});
