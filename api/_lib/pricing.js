// Single source of truth for AA-VTC fares. Files prefixed with "_" are not exposed as routes by Vercel.

export const RATE_PER_KM = 1.8;
export const TRANSFER_VAT_RATE = 10;

export const FORFAITS = [
  { id: '1h', name: '1 heure', hours: 1, includedKm: 20, price: 60, vatRate: null },
  { id: 'overlord', name: 'Overlord Circuit', hours: 4, includedKm: 70, price: 300, vatRate: null },
  { id: 'utah-omaha', name: 'Utah & Omaha', hours: 8, includedKm: 150, price: 580, vatRate: 20 },
];

// A round-trip "driver waits on site" forfait is only worth suggesting if it isn't wildly above the km price.
const ALTERNATIVE_MAX_RATIO = 2.5;

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Transfer price = km × 1,80 €. A forfait is suggested when it covers the whole trip
 * (distance within its included km, driving time within its hours) and either:
 *  - it is strictly cheaper than the per-km price ("cheaper"), or
 *  - the trip is a round trip, where keeping the driver on site is the real alternative ("alternative").
 */
export function quote({ distanceMeters, durationSeconds, roundTrip }) {
  const factor = roundTrip ? 2 : 1;
  const distanceKm = round1((distanceMeters / 1000) * factor);
  const durationMin = Math.max(1, Math.round((durationSeconds * factor) / 60));
  const price = round2(distanceKm * RATE_PER_KM);

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
    price,
    suggestion,
  };
}
