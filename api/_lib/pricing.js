// Single source of truth for EJ-VTC fares. Files prefixed with "_" are not exposed as routes by Vercel.
// All prices are HT (hors taxes).

// Transfert local
export const RATE_PER_KM = 1.8;        // € HT / km
export const MIN_FARE = 9.5;           // € HT, forfait minimum
export const TRANSFER_VAT_RATE = 10;   // %

// Mise à disposition
export const EXTRA_KM_RATE = 0.9;      // € HT / km au-delà du kilométrage inclus
export const EXTRA_KM_VAT_RATE = 10;   // % (km supplémentaires : transport de voyageurs)
export const FORFAIT_VAT_RATE = 20;    // % (mise à disposition)

export const FORFAITS = [
  { id: '1h', name: '1 heure', hours: 1, includedKm: 20, price: 60, vatRate: FORFAIT_VAT_RATE },
  { id: '4h', name: '4 heures', hours: 4, includedKm: 70, price: 300, vatRate: FORFAIT_VAT_RATE },
  { id: '8h', name: '8 heures', hours: 8, includedKm: 200, price: 580, vatRate: FORFAIT_VAT_RATE },
];

// Fixed airport forfaits, au départ du Havre : kilométrage inclus, TVA 10 %.
export const AIRPORT_FORFAITS = [
  { id: 'orly', name: 'Paris Orly', price: 376, lat: 48.7289, lng: 2.3665 },
  { id: 'cdg', name: 'Paris Roissy', price: 410, lat: 49.0052, lng: 2.5668 },
  { id: 'caen', name: 'Aéroport de Caen', price: 120, lat: 49.1771, lng: -0.4573 },
  { id: 'deauville', name: 'Aéroport Deauville', price: 45, lat: 49.3627, lng: 0.16 },
];
const LE_HAVRE = { lat: 49.4944, lng: 0.1079 };
const LE_HAVRE_RADIUS_KM = 12;
const AIRPORT_RADIUS_KM = 6;
const AIRPORT_VAT_RATE = 10; // forfaits : transport de voyageurs

const kmBetween = (a, b) => {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
};

/** A fixed forfait applies when one end is Le Havre and the other is one of the listed airports. */
export function matchAirportForfait(from, to) {
  if (!from || !to) return null;
  for (const [a, b, direction] of [[from, to, 'aller'], [to, from, 'retour']]) {
    if (kmBetween(a, LE_HAVRE) > LE_HAVRE_RADIUS_KM) continue;
    const airport = AIRPORT_FORFAITS.find((f) => kmBetween(b, f) <= AIRPORT_RADIUS_KM);
    if (airport) {
      return {
        id: airport.id,
        label: direction === 'aller' ? `Le Havre → ${airport.name}` : `${airport.name} → Le Havre`,
        price: airport.price,
        vatRate: AIRPORT_VAT_RATE,
      };
    }
  }
  return null;
}

// A round-trip "driver waits on site" forfait is only worth suggesting if it isn't wildly above the km price.
const ALTERNATIVE_MAX_RATIO = 2.5;

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Transfert local = km × 1,80 € HT, with a 9,50 € HT minimum. A mise à disposition forfait is
 * suggested when it covers the whole trip (distance within its included km, driving time within
 * its hours) and either:
 *  - it is strictly cheaper than the per-km price ("cheaper"), or
 *  - the trip is a round trip, where keeping the driver on site is the real alternative ("alternative").
 */
export function quote({ distanceMeters, durationSeconds, roundTrip, from, to }) {
  const factor = roundTrip ? 2 : 1;
  const distanceKm = round1((distanceMeters / 1000) * factor);
  const durationMin = Math.max(1, Math.round((durationSeconds * factor) / 60));
  const metered = round2(distanceKm * RATE_PER_KM);
  const price = Math.max(metered, MIN_FARE);

  const covering = FORFAITS
    .filter((f) => distanceKm <= f.includedKm && durationMin <= f.hours * 60)
    .sort((a, b) => a.price - b.price);

  let suggestion = null;
  const cheaper = covering.find((f) => f.price < price);
  if (cheaper) {
    suggestion = { type: 'cheaper', forfait: cheaper, savings: round2(price - cheaper.price) };
  } else if (roundTrip && covering.length && covering[0].price <= price * ALTERNATIVE_MAX_RATIO) {
    suggestion = { type: 'alternative', forfait: covering[0] };
  }

  // A fixed airport forfait replaces the per-km price when it applies (and is cheaper).
  const airport = matchAirportForfait(from, to);
  const airportTotal = airport ? round2(airport.price * (roundTrip ? 2 : 1)) : null;

  return {
    roundTrip: Boolean(roundTrip),
    distanceKm,
    durationMin,
    ratePerKm: RATE_PER_KM,
    vatRate: TRANSFER_VAT_RATE,
    minFare: MIN_FARE,
    minFareApplied: price > metered,
    price,
    suggestion,
    airportForfait: airport
      ? { ...airport, total: airportTotal, cheaper: airportTotal < price, saving: round2(Math.max(price - airportTotal, 0)) }
      : null,
  };
}
