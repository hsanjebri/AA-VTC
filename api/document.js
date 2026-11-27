// Copie client d'une note, d'une facture ou d'un devis : /f/<jeton>
//
// Il n'y a pas d'authentification ici, et c'est voulu : le jeton EST la clé.
// Tiré sur 128 bits, il n'est ni devinable ni énumérable — contrairement à un
// identifiant de ligne, qui se parcourt en comptant. C'est le même principe
// qu'un lien de partage de document.
//
// Le document est rendu côté serveur, sans JavaScript : il doit s'ouvrir et
// s'imprimer partout, y compris sur un vieux téléphone, et rester lisible
// quand le client le rouvrira dans deux ans pour sa comptabilité.

import { ENTREPRISE } from './_lib/entreprise.js';

const PRESTATIONS = {
  transfert: 'Transfert local',
  forfait: 'Forfait aéroport / gare',
  circuit: 'Circuit touristique',
  miseadispo: 'Mise à disposition',
};

const TITRES = { NOTE: 'Note', FACTURE: 'Facture', DEVIS: 'Devis' };

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const euro = (n) => `${Number(n).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} €`;
const frDate = (v) => (v ? String(v).split('-').reverse().join('/') : '');

/** Le jeton vient de l'URL : on ne requête la base qu'avec un format attendu. */
const jetonValide = (j) => typeof j === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(j);

