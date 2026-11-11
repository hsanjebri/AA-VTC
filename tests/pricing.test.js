// Unit tests — pricing: the AJ-VTC business rules, with no network and no database.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  quote,
  matchAirportForfait,
  RATE_PER_KM,
  MIN_FARE,
  TRANSFER_VAT_RATE,
  FORFAIT_VAT_RATE,
  EXTRA_KM_RATE,
  FORFAITS,
  AIRPORT_FORFAITS,
} from '../api/_lib/pricing.js';

const LE_HAVRE = { lat: 49.4944, lng: 0.1079 };
const ORLY = { lat: 48.7289, lng: 2.3665 };
const LYON = { lat: 45.7578, lng: 4.832 };

describe('Official rate card', () => {
  test('local transfer: 1.80 € excl. VAT per km, 9.50 € minimum, 10 % VAT', () => {
    assert.equal(RATE_PER_KM, 1.8);
    assert.equal(MIN_FARE, 9.5);
    assert.equal(TRANSFER_VAT_RATE, 10);
  });

  test('hourly hire: 60 / 300 / 580 € excl. VAT, 20 % VAT', () => {
    assert.deepEqual(FORFAITS.map((f) => f.price), [60, 300, 580]);
    assert.deepEqual(FORFAITS.map((f) => f.hours), [1, 4, 8]);
    assert.deepEqual(FORFAITS.map((f) => f.includedKm), [20, 70, 200]);
    assert.equal(FORFAIT_VAT_RATE, 20);
    for (const f of FORFAITS) assert.equal(f.vatRate, 20);
  });

  test('extra kilometre: 0.90 € excl. VAT', () => {
    assert.equal(EXTRA_KM_RATE, 0.9);
  });

  test('airport flat rates: Orly 376, Roissy 410, Caen 120, Deauville 45 € excl. VAT', () => {
    const byId = Object.fromEntries(AIRPORT_FORFAITS.map((f) => [f.id, f.price]));
    assert.deepEqual(byId, { orly: 376, cdg: 410, caen: 120, deauville: 45 });
  });
});

describe('Metered fare', () => {
  test('10 km = 18.00 € excl. VAT', () => {
    const q = quote({ distanceMeters: 10_000, durationSeconds: 900 });
    assert.equal(q.distanceKm, 10);
    assert.equal(q.price, 18);
    assert.equal(q.minFareApplied, false);
    assert.equal(q.vatRate, 10);
  });

  test('very short trip: the 9.50 € minimum applies', () => {
    const q = quote({ distanceMeters: 2000, durationSeconds: 300 });
    assert.equal(q.price, MIN_FARE);
    assert.equal(q.minFareApplied, true);
  });

  test('round trip: distance and duration are doubled', () => {
    const oneWay = quote({ distanceMeters: 10_000, durationSeconds: 900 });
    const roundTrip = quote({ distanceMeters: 10_000, durationSeconds: 900, roundTrip: true });
    assert.equal(roundTrip.distanceKm, oneWay.distanceKm * 2);
    assert.equal(roundTrip.durationMin, oneWay.durationMin * 2);
    assert.equal(roundTrip.roundTrip, true);
  });

  test('the fare never drops below the minimum', () => {
    for (const meters of [0, 100, 1000, 5000, 50_000]) {
      assert.ok(quote({ distanceMeters: meters, durationSeconds: 60 }).price >= MIN_FARE);
    }
  });
});

describe('Forfait suggestion', () => {
  test('no forfait suggested when the metered fare is cheaper', () => {
    const q = quote({ distanceMeters: 10_000, durationSeconds: 900 });
    assert.equal(q.suggestion, null);
  });

  test('19 km at 34.20 € stays below the 1-hour forfait', () => {
    const q = quote({ distanceMeters: 19_000, durationSeconds: 1800 });
    assert.equal(q.suggestion, null);
  });

  test('round trip: the "driver waits on site" forfait is offered as an alternative', () => {
    const q = quote({ distanceMeters: 10_000, durationSeconds: 900, roundTrip: true });
    assert.equal(q.suggestion.type, 'alternative');
    assert.equal(q.suggestion.forfait.id, '1h');
  });

  test('a forfait is never suggested when it cannot cover the trip', () => {
    const q = quote({ distanceMeters: 300_000, durationSeconds: 12_000, roundTrip: true });
    assert.equal(q.suggestion, null, '300 km exceeds the 200 km of the 8-hour forfait');
  });
});

describe('Airport flat rates from Le Havre', () => {
  test('Le Havre → Orly: 376 € excl. VAT, 10 % VAT', () => {
    const f = matchAirportForfait(LE_HAVRE, ORLY);
    assert.equal(f.id, 'orly');
    assert.equal(f.price, 376);
    assert.equal(f.vatRate, 10);
    assert.equal(f.label, 'Le Havre → Paris Orly');
  });

  test('the return direction is recognised and labelled correctly', () => {
    const f = matchAirportForfait(ORLY, LE_HAVRE);
    assert.equal(f.id, 'orly');
    assert.equal(f.label, 'Paris Orly → Le Havre');
  });

  test('no flat rate outside Le Havre', () => {
    assert.equal(matchAirportForfait(LYON, ORLY), null);
    assert.equal(matchAirportForfait(null, ORLY), null);
  });

  test('the flat rate replaces the metered fare when it is cheaper', () => {
    const q = quote({ distanceMeters: 215_000, durationSeconds: 9000, from: LE_HAVRE, to: ORLY });
    assert.equal(q.airportForfait.price, 376);
    assert.equal(q.airportForfait.cheaper, true);
    assert.ok(q.airportForfait.saving > 0);
    assert.ok(q.price > 376, 'the metered fare exceeds the flat rate on this trip');
  });

  test('round trip: the flat rate is doubled', () => {
    const q = quote({ distanceMeters: 215_000, durationSeconds: 9000, from: LE_HAVRE, to: ORLY, roundTrip: true });
    assert.equal(q.airportForfait.total, 752);
  });
});
