// Single source of truth for AA-VTC fares. Files prefixed with "_" are not exposed as routes by Vercel.
// All prices are HT (hors taxes).

// Transfert local
export const RATE_PER_KM = 1.8;        // € HT / km
export const MIN_FARE = 9.5;           // € HT, forfait minimum
export const TRANSFER_VAT_RATE = 10;   // %

// Mise à disposition
export const EXTRA_KM_RATE = 0.9;      // € HT / km au-delà du kilométrage inclus
export const FORFAIT_VAT_RATE = 20;    // %

export const FORFAITS = [
  { id: '1h', name: '1 heure', hours: 1, includedKm: 20, price: 60, vatRate: FORFAIT_VAT_RATE },
  { id: '4h', name: '4 heures', hours: 4, includedKm: 70, price: 300, vatRate: FORFAIT_VAT_RATE },
  { id: '8h', name: '8 heures', hours: 8, includedKm: 200, price: 580, vatRate: FORFAIT_VAT_RATE },
];

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
export function quote({ distanceMeters, durationSeconds, roundTrip }) {
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
  };
}
