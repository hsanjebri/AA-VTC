// Devis PDF — AA-VTC letterhead, brand fonts, electronic signature.
// Built in the admin's browser: on Cloudflare's free plan the server has 10 ms of CPU per request,
// far too little to embed fonts into a PDF. Needs window.PDFLib and window.fontkit (vendored under /vendor/pdf-lib/).

const A4 = { w: 595.28, h: 841.89 };
const M = 48; // page margin

const euro = (n) => `${Number(n).toFixed(2).replace('.', ',')} €`;
const frDate = (value) => new Date(value).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

/**
 * @param devis      row from /api/admin/devis?id=N
 * @param company    identity from the same response (env-driven server side, nothing invented)
 * @param fonts      { serifBold, sans, sansBold } as ArrayBuffers
 * @param signature  PNG ArrayBuffer or null
 * @returns Uint8Array (PDF bytes)
 */
export async function buildDevisPdf(devis, { company: co, fonts, signature }) {
  const { PDFDocument, rgb } = window.PDFLib;
  const NAVY = rgb(0.043, 0.118, 0.239);
  const GOLD = rgb(0.788, 0.635, 0.294);
  const INK = rgb(0.04, 0.04, 0.05);
  const GREY = rgb(0.42, 0.44, 0.47);
  const LINE = rgb(0.85, 0.85, 0.85);
  const CREAM = rgb(0.969, 0.957, 0.925);
  const WHITE = rgb(1, 1, 1);

  const lines = JSON.parse(devis.lines);

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(window.fontkit);
  pdf.setTitle(`Devis ${devis.number} — ${co.name}`);
  pdf.setProducer(co.name);
  pdf.setCreationDate(new Date(devis.created_at));

  // Fraunces for display type, Inter for everything else. Subsetting is off: pdf-lib's
  // subsetter drops glyphs from these fonts (words came out with missing letters).
  const [serifBold, sans, sansBold] = await Promise.all([
    pdf.embedFont(fonts.serifBold, { subset: false }),
    pdf.embedFont(fonts.sans, { subset: false }),
    pdf.embedFont(fonts.sansBold, { subset: false }),
  ]);

  const page = pdf.addPage([A4.w, A4.h]);
  const text = (str, x, y, { size = 9.5, font = sans, color = INK, spacing = 0 } = {}) =>
    page.drawText(String(str ?? ''), { x, y, size, font, color, characterSpacing: spacing });
  const width = (str, font, size) => font.widthOfTextAtSize(String(str ?? ''), size);
  const right = (str, xRight, y, opts = {}) =>
    text(str, xRight - width(str, opts.font || sans, opts.size || 9.5), y, opts);
  const rule = (x1, y, x2, { color = LINE, thickness = 0.6 } = {}) =>
    page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color });
  const label = (str, x, y) => text(str, x, y, { size: 7.5, font: sansBold, color: GOLD, spacing: 1.4 });

  /* ---------- Header band ---------- */
  page.drawRectangle({ x: 0, y: A4.h - 118, width: A4.w, height: 118, color: NAVY });
  text('AA', M, A4.h - 62, { size: 30, font: serifBold, color: GOLD });
  text('VTC', M + 46, A4.h - 60, { size: 11, font: sansBold, color: WHITE, spacing: 3.5 });
  page.drawLine({ start: { x: M + 38, y: A4.h - 56 }, end: { x: M + 42, y: A4.h - 56 }, thickness: 1, color: GOLD });
  text('Anywhere, Anytime.', M, A4.h - 82, { size: 9, font: sans, color: rgb(0.8, 0.8, 0.82), spacing: 0.6 });
  right(co.phone, A4.w - M, A4.h - 58, { size: 10.5, font: sansBold, color: WHITE });
  right(`${co.email}   ·   ${co.site}`, A4.w - M, A4.h - 76, { size: 8.5, color: rgb(0.78, 0.78, 0.8) });
  right('Chauffeur privé · Normandie & toute la France', A4.w - M, A4.h - 92, { size: 8, color: rgb(0.62, 0.64, 0.68) });

  /* ---------- Title + meta ---------- */
  let y = A4.h - 160;
  text('DEVIS', M, y, { size: 26, font: serifBold, color: NAVY });
  text(devis.number, M, y - 20, { size: 10, font: sansBold, color: GOLD, spacing: 1 });

  const metaX = A4.w - M - 180;
  const meta = [
    ['Date', frDate(devis.created_at)],
    ['Valable jusqu\'au', devis.valid_until ? frDate(devis.valid_until) : '—'],
    ['TVA applicable', `${String(devis.vat_rate).replace('.0', '')} %`],
  ];
  let metaY = y + 4;
  for (const [key, value] of meta) {
    text(key, metaX, metaY, { size: 8.5, color: GREY });
    right(value, A4.w - M, metaY, { size: 9.5, font: sansBold });
    metaY -= 15;
  }

  /* ---------- Emitter / client ---------- */
  y -= 56;
  const boxH = 92;
  const colW = (A4.w - 2 * M - 16) / 2;

  page.drawRectangle({ x: M, y: y - boxH, width: colW, height: boxH, color: CREAM });
  label('PRESTATAIRE', M + 14, y - 18);
  text(co.name, M + 14, y - 36, { size: 11.5, font: sansBold, color: NAVY });
  let lineY = y - 52;
  for (const entry of [co.address, co.siret && `SIRET ${co.siret}`, co.vtc && `Capacité VTC ${co.vtc}`, co.tva && `TVA ${co.tva}`].filter(Boolean)) {
    text(entry, M + 14, lineY, { size: 8.5, color: GREY });
    lineY -= 12;
  }

  const clientX = M + colW + 16;
  page.drawRectangle({ x: clientX, y: y - boxH, width: colW, height: boxH, borderColor: LINE, borderWidth: 0.8 });
  label('CLIENT', clientX + 14, y - 18);
  text(devis.client_name || '—', clientX + 14, y - 36, { size: 11.5, font: sansBold, color: NAVY });
  lineY = y - 52;
  for (const entry of [devis.client_phone, devis.client_email].filter(Boolean)) {
    text(entry, clientX + 14, lineY, { size: 8.5, color: GREY });
    lineY -= 12;
  }

  /* ---------- Table ---------- */
  y -= boxH + 40;
  const colQty = A4.w - M - 210;
  const colUnit = A4.w - M - 110;
  const colTotal = A4.w - M;

  page.drawRectangle({ x: M, y: y - 6, width: A4.w - 2 * M, height: 24, color: NAVY });
  text('PRESTATION', M + 12, y + 2, { size: 7.5, font: sansBold, color: GOLD, spacing: 1.2 });
  right('QTÉ', colQty, y + 2, { size: 7.5, font: sansBold, color: GOLD, spacing: 1.2 });
  right('PRIX UNIT. HT', colUnit, y + 2, { size: 7.5, font: sansBold, color: GOLD, spacing: 1.2 });
  right('TOTAL HT', colTotal - 12, y + 2, { size: 7.5, font: sansBold, color: GOLD, spacing: 1.2 });

  y -= 18;
  let zebra = false;
  for (const item of lines) {
    const rowH = 26;
    if (zebra) page.drawRectangle({ x: M, y: y - rowH + 8, width: A4.w - 2 * M, height: rowH, color: rgb(0.98, 0.98, 0.97) });
    zebra = !zebra;
    const maxW = colQty - M - 30;
    let title = String(item.label);
    while (width(title, sans, 10) > maxW && title.length > 4) title = title.slice(0, -2);
    if (title !== item.label) title += '…';
    text(title, M + 12, y - 10, { size: 10 });
    right(String(item.qty).replace('.', ','), colQty, y - 10, { size: 10 });
    right(euro(item.unitHt), colUnit, y - 10, { size: 10 });
    right(euro(item.totalHt), colTotal - 12, y - 10, { size: 10, font: sansBold });
    y -= rowH;
    rule(M, y + 6, A4.w - M);
  }

  /* ---------- Totals ---------- */
  const totalsX = A4.w - M - 230;
  const vat = Math.round(Number(devis.total_ht) * (Number(devis.vat_rate) / 100) * 100) / 100;
  y -= 22;
  text('Total HT', totalsX, y, { size: 9.5, color: GREY });
  right(euro(devis.total_ht), colTotal - 12, y, { size: 10.5 });
  y -= 18;
  text(`TVA ${String(devis.vat_rate).replace('.0', '')} %`, totalsX, y, { size: 9.5, color: GREY });
  right(euro(vat), colTotal - 12, y, { size: 10.5 });
  y -= 30;
  page.drawRectangle({ x: totalsX - 14, y: y - 10, width: A4.w - M - totalsX + 14, height: 34, color: NAVY });
  text('TOTAL TTC', totalsX, y, { size: 9.5, font: sansBold, color: WHITE, spacing: 1.2 });
  right(euro(devis.total_ttc), colTotal - 12, y - 1, { size: 14, font: serifBold, color: GOLD });

  /* ---------- Notes ---------- */
  y -= 46;
  if (devis.notes) {
    label('NOTES', M, y);
    y -= 14;
    const maxW = A4.w - 2 * M;
    let current = '';
    for (const word of String(devis.notes).split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (width(candidate, sans, 9) > maxW) {
        text(current, M, y, { size: 9, color: GREY });
        y -= 12;
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) { text(current, M, y, { size: 9, color: GREY }); y -= 12; }
    y -= 10;
  }

  /* ---------- Conditions + signatures (stacked below whatever precedes them) ---------- */
  let blockY = Math.min(y - 8, 320);
  label('CONDITIONS', M, blockY);
  blockY -= 16;
  const conditions = [
    'Devis gratuit et sans engagement.',
    'Prix en euros. Les montants sont indiqués HT, TVA au taux ci-dessus.',
    'Paiement par carte bancaire ou en espèces. Service disponible 24h/24, 7j/7.',
  ];
  for (const condition of conditions) {
    text(condition, M, blockY, { size: 8.5, color: GREY });
    blockY -= 12;
  }

  const sigW = 215;
  const clientSigX = M;
  const proSigX = A4.w - M - sigW;
  const sigBoxY = Math.max(blockY - 124, 86);

  const sigH = 104;
  page.drawRectangle({ x: clientSigX, y: sigBoxY, width: sigW, height: sigH, borderColor: LINE, borderWidth: 0.8 });
  text('Bon pour accord', clientSigX + 12, sigBoxY + sigH - 20, { size: 9, font: sansBold, color: NAVY });
  text('Date et signature du client', clientSigX + 12, sigBoxY + sigH - 34, { size: 8, color: GREY });

  page.drawRectangle({ x: proSigX, y: sigBoxY, width: sigW, height: sigH, color: CREAM });
  text(`Pour ${co.name}`, proSigX + 12, sigBoxY + sigH - 20, { size: 9, font: sansBold, color: NAVY });

  if (signature) {
    try {
      const image = await pdf.embedPng(signature);
      const scale = Math.min((sigW - 40) / image.width, 62 / image.height);
      page.drawImage(image, {
        x: proSigX + 16,
        y: sigBoxY + 18,
        width: image.width * scale,
        height: image.height * scale,
      });
    } catch (err) {
      console.error('[devis] signature image ignored:', err.message);
    }
  }
  if (co.signer) text(co.signer, proSigX + 12, sigBoxY + 7, { size: 8, color: GREY });

  /* ---------- Footer ---------- */
  page.drawLine({ start: { x: M, y: 60 }, end: { x: A4.w - M, y: 60 }, thickness: 2, color: GOLD });
  const legalParts = [co.name, co.address, co.siret && `SIRET ${co.siret}`, co.vtc && `Capacité VTC ${co.vtc}`, co.tva && `TVA ${co.tva}`].filter(Boolean);
  text(legalParts.join('  ·  '), M, 46, { size: 7.5, color: GREY });            // legal line
  text(`${co.email}  ·  ${co.phone}  ·  ${co.site}`, M, 34, { size: 7.5, color: GREY }); // contact line

  return pdf.save();
}
