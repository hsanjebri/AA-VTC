// Journal des courses : création et consultation des notes et devis.
//
// La numérotation est attribuée ici, côté serveur, et non dans le navigateur :
// une suite continue sans trou est une obligation sur les factures, et un
// compteur gardé dans le téléphone disparaît au premier vidage de cache.
//
// L'accès est protégé par un jeton (secret JOURNAL_TOKEN) : rien n'est en clair
// dans le dépôt. Ces données contiennent des informations clients, elles ne
// doivent jamais être lisibles publiquement.

const PRESTATIONS = new Set(['transfert', 'forfait', 'circuit', 'miseadispo']);
const TYPES = new Set(['NOTE', 'FACTURE', 'DEVIS']);
// Un devis n'est pas un encaissement : il ne doit pas entrer dans le
// chiffre d'affaires. Une note et une facture, si.
const ENCAISSEMENTS = new Set(['NOTE', 'FACTURE']);
const round2 = (n) => Math.round(n * 100) / 100;

/** Comparaison à durée constante : évite de révéler le jeton caractère par caractère. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authorized(request, env) {
  const expected = env.JOURNAL_TOKEN;
  if (!expected) return false;
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return safeEqual(token, expected);
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

const text = (value, max = 200) => (typeof value === 'string' ? value.trim().slice(0, max) : null);
const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Attribue le numéro suivant et enregistre le document dans la même requête.
 * L'index unique (annee, sequence) empêche deux documents de porter le même
 * numéro si deux enregistrements partent en même temps : en cas de collision
 * on retente avec le numéro suivant.
 */
