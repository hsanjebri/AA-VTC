// Identité de l'émetteur, telle qu'elle doit figurer sur une note, une facture
// ou un devis.
//
// Cette copie sert au rendu serveur du document remis au client ; la page
// /note en garde une pour son aperçu en direct. Un test compare les deux :
// deux identités qui divergent, ce sont deux documents qui ne s'accordent pas.

export const ENTREPRISE = {
  raisonSociale: 'EJ-VTC',
  // Entreprise individuelle : la dénomination légale est le nom de l'exploitant.
  exploitant: 'Ezeddine JABRI',
  formeJuridique: 'Entrepreneur individuel',
  adresse: '32 rue de Reims, 76620 Le Havre',
  siret: '890 613 565 00021',
  tva: 'FR54890613565',
  evtc: '',
  telephone: '+33 6 52 80 74 88',
  email: 'contact@ej-vtc.fr',
  site: 'ej-vtc.fr',
};

/**
 * Normalise un numéro français en 33XXXXXXXXX.
 *
 * Le même client écrit « 06 12 34 56 78 », « 0612345678 » ou « +33 6 12 34 56 78 ».
 * Sans cette mise à plat, il devient trois clients différents et ne retrouve
 * jamais tout son historique.
 */
export function normaliserTelephone(valeur) {
  if (typeof valeur !== 'string') return null;
  let chiffres = valeur.replace(/[^\d+]/g, '');
  if (chiffres.startsWith('+')) chiffres = chiffres.slice(1);
  if (chiffres.startsWith('00')) chiffres = chiffres.slice(2);
  if (/^0\d{9}$/.test(chiffres)) chiffres = `33${chiffres.slice(1)}`;
  // Un numéro plausible : indicatif compris, entre 8 et 15 chiffres (E.164).
  return /^\d{8,15}$/.test(chiffres) ? chiffres : null;
}
