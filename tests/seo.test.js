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

describe('Internal note / quote tool', () => {
  const note = readFileSync(join(PUBLIC, 'note.html'), 'utf8');

  test('the page exists and stays out of search engines', () => {
    assert.match(note, /content="noindex/, 'an internal tool must not be indexed');
    assert.ok(robots.includes('Disallow: /note'), 'robots.txt must exclude /note');
    assert.ok(!sitemap.includes('/note'), 'the tool must not be in the sitemap');
  });

  test('it is not linked from the public page', () => {
    assert.ok(!html.includes('note.html') && !html.includes('href="/note"'),
      'the tool is for the driver, not for visitors');
  });

  test('the legal VAT rates are offered', () => {
    for (const rate of ['10', '20']) {
      assert.ok(note.includes(`|${rate}"`), `VAT ${rate} % missing from the prestation list`);
    }
  });

  test('a document carries the mentions a note requires', () => {
    for (const field of ['siret', 'evtc', 'raisonSociale', 'adresse']) {
      assert.ok(note.includes(field), `${field} missing from the issuer block`);
    }
    assert.ok(note.includes('3 octobre 1983'), 'the legal basis should be cited on the note');
  });

  test('missing identifiers are flagged rather than silently omitted', () => {
    assert.ok(note.includes('Document incomplet'),
      'the page must warn when SIRET/EVTC are not filled in');
  });
});

// Une note sans SIRET ni identité de l'exploitant n'est pas un justificatif
// valable : ces champs doivent rester renseignés dans l'outil interne.
describe("Identité de l'entreprise sur les documents", () => {
  const note = readFileSync(join(PUBLIC, 'note.html'), 'utf8');

  test('the note carries the SIRET, the VAT number and the operator name', () => {
    assert.match(note, /siret: '890 613 565 00021'/);
    assert.match(note, /tva: 'FR54890613565'/);
    assert.match(note, /exploitant: 'Ezeddine JABRI'/);
    assert.ok(note.includes('ENTREPRISE.exploitant'), 'the operator name is never printed');
  });

  test('a missing EVTC number is still flagged on the document', () => {
    assert.ok(note.includes("manquants.push('numéro EVTC')"), 'a missing EVTC number goes unnoticed');
    assert.ok(note.includes('Document incomplet'), 'no warning when a mandatory field is missing');
  });

  // Une facture entre professionnels sans ces mentions est irrégulière
  // (art. L441-9 du code de commerce).
  test('the tool can issue an invoice, not only a receipt', () => {
    assert.match(note, /<option value="FACTURE"/, 'no invoice type in the form');
    assert.ok(note.includes("FACTURE:"), 'FACTURE is not described among the document types');
  });

  test('an invoice carries the mandatory payment terms', () => {
    assert.ok(note.includes('Échéance'), 'no due date on the invoice');
    assert.ok(note.includes('Escompte pour paiement anticipé'), 'the discount term is missing');
    assert.ok(note.includes('40 € pour frais de recouvrement'), 'the flat recovery fee is missing');
    assert.ok(note.includes('L441-10'), 'the late-payment interest basis is missing');
  });

  test('an invoice demands the client address, a quote offers a signature box', () => {
    assert.ok(note.includes("todo('Adresse du client')"), 'an invoice can be issued without the client address');
    assert.ok(note.includes('Bon pour accord'), 'a quote cannot be returned signed');
    assert.ok(note.includes("$('accord').hidden = !isDevis"), 'the signature box is not reserved for quotes');
  });
});

// Le tableau de bord lit les mêmes données que le journal : il doit être
// aussi fermé que lui, et ses agrégats doivent exclure les devis.
// Le lien client n'a pas d'authentification : le jeton est la clé. Tout ce qui
// suit vérifie qu'il mérite ce rôle, et qu'un document nominatif ne fuit pas.
describe('Lien privé du client', () => {
  const api = readFileSync(join(process.cwd(), 'api', 'journal.js'), 'utf8');
  const doc = readFileSync(join(process.cwd(), 'api', 'document.js'), 'utf8');
  const note = readFileSync(join(PUBLIC, 'note.html'), 'utf8');

  test('the token is random, not derived from the document', () => {
    assert.ok(api.includes('crypto.getRandomValues(new Uint8Array(16))'),
      '128 bits of randomness is what makes the link unguessable');
    // Un jeton dérivé du numéro ou de l'identifiant se recalcule, donc se devine.
    const fn = api.slice(api.indexOf('function nouveauJeton'), api.indexOf('/** Comparaison'));
    for (const graine of ['numero', 'sequence', 'id', 'Date.now']) {
      assert.ok(!fn.includes(graine), `the token must not depend on ${graine}`);
    }
  });

  test('an unknown token and a malformed one are indistinguishable', () => {
    // Deux réponses différentes permettraient de savoir qu'un jeton existe.
    assert.ok(doc.includes('const introuvable = () =>'), 'a single not-found response is expected');
    assert.equal(doc.split('return introuvable()').length - 1, 2,
      'a malformed token and an unknown one must share one response');
  });

  test('a nominative document is never cached nor indexed', () => {
    assert.ok(doc.includes("'Cache-Control': 'no-store, private'"), 'no shared cache');
    assert.ok(doc.includes('noindex, nofollow, noarchive'), 'never indexed');
    assert.ok(robots.includes('Disallow: /f/'));
    assert.ok(!sitemap.includes('/f/'));
    assert.ok(!html.includes('/f/'), 'never linked from the public page');
  });

  test('the client copy carries the mandatory invoice mentions', () => {
    assert.ok(doc.includes('40 € pour frais de recouvrement'), 'the flat recovery fee is missing');
    assert.ok(doc.includes('L441-10'), 'the late-payment basis is missing');
    assert.ok(doc.includes('Échéance'), 'the due date is missing');
    assert.ok(doc.includes('arrêté du 3 octobre 1983'), 'the receipt mention is missing');
  });

  test('the due date reaches the database, so both copies agree', () => {
    const schema = readFileSync(join(process.cwd(), 'migrations', '0003_lien_client.sql'), 'utf8');
    assert.ok(schema.includes('echeance'), 'the due date must be stored');
    assert.ok(note.includes("echeance: $('echeance').value"), 'the form must send it');
    assert.ok(api.includes("text(body.echeance, 10)"), 'the API must persist it');
  });

  test('a token designates exactly one document', () => {
    const schema = readFileSync(join(process.cwd(), 'migrations', '0003_lien_client.sql'), 'utf8');
    assert.ok(schema.includes('CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_jeton'),
      'without a unique index two documents could share a link');
  });

  test('the send button stays hidden until the document is saved', () => {
    // .btn pose display:inline-flex, ce qui l'emporte sur l'attribut hidden :
    // sans regle explicite, le bouton s'affiche avant d'avoir un lien.
    assert.ok(note.includes('.btn[hidden] { display: none; }'),
      'a hidden .btn would still be displayed');
  });

  test('the driver can send and re-send the link without reissuing a document', () => {
    assert.ok(note.includes('function preparerEnvoi'), 'no way to send the link after issuing');
    assert.ok(note.includes('wa.me/'), 'the link must go out through WhatsApp');
    const journal = readFileSync(join(PUBLIC, 'journal.html'), 'utf8');
    assert.ok(journal.includes('function lienWhatsApp'), 'a lost link must be re-sendable');
  });
});

describe("Identité partagée entre la page et le serveur", () => {
  const champs = (texte) => {
    const bloc = texte.slice(texte.indexOf('ENTREPRISE = {'));
    const out = {};
    for (const [, cle, val] of bloc.slice(0, bloc.indexOf('};')).matchAll(/(\w+):\s*'([^']*)'/g)) {
      out[cle] = val;
    }
    return out;
  };

  test('the page and the server state the same identity', () => {
    // Deux copies qui divergent, ce sont deux documents qui ne s'accordent pas :
    // l'aperçu du chauffeur et la copie du client.
    const page = champs(readFileSync(join(PUBLIC, 'note.html'), 'utf8'));
    const serveur = champs(readFileSync(join(process.cwd(), 'api', '_lib', 'entreprise.js'), 'utf8'));
    for (const cle of ['raisonSociale', 'exploitant', 'formeJuridique', 'adresse', 'siret', 'tva', 'telephone', 'email']) {
      assert.equal(page[cle], serveur[cle], `${cle} differs between the page and the server`);
    }
  });
});