async function create(body, env) {
  const type = TYPES.has(body.type) ? body.type : 'NOTE';
  const prestation = PRESTATIONS.has(body.prestation) ? body.prestation : 'transfert';
  const tauxTva = body.tauxTva === 20 ? 20 : 10;

  const prixHt = round2(Math.max(0, num(body.prixHt)));
  const supplementHt = round2(Math.max(0, num(body.supplementHt)));
  const totalHt = round2(prixHt + supplementHt);
  const montantTva = round2((totalHt * tauxTva) / 100);
  const totalTtc = round2(totalHt + montantTva);

  const dateDoc = text(body.dateDoc, 10) || new Date().toISOString().slice(0, 10);
  const annee = Number(dateDoc.slice(0, 4)) || new Date().getFullYear();

  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await env.JOURNAL.prepare(
      'SELECT COALESCE(MAX(sequence), 0) AS last FROM documents WHERE annee = ?',
    ).bind(annee).first();
    const sequence = (row?.last ?? 0) + 1 + attempt;
    const numero = `${annee}-${String(sequence).padStart(4, '0')}`;

    try {
      await env.JOURNAL.prepare(
        `INSERT INTO documents (
           numero, annee, sequence, type, date_doc, date_course, heure,
           client, client_info, depart, arrivee, passagers,
           prestation, detail, aller_retour, km,
           prix_ht, supplement_ht, supplement_label,
           taux_tva, total_ht, montant_tva, total_ttc, paiement
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        numero, annee, sequence, type, dateDoc,
        text(body.dateCourse, 10), text(body.heure, 5),
        text(body.client), text(body.clientInfo), text(body.depart, 300), text(body.arrivee, 300),
        Math.min(Math.max(1, Math.round(num(body.passagers) || 1)), 8),
        prestation, text(body.detail, 300), body.allerRetour ? 1 : 0,
        body.km ? round2(num(body.km)) : null,
        prixHt, supplementHt, text(body.supplementLabel),
        tauxTva, totalHt, montantTva, totalTtc, text(body.paiement, 40),
      ).run();

      return json({ numero, annee, sequence, totalHt, montantTva, totalTtc }, 201);
    } catch (err) {
      // Collision sur (annee, sequence) : un autre document vient de prendre
      // ce numéro, on retente avec le suivant.
      if (!/UNIQUE|constraint/i.test(err?.message || '')) throw err;
    }
  }
  return json({ error: 'numbering_conflict' }, 409);
}

/** Liste filtrée par mois (AAAA-MM) ou par recherche libre. */
async function list(url, env) {
  const month = text(url.searchParams.get('month'), 7);
  const query = text(url.searchParams.get('q'), 80);
  const limit = Math.min(Math.max(1, Number(url.searchParams.get('limit')) || 200), 500);

  const where = [];
  const params = [];
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    where.push('date_doc LIKE ?');
    params.push(`${month}%`);
  }
  if (query) {
    where.push('(client LIKE ? OR depart LIKE ? OR arrivee LIKE ? OR numero LIKE ?)');
    const like = `%${query}%`;
    params.push(like, like, like, like);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { results } = await env.JOURNAL.prepare(
    `SELECT * FROM documents ${clause} ORDER BY date_doc DESC, sequence DESC LIMIT ?`,
  ).bind(...params, limit).all();

  const totals = results.reduce(
    (acc, r) => {
      if (!ENCAISSEMENTS.has(r.type)) return acc;
      acc.courses += 1;
      acc.totalHt = round2(acc.totalHt + r.total_ht);
      acc.montantTva = round2(acc.montantTva + r.montant_tva);
      acc.totalTtc = round2(acc.totalTtc + r.total_ttc);
      return acc;
    },
    { courses: 0, totalHt: 0, montantTva: 0, totalTtc: 0 },
  );

  return json({ documents: results, totals });
}

/**
 * Agrégats du tableau de bord.
 *
 * Tout est calculé en SQL et en un seul aller-retour : le Worker gratuit
 * dispose de 10 ms de processeur par requête, ce qui interdit de rapatrier les
 * lignes pour les additionner en JavaScript.
 *
 * Les devis sont exclus partout où il est question d'argent encaissé : un devis
 * n'est pas une recette. Ils ne reviennent que dans la répartition des
 * documents, et dans le taux de transformation.
 */
async function stats(url, env) {
  const today = url.searchParams.get('today') || new Date().toISOString().slice(0, 10);
  const annee = Number(today.slice(0, 4));
  const mois = Number(today.slice(5, 7));
  const trimestre = Math.floor((mois - 1) / 3) + 1;
  const debutTrimestre = `${annee}-${String((trimestre - 1) * 3 + 1).padStart(2, '0')}-01`;

  // 12 mois glissants, bornés au premier jour du mois d'il y a onze mois.
  const debutSerie = new Date(Date.UTC(annee, mois - 12, 1)).toISOString().slice(0, 7);

  const ENCAISSE = "type IN ('NOTE', 'FACTURE')";

  const [parMois, parType, destinations, paiements, trimestreRow, total] = await env.JOURNAL.batch([
    env.JOURNAL.prepare(
      `SELECT substr(date_doc, 1, 7) AS mois,
              COUNT(*) AS courses,
              SUM(total_ht) AS total_ht,
              SUM(montant_tva) AS montant_tva,
              SUM(total_ttc) AS total_ttc
       FROM documents WHERE ${ENCAISSE} AND substr(date_doc, 1, 7) >= ?
       GROUP BY mois ORDER BY mois ASC`,
    ).bind(debutSerie),

    env.JOURNAL.prepare(
      'SELECT type, COUNT(*) AS n FROM documents GROUP BY type',
    ),

    env.JOURNAL.prepare(
      `SELECT arrivee, COUNT(*) AS courses, SUM(total_ttc) AS total_ttc
       FROM documents
       WHERE ${ENCAISSE} AND arrivee IS NOT NULL AND TRIM(arrivee) <> ''
       GROUP BY arrivee ORDER BY courses DESC, total_ttc DESC LIMIT 8`,
    ),

    env.JOURNAL.prepare(
      `SELECT COALESCE(NULLIF(TRIM(paiement), ''), 'Non précisé') AS paiement,
              COUNT(*) AS n
       FROM documents WHERE ${ENCAISSE} GROUP BY paiement ORDER BY n DESC`,
    ),

    env.JOURNAL.prepare(
      `SELECT COUNT(*) AS courses,
              COALESCE(SUM(total_ht), 0)     AS total_ht,
              COALESCE(SUM(montant_tva), 0)  AS montant_tva,
              COALESCE(SUM(total_ttc), 0)    AS total_ttc
       FROM documents WHERE ${ENCAISSE} AND date_doc >= ? AND date_doc <= ?`,
    ).bind(debutTrimestre, today),

    env.JOURNAL.prepare(
      `SELECT COUNT(*) AS courses, COALESCE(SUM(total_ttc), 0) AS total_ttc
       FROM documents WHERE ${ENCAISSE}`,
    ),
  ]);

  const t = trimestreRow.results[0] || { courses: 0, total_ht: 0, montant_tva: 0, total_ttc: 0 };
  const g = total.results[0] || { courses: 0, total_ttc: 0 };
  const compte = (type) => parType.results.find((r) => r.type === type)?.n || 0;
  const devis = compte('DEVIS');

  return json({
    aujourdhui: today,
    trimestre: {
      libelle: `T${trimestre} ${annee}`,
      debut: debutTrimestre,
      courses: t.courses,
      totalHt: round2(t.total_ht),
      montantTva: round2(t.montant_tva),
      totalTtc: round2(t.total_ttc),
      panierMoyen: t.courses ? round2(t.total_ttc / t.courses) : 0,
    },
    parMois: parMois.results.map((r) => ({
      mois: r.mois,
      courses: r.courses,
      totalHt: round2(r.total_ht),
      montantTva: round2(r.montant_tva),
      totalTtc: round2(r.total_ttc),
    })),
    parType: { NOTE: compte('NOTE'), FACTURE: compte('FACTURE'), DEVIS: devis },
    // Pas de taux de transformation : la base ne relie pas un devis à la course
    // qui en découle, et le rapport des volumes n'en est pas une approximation
    // honnête. On se contente de compter les devis.
    destinations: destinations.results.map((r) => ({
      arrivee: r.arrivee, courses: r.courses, totalTtc: round2(r.total_ttc),
    })),
    paiements: paiements.results.map((r) => ({ paiement: r.paiement, n: r.n })),
    total: { courses: g.courses, totalTtc: round2(g.total_ttc) },
  });
}

/** Export CSV pour le comptable. */
async function exportCsv(url, env) {
  const month = text(url.searchParams.get('month'), 7);
  const clause = month && /^\d{4}-\d{2}$/.test(month) ? 'WHERE date_doc LIKE ?' : '';
  const params = clause ? [`${month}%`] : [];

  const { results } = await env.JOURNAL.prepare(
    `SELECT numero, type, date_doc, date_course, client, depart, arrivee,
            prestation, taux_tva, total_ht, montant_tva, total_ttc, paiement
     FROM documents ${clause} ORDER BY sequence ASC`,
  ).bind(...params).all();

  const head = ['Numero', 'Type', 'Date', 'Date course', 'Client', 'Depart', 'Arrivee',
    'Prestation', 'TVA %', 'Total HT', 'TVA', 'Total TTC', 'Paiement'];
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const body = results.map((r) => Object.values(r).map(escape).join(';')).join('\r\n');
  const csv = `﻿${head.map(escape).join(';')}\r\n${body}`;

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="journal-ej-vtc${month ? '-' + month : ''}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}

export default async function handler(request, env) {
  if (!env?.JOURNAL) return json({ error: 'journal_unavailable' }, 503);
  if (!authorized(request, env)) return json({ error: 'unauthorized' }, 401);

  const url = new URL(request.url);

  try {
    if (request.method === 'POST') {
      const body = await request.json().catch(() => null);
      if (!body || typeof body !== 'object') return json({ error: 'invalid_input' }, 400);
      return await create(body, env);
    }
    if (request.method === 'GET') {
      if (url.pathname.endsWith('/export')) return await exportCsv(url, env);
      if (url.pathname.endsWith('/stats')) return await stats(url, env);
      return await list(url, env);
    }
    return json({ error: 'method_not_allowed' }, 405);
  } catch (err) {
    console.error('[journal]', err?.message);
    return json({ error: 'server_error' }, 500);
  }
}
