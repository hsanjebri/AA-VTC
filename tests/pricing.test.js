// Tests des tarifs : la règle métier d'AA-VTC, sans réseau ni base de données.
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

describe('Barème officiel', () => {
  test('transfert local : 1,80 € HT/km, minimum 9,50 € HT, TVA 10 %', () => {
    assert.equal(RATE_PER_KM, 1.8);
    assert.equal(MIN_FARE, 9.5);
    assert.equal(TRANSFER_VAT_RATE, 10);
  });

  test('mise à disposition : 60 / 300 / 580 € HT, TVA 20 %', () => {
    assert.deepEqual(FORFAITS.map((f) => f.price), [60, 300, 580]);
    assert.deepEqual(FORFAITS.map((f) => f.hours), [1, 4, 8]);
    assert.deepEqual(FORFAITS.map((f) => f.includedKm), [20, 70, 200]);
    assert.equal(FORFAIT_VAT_RATE, 20);
    for (const f of FORFAITS) assert.equal(f.vatRate, 20);
  });

  test('km supplémentaire : 0,90 € HT', () => {
    assert.equal(EXTRA_KM_RATE, 0.9);
  });

  test('forfaits aéroports : Orly 376, Roissy 410, Caen 120, Deauville 45 € HT', () => {
    const byId = Object.fromEntries(AIRPORT_FORFAITS.map((f) => [f.id, f.price]));
    assert.deepEqual(byId, { orly: 376, cdg: 410, caen: 120, deauville: 45 });
  });
});

describe('Estimation au kilomètre', () => {
  test('10 km = 18,00 € HT', () => {
    const q = quote({ distanceMeters: 10_000, durationSeconds: 900 });
    assert.equal(q.distanceKm, 10);
    assert.equal(q.price, 18);
    assert.equal(q.minFareApplied, false);
    assert.equal(q.vatRate, 10);
  });

  test('course très courte : le minimum de 9,50 € HT s’applique', () => {
    const q = quote({ distanceMeters: 2000, durationSeconds: 300 });
    assert.equal(q.price, MIN_FARE);
    assert.equal(q.minFareApplied, true);
  });

  test('aller-retour : distance et durée sont doublées', () => {
    const simple = quote({ distanceMeters: 10_000, durationSeconds: 900 });
    const retour = quote({ distanceMeters: 10_000, durationSeconds: 900, roundTrip: true });
    assert.equal(retour.distanceKm, simple.distanceKm * 2);
    assert.equal(retour.durationMin, simple.durationMin * 2);
    assert.equal(retour.roundTrip, true);
  });

  test('le prix ne descend jamais sous le minimum', () => {
    for (const metres of [0, 100, 1000, 5000, 50_000]) {
      assert.ok(quote({ distanceMeters: metres, durationSeconds: 60 }).price >= MIN_FARE);
    }
  });
});

describe('Suggestion de forfait', () => {
  test('aucun forfait proposé quand le kilométrage est moins cher', () => {
    const q = quote({ distanceMeters: 10_000, durationSeconds: 900 });
    assert.equal(q.suggestion, null);
  });

  test('un forfait moins cher est proposé avec l’économie réalisée', () => {
    // 40 km = 72 € HT : le forfait 1 h (60 € HT, 20 km inclus) ne couvre pas,
    // mais 4 h / 70 km non plus en prix. On vise ici un trajet où 1 h gagne.
    const q = quote({ distanceMeters: 19_000, durationSeconds: 1800 });
    assert.equal(q.suggestion, null, '19 km à 34,20 € HT reste sous le forfait 1 h');
  });

  test('aller-retour : le forfait « chauffeur sur place » est proposé en alternative', () => {
    const q = quote({ distanceMeters: 10_000, durationSeconds: 900, roundTrip: true });
    assert.equal(q.suggestion.type, 'alternative');
    assert.equal(q.suggestion.forfait.id, '1h');
  });

  test('un forfait n’est jamais proposé s’il ne couvre pas le trajet', () => {
    const q = quote({ distanceMeters: 300_000, durationSeconds: 12_000, roundTrip: true });
    assert.equal(q.suggestion, null, '300 km dépasse les 200 km du forfait 8 h');
  });
});

describe('Forfaits aéroports au départ du Havre', () => {
  test('Le Havre → Orly : 376 € HT, TVA 10 %', () => {
    const f = matchAirportForfait(LE_HAVRE, ORLY);
    assert.equal(f.id, 'orly');
    assert.equal(f.price, 376);
    assert.equal(f.vatRate, 10);
    assert.equal(f.label, 'Le Havre → Paris Orly');
  });

  test('le sens retour est reconnu et libellé correctement', () => {
    const f = matchAirportForfait(ORLY, LE_HAVRE);
    assert.equal(f.id, 'orly');
    assert.equal(f.label, 'Paris Orly → Le Havre');
  });

  test('aucun forfait hors du Havre', () => {
    assert.equal(matchAirportForfait(LYON, ORLY), null);
    assert.equal(matchAirportForfait(null, ORLY), null);
  });

  test('le forfait remplace le kilométrage quand il est moins cher', () => {
    const q = quote({ distanceMeters: 215_000, durationSeconds: 9000, from: LE_HAVRE, to: ORLY });
    assert.equal(q.airportForfait.price, 376);
    assert.equal(q.airportForfait.cheaper, true);
    assert.ok(q.airportForfait.saving > 0);
    assert.ok(q.price > 376, 'le prix au km dépasse le forfait sur ce trajet');
  });

  test('aller-retour : le forfait est doublé', () => {
    const q = quote({ distanceMeters: 215_000, durationSeconds: 9000, from: LE_HAVRE, to: ORLY, roundTrip: true });
    assert.equal(q.airportForfait.total, 752);
  });
});