function page({ titre, corps, statut = 200 }) {
  return new Response(`<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(titre)} — EJ-VTC</title>
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="theme-color" content="#0B1E3D">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..600;1,9..144,300..600&family=Inter:wght@400;500;600&display=swap">
<style>
  :root {
    --navy:#0B1E3D; --gold:#C8A24A; --gold-deep:#8a6f28;
    --paper:#F7F4EC; --cream:#FBF9F4; --ink:#1A2233; --muted:#5A6376;
    --line:rgba(11,30,61,.13);
    --display:'Fraunces',Georgia,serif; --sans:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;
  }
  *,*::before,*::after{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.6}
  .shell{max-width:800px;margin:0 auto;padding:26px 18px 120px}
  .intro{margin-bottom:18px}
  .eyebrow{display:flex;align-items:center;gap:10px;margin:0 0 6px;font-size:.68rem;letter-spacing:.2em;text-transform:uppercase;color:var(--gold-deep)}
  .eyebrow::before{content:"";width:26px;height:1px;background:var(--gold)}
  .intro h1{font-family:var(--display);font-weight:400;font-size:clamp(1.3rem,4vw,1.7rem);margin:0 0 6px;color:var(--navy)}
  .intro p{margin:0;color:var(--muted);font-size:.9rem}

  .doc{background:#fff;border:1px solid var(--line);border-radius:4px;padding:32px;
       box-shadow:0 1px 2px rgba(11,30,61,.04),0 12px 32px -12px rgba(11,30,61,.18)}
  .doc__head{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;align-items:flex-start}
  .doc__brand{font-size:1.1rem;letter-spacing:.24em;text-transform:uppercase;color:var(--navy);font-weight:600}
  .doc__issuer{font-size:.78rem;color:var(--muted);margin-top:10px;line-height:1.7}
  .doc__issuer span{display:block}
  .doc__issuer .issuer__name{color:var(--navy);font-weight:600;font-size:.86rem}
  .doc__meta{text-align:right;font-size:.82rem;color:var(--muted)}
  .doc__meta strong{display:block;font-family:var(--display);font-size:1.2rem;font-weight:500;letter-spacing:.1em;color:var(--navy);margin-bottom:2px}
  .doc__title{font-family:var(--display);font-weight:400;font-size:1.12rem;color:var(--navy);margin:26px 0 0;padding-bottom:10px;border-bottom:2px solid var(--navy)}
  .doc__client{font-size:.88rem;margin:22px 0 0;padding:14px 16px;background:var(--cream);border:1px solid var(--line);border-radius:3px;max-width:340px;line-height:1.7}
  .doc__client .client__label{display:block;font-size:.62rem;letter-spacing:.18em;text-transform:uppercase;color:var(--gold-deep);margin-bottom:5px;font-weight:600}
  .doc__client strong{color:var(--navy)}
  .doc__client em{font-style:normal;color:var(--muted);display:block}
  table{width:100%;border-collapse:collapse;font-size:.88rem;margin-top:20px}
  th{text-align:left;font-size:.64rem;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--line);padding:0 0 9px;font-weight:500}
  td{padding:13px 0;border-bottom:1px solid var(--line);vertical-align:top}
  td.num,th.num{text-align:right;white-space:nowrap;padding-left:12px}
  .line__title{font-weight:600;color:var(--navy)}
  .line__sub{color:var(--muted);font-size:.84rem}
  .totals{margin:18px 0 0 auto;width:min(300px,100%);font-size:.9rem}
  .totals div{display:flex;justify-content:space-between;gap:16px;padding:6px 0}
  .totals .ttc{border-top:2px solid var(--navy);margin-top:8px;padding-top:11px;font-family:var(--display);font-size:1.3rem;font-weight:500;color:var(--navy)}
  .doc__foot{margin-top:26px;padding-top:15px;border-top:1px solid var(--line);font-size:.74rem;color:var(--muted);line-height:1.8}

  .actions{position:fixed;left:0;right:0;bottom:0;background:rgba(247,244,236,.94);backdrop-filter:blur(10px);
           border-top:1px solid var(--line);padding:12px 18px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
  .btn{display:inline-flex;align-items:center;gap:8px;padding:12px 22px;border:0;border-radius:3px;cursor:pointer;
       font:inherit;font-size:.76rem;letter-spacing:.14em;text-transform:uppercase;text-decoration:none}
  .btn--gold{background:var(--gold);color:var(--navy);font-weight:600}
  .btn--line{background:#fff;color:var(--navy);border:1px solid var(--navy)}
  .btn svg{width:15px;height:15px;fill:currentColor}

  .avis{max-width:800px;margin:0 auto;padding:60px 18px;text-align:center}
  .avis h1{font-family:var(--display);font-weight:400;color:var(--navy);font-size:1.5rem;margin:0 0 10px}
  .avis p{color:var(--muted);margin:0 0 22px}

  @media (max-width:620px){ .doc{padding:20px} .shell{padding:18px 13px 110px} }
  @media print{
    .intro,.actions{display:none!important}
    body{background:#fff;font-size:11pt}
    .shell{max-width:none;padding:0}
    .doc{border:0;box-shadow:none;padding:0}
    table,.totals,.doc__client,.doc__foot{break-inside:avoid}
    @page{margin:16mm}
  }
</style>
</head>
<body>${corps}</body>
</html>`, {
    status: statut,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Un document nominatif ne doit traîner ni dans un cache partagé ni
      // dans un index : il n'appartient qu'à la personne qui a le lien.
      'Cache-Control': 'no-store, private',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

function blocEmetteur() {
  const lignes = [`<span class="issuer__name">${esc(ENTREPRISE.exploitant)}</span>`];
  const forme = [ENTREPRISE.formeJuridique, `nom commercial ${ENTREPRISE.raisonSociale}`]
    .filter(Boolean).join(' — ');
  lignes.push(`<span>${esc(forme)}</span>`);
  lignes.push(`<span>${esc(ENTREPRISE.adresse)}</span>`);
  lignes.push(`<span>SIRET ${esc(ENTREPRISE.siret)}</span>`);
  if (ENTREPRISE.tva) lignes.push(`<span>TVA ${esc(ENTREPRISE.tva)}</span>`);
  if (ENTREPRISE.evtc) lignes.push(`<span>N° EVTC ${esc(ENTREPRISE.evtc)}</span>`);
  lignes.push(`<span>${esc(ENTREPRISE.telephone)} · ${esc(ENTREPRISE.email)}</span>`);
  return lignes.join('');
}

/** Les mentions obligatoires dépendent du type : elles ne sont pas décoratives. */
function mentions(d) {
  const foot = [];
  if (d.type === 'DEVIS') {
    foot.push('Devis gratuit, valable 30 jours à compter de la date ci-dessus.');
    foot.push('Prix ferme pour le trajet décrit. Toute modification du trajet fera l’objet d’un nouveau devis.');
  } else if (d.type === 'FACTURE') {
    foot.push(d.paiement === 'À régler'
      ? `Règlement à réception.${d.echeance ? ` Échéance : ${frDate(d.echeance)}.` : ''}`
      : `Réglée par ${String(d.paiement || '').toLowerCase()} le ${frDate(d.date_doc)}.`);
    foot.push('Escompte pour paiement anticipé : néant.');
    foot.push('Retard de paiement : intérêts au taux de refinancement de la BCE majoré de 10 points, '
      + 'et indemnité forfaitaire de 40 € pour frais de recouvrement '
      + '(art. L441-10 et D441-5 du code de commerce).');
  } else {
    if (d.paiement) foot.push(`Payé par ${String(d.paiement).toLowerCase()}.`);
    foot.push('Note remise au client conformément à l’arrêté du 3 octobre 1983.');
  }
  foot.push(`${ENTREPRISE.site} · ${ENTREPRISE.telephone}`);
  return foot.map(esc).join('<br>');
}

function corpsDocument(d) {
  const titre = TITRES[d.type] || 'Document';
  const estDevis = d.type === 'DEVIS';

  const quand = [
    d.date_course ? `Le ${frDate(d.date_course)}` : '',
    d.heure ? `à ${d.heure}` : '',
  ].filter(Boolean).join(' ');
  const trajet = [d.depart, d.arrivee].filter(Boolean).join(' → ');
  const pax = Number(d.passagers) || 1;
  const detail = [
    trajet, quand,
    `${pax} passager${pax > 1 ? 's' : ''}`,
    d.detail || '',
    d.aller_retour ? 'Aller-retour (×2)' : '',
  ].filter(Boolean).map(esc).join('<br>');

  let lignes = `<tr>
    <td><span class="line__title">${esc(PRESTATIONS[d.prestation] || d.prestation)}</span><br>
        <span class="line__sub">${detail}</span></td>
    <td class="num">${Number(d.taux_tva)} %</td>
    <td class="num">${euro(d.prix_ht)}</td></tr>`;
  if (Number(d.supplement_ht) > 0) {
    lignes += `<tr><td>${esc(d.supplement_label || 'Supplément')}</td>
      <td class="num">${Number(d.taux_tva)} %</td>
      <td class="num">${euro(d.supplement_ht)}</td></tr>`;
  }

  const client = [
    d.client ? `<strong>${esc(d.client)}</strong>` : '',
    d.client_info ? `<em>${esc(d.client_info)}</em>` : '',
  ].filter(Boolean).join('') || '<strong>—</strong>';

  return `<div class="shell">
  <div class="intro">
    <p class="eyebrow">EJ-VTC</p>
    <h1>Votre ${esc(titre.toLowerCase())} n° ${esc(d.numero)}</h1>
    <p>Conservez ce lien : il vous redonnera ce document à tout moment.</p>
  </div>

  <article class="doc">
    <div class="doc__head">
      <div>
        <div class="doc__brand">EJ&#8201;—&#8201;VTC</div>
        <div class="doc__issuer">${blocEmetteur()}</div>
      </div>
      <div class="doc__meta">
        <strong>${esc(d.type)}</strong>
        <span>n° ${esc(d.numero)}</span><br>
        <span>${frDate(d.date_doc)}</span>
      </div>
    </div>

    <h2 class="doc__title">${esc(titre)} — transport de personnes avec chauffeur</h2>
    <p class="doc__client">
      <span class="client__label">${estDevis ? 'Devis établi pour' : 'Facturé à'}</span>${client}
    </p>

    <table>
      <thead><tr><th>Prestation</th><th class="num">TVA</th><th class="num">Montant HT</th></tr></thead>
      <tbody>${lignes}</tbody>
    </table>

    <div class="totals">
      <div><span>Total HT</span><span>${euro(d.total_ht)}</span></div>
      <div><span>TVA ${Number(d.taux_tva)} %</span><span>${euro(d.montant_tva)}</span></div>
      <div class="ttc"><span>Total TTC</span><span>${euro(d.total_ttc)}</span></div>
    </div>

    <div class="doc__foot">${mentions(d)}</div>
  </article>
</div>

<div class="actions">
  <button class="btn btn--gold" type="button" onclick="window.print()">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 8h-1V3H6v5H5a3 3 0 0 0-3 3v6h4v3h12v-3h4v-6a3 3 0 0 0-3-3ZM8 5h8v3H8V5Zm8 14H8v-4h8v4Zm3-7a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>
    Imprimer / PDF
  </button>
  <a class="btn btn--line" href="https://wa.me/${esc(String(ENTREPRISE.telephone).replace(/\D/g, ''))}">Une question ?</a>
</div>`;
}

export default async function handler(request, env) {
  if (!env?.JOURNAL) return page({ titre: 'Indisponible', statut: 503, corps:
    '<div class="avis"><h1>Service momentanément indisponible</h1><p>Merci de réessayer dans quelques minutes.</p></div>' });

  const jeton = new URL(request.url).pathname.replace(/^\/f\//, '').replace(/\/$/, '');

  // Lien inconnu et lien mal formé reçoivent exactement la même réponse :
  // rien ne doit permettre de distinguer un jeton qui existe d'un autre.
  const introuvable = () => page({ titre: 'Document introuvable', statut: 404, corps:
    `<div class="avis"><h1>Ce lien n’est plus valable</h1>
     <p>Le document n’existe pas, ou l’adresse est incomplète.<br>
     Contactez-nous et nous vous le renverrons.</p>
     <a class="btn btn--gold" href="https://wa.me/${esc(String(ENTREPRISE.telephone).replace(/\D/g, ''))}">Nous écrire</a></div>` });

  if (!jetonValide(jeton)) return introuvable();

  let doc;
  try {
    doc = await env.JOURNAL.prepare('SELECT * FROM documents WHERE jeton = ?').bind(jeton).first();
  } catch (err) {
    console.error('[document]', err?.message);
    return page({ titre: 'Indisponible', statut: 503, corps:
      '<div class="avis"><h1>Service momentanément indisponible</h1><p>Merci de réessayer dans quelques minutes.</p></div>' });
  }
  if (!doc) return introuvable();

  // Trace de consultation : si un client conteste un jour, on sait quand son
  // document a été ouvert. L'échec de ce comptage ne doit jamais empêcher
  // l'affichage — le client a droit à sa facture avant tout.
  try {
    await env.JOURNAL.prepare(
      "UPDATE documents SET consultations = consultations + 1, vue_le = datetime('now') WHERE jeton = ?",
    ).bind(jeton).run();
  } catch (err) {
    console.error('[document] trace', err?.message);
  }

  return page({ titre: `${TITRES[doc.type] || 'Document'} n° ${doc.numero}`, corps: corpsDocument(doc) });
}
