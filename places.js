// Key destinations for AA-VTC, shared by the page (suggestions) and /api/fare (free-text addresses).
// The public geocoder ranks landmarks poorly (e.g. "Mont-Saint-Michel" → a summit in Savoie), so these come first.
// Coordinates checked against IGN Géoplateforme where it returns the place.

export const PLACES = [
  { name: 'Le Mont-Saint-Michel', hint: 'Manche · Site classé', lat: 48.6358, lng: -1.5111, aliases: ['mont saint michel', 'mt st michel'] },
  { name: 'Omaha Beach', hint: 'Plage du Débarquement · Calvados', lat: 49.3729, lng: -0.8787 },
  { name: 'Utah Beach', hint: 'Plage du Débarquement · Sainte-Marie-du-Mont', lat: 49.4131, lng: -1.1728 },
  { name: 'Pointe du Hoc', hint: 'Site du Débarquement · Cricqueville-en-Bessin', lat: 49.3975, lng: -0.9894 },
  { name: 'Cimetière américain de Colleville-sur-Mer', hint: 'Mémorial · Calvados', lat: 49.3594, lng: -0.8558, aliases: ['normandy american cemetery', 'cimetiere americain'] },
  { name: 'Arromanches-les-Bains', hint: 'Port artificiel · Calvados', lat: 49.3381, lng: -0.6232 },
  { name: 'Sainte-Mère-Église', hint: 'Village du Débarquement · Manche', lat: 49.4086, lng: -1.3163 },
  { name: 'Aéroport de Caen-Carpiquet', hint: 'Aéroport · Carpiquet', lat: 49.1771, lng: -0.4573, aliases: ['carpiquet'] },
  { name: 'Aéroport de Deauville-Normandie', hint: 'Aéroport · Saint-Gatien-des-Bois', lat: 49.3627, lng: 0.16 },
  { name: 'Aéroport Paris-Charles de Gaulle', hint: 'Aéroport · Roissy-en-France', lat: 49.0052, lng: 2.5668, aliases: ['roissy', 'cdg'] },
  { name: 'Aéroport de Paris-Orly', hint: 'Aéroport · Orly', lat: 48.7289, lng: 2.3665 },
  { name: 'Aéroport de Beauvais-Tillé', hint: 'Aéroport · Tillé', lat: 49.4578, lng: 2.1145 },
  { name: 'Gare de Caen', hint: 'Gare SNCF · Caen', lat: 49.1764, lng: -0.3475 },
  { name: 'Gare de Bayeux', hint: 'Gare SNCF · Bayeux', lat: 49.2697, lng: -0.6979 },
  { name: 'Gare de Rouen-Rive-Droite', hint: 'Gare SNCF · Rouen', lat: 49.4488, lng: 1.094 },
  { name: 'Château de Chenonceau', hint: 'Château de la Loire · Chenonceaux', lat: 47.3246, lng: 1.0706 },
  { name: 'Château de Chambord', hint: 'Château de la Loire · Chambord', lat: 47.6161, lng: 1.517 },
];

export const normalize = (text) => String(text)
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/\bst\b/g, 'saint').replace(/\bste\b/g, 'sainte')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const haystacks = PLACES.map((p) => normalize([p.name, ...(p.aliases || [])].join(' ')));

/** Places whose name/aliases contain every word typed (prefix typing works: "aeroport ca"). */
export function matchPlaces(query, limit = 2) {
  const tokens = normalize(query).split(' ').filter(Boolean);
  if (tokens.join('').length < 3) return [];
  return PLACES.filter((_, i) => tokens.every((t) => haystacks[i].split(' ').some((word) => word.startsWith(t)))).slice(0, limit);
}

/** For free text sent to the server: only trust a curated match when at least two words were typed. */
export function findKnownPlace(text) {
  return normalize(text).split(' ').length >= 2 ? matchPlaces(text, 1)[0] || null : null;
}

export function kmBetween(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

const NORMANDY = { lat: 49.1, lng: -0.4 };

/** Geocoder score with a small bonus for results near Normandy (max 0.15 penalty for the far side of France). */
export const rankScore = (score, point) => (score || 0) - Math.min(kmBetween(point, NORMANDY) / 2000, 0.15);