describe('Normalisation du numéro de téléphone', () => {
  test('the same client written three ways is one client', async () => {
    const { normaliserTelephone } = await import('../api/_lib/entreprise.js');
    for (const saisie of ['06 12 34 56 78', '0612345678', '+33 6 12 34 56 78', '0033612345678']) {
      assert.equal(normaliserTelephone(saisie), '33612345678', `failed on ${saisie}`);
    }
  });

  test('nonsense is rejected rather than stored as an identity', async () => {
    const { normaliserTelephone } = await import('../api/_lib/entreprise.js');
    for (const saisie of ['', 'bonjour', '12', null, undefined, '06 12 34']) {
      assert.equal(normaliserTelephone(saisie), null, `should reject ${saisie}`);
    }
  });
});

describe('Tableau de bord', () => {
  const admin = readFileSync(join(PUBLIC, 'admin.html'), 'utf8');
  const api = readFileSync(join(process.cwd(), 'api', 'journal.js'), 'utf8');

  test('the dashboard stays private', () => {
    assert.match(admin, /content="noindex/);
    assert.ok(robots.includes('Disallow: /admin'));
    assert.ok(!sitemap.includes('/admin'));
    assert.ok(!html.includes('/admin'), 'never linked from the public page');
  });

  test('the dashboard goes through the same token as the journal', () => {
    assert.ok(admin.includes("'ejvtc.journalToken'"), 'it must reuse the journal key');
    assert.ok(admin.includes('Authorization'), 'the API call must carry the token');
    assert.ok(!/JOURNAL_TOKEN|Bearer [A-Za-z0-9]{8}/.test(admin), 'no key may be committed');
  });

  test('money figures never count quotes', () => {
    assert.ok(api.includes("ENCAISSE = \"type IN ('NOTE', 'FACTURE')\""),
      'the aggregates must filter on paid documents only');
    const stats = api.slice(api.indexOf('async function stats'), api.indexOf('/** Export CSV'));
    for (const query of ['total_ht', 'destinations', 'paiement']) {
      assert.ok(stats.includes(query), `the stats query lost ${query}`);
    }
    // Chaque requête qui additionne de l'argent porte le filtre ; seule celle
    // qui compte les documents par type s'en passe, et elle ne somme rien.
    const sommes = stats.split('env.JOURNAL.prepare').filter((q) => q.includes('SUM('));
    assert.ok(sommes.length >= 4, 'unexpectedly few aggregate queries');
    for (const q of sommes) {
      assert.ok(q.includes('${ENCAISSE}'), 'an aggregate query is missing the paid-only filter');
    }
  });

  test('every aggregate is computed in SQL, in one round trip', () => {
    // 10 ms de processeur par requête sur le plan gratuit : additionner les
    // lignes en JavaScript ne passerait pas à l'échelle.
    assert.ok(api.includes('JOURNAL.batch('), 'the six queries must travel together');
    assert.ok(api.includes('COALESCE(SUM(total_ht), 0)'), 'an empty quarter must read 0, not null');
  });

  test('a month without a course still appears on the axis', () => {
    assert.ok(admin.includes('function douzeMois'), 'the time axis must be built client-side');
    assert.ok(admin.includes('|| { mois, courses: 0'), 'a missing month must fall back to zero');
  });

  test('colour is never the only carrier of meaning', () => {
    assert.ok(admin.includes('mixLegend'), 'the breakdown needs a legend');
    assert.ok(admin.includes('monthsTable'), 'the chart needs a table view');
    assert.ok(admin.includes('--series-1: #2F5C9E'), 'the validated palette is expected');
  });
});

describe('Journal des courses', () => {
  const journal = readFileSync(join(PUBLIC, 'journal.html'), 'utf8');
  const api = readFileSync(join(process.cwd(), 'api', 'journal.js'), 'utf8');
  const note = readFileSync(join(PUBLIC, 'note.html'), 'utf8');

  test('the journal page stays private', () => {
    assert.match(journal, /content="noindex/);
    assert.ok(robots.includes('Disallow: /journal'));
    assert.ok(!sitemap.includes('/journal'));
    assert.ok(!html.includes('/journal'), 'never linked from the public page');
  });

  test('the API refuses anything without a valid token', () => {
    assert.ok(api.includes('authorized(request, env)'), 'every request must be checked');
    assert.ok(api.includes('safeEqual'), 'token comparison must be constant-time');
    assert.ok(api.includes("json({ error: 'unauthorized' }, 401)"));
  });

  test('no secret is committed', () => {
    assert.ok(!/JOURNAL_TOKEN\s*=\s*['"][^'"]+['"]/.test(api), 'the token must come from env only');
    assert.ok(!existsSync(join(process.cwd(), 'public', 'journal-token.txt')));
  });

  test('numbering is allocated server-side and protected by a unique index', () => {
    // La dernière migration qui reconstruit la table doit reposer les index,
    // sinon ils partent avec l'ancienne table et les doublons redeviennent possibles.
    const schema = readFileSync(join(process.cwd(), 'migrations', '0002_facture.sql'), 'utf8');
    assert.ok(schema.includes('UNIQUE INDEX') && schema.includes('(annee, sequence)'),
      'a unique index is what actually prevents duplicate numbers');
    assert.ok(api.includes('MAX(sequence)'), 'the next number comes from the database');
    assert.ok(note.includes('saved.numero'), 'the note must use the number the server allocated');
  });

  test('printing still works when the journal is unreachable', () => {
    assert.ok(note.includes('Imprimer quand même'),
      'a journal outage must never stop the driver handing the client a note');
  });

  test('only the two legal VAT rates can be stored', () => {
    assert.ok(api.includes('body.tauxTva === 20 ? 20 : 10'));
  });

  test('an invoice counts as revenue, a quote does not', () => {
    const schema = readFileSync(join(process.cwd(), 'migrations', '0002_facture.sql'), 'utf8');
    assert.ok(schema.includes("type IN ('NOTE', 'FACTURE', 'DEVIS')"), 'the schema rejects invoices');
    assert.ok(api.includes("ENCAISSEMENTS = new Set(['NOTE', 'FACTURE'])"),
      'an invoice must be counted in the turnover');
    assert.ok(api.includes('!ENCAISSEMENTS.has(r.type)'), 'the totals do not use that set');
    assert.ok(!/ENCAISSEMENTS[^;]*DEVIS/.test(api), 'a quote is not a payment received');
  });

  test('rebuilding the table does not lose the existing documents', () => {
    const schema = readFileSync(join(process.cwd(), 'migrations', '0002_facture.sql'), 'utf8');
    assert.ok(schema.includes('INSERT INTO documents SELECT * FROM documents_old'),
      'the rows must be copied before the old table is dropped');
    assert.ok(schema.indexOf('INSERT INTO documents SELECT') < schema.indexOf('DROP TABLE documents_old'),
      'the copy must happen before the drop');
  });
});
