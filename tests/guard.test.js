// Tests de la protection anti-abus de /api/fare.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { clientIp, rateLimit, isAllowedOrigin, looksAutomated } from '../api/_lib/guard.js';

const req = (headers = {}, socket = {}) => ({ headers, socket });

describe('Identification du visiteur', () => {
  test('l’IP vient de l’en-tête Cloudflare', () => {
    assert.equal(clientIp(req({ 'cf-connecting-ip': '81.2.3.4' })), '81.2.3.4');
  });

  test('x-forwarded-for : on ne garde que la première IP', () => {
    assert.equal(clientIp(req({ 'x-forwarded-for': '81.2.3.4, 10.0.0.1' })), '81.2.3.4');
  });

  test('sans en-tête, l’IP est « unknown » et jamais vide', () => {
    assert.equal(clientIp(req()), 'unknown');
  });
});

describe('Contrôle d’origine (l’API n’est que pour ce site)', () => {
  test('une requête sans Origin est refusée', () => {
    assert.equal(isAllowedOrigin(req({ host: 'aa-vtc.fr' })), false);
  });

  test('l’origine du site est acceptée', () => {
    assert.equal(isAllowedOrigin(req({ origin: 'https://aa-vtc.fr', host: 'aa-vtc.fr' })), true);
  });

  test('une origine étrangère est refusée', () => {
    assert.equal(isAllowedOrigin(req({ origin: 'https://exemple-pirate.fr', host: 'aa-vtc.fr' })), false);
  });

  test('la liste ALLOWED_ORIGINS est respectée', () => {
    const previous = process.env.ALLOWED_ORIGINS;
    process.env.ALLOWED_ORIGINS = 'https://aa-vtc.fr,https://www.aa-vtc.fr';
    try {
      assert.equal(isAllowedOrigin(req({ origin: 'https://www.aa-vtc.fr', host: 'autre.fr' })), true);
      assert.equal(isAllowedOrigin(req({ origin: 'https://aa-vtc.com', host: 'autre.fr' })), false);
    } finally {
      process.env.ALLOWED_ORIGINS = previous;
    }
  });
});

describe('Détection des clients automatisés', () => {
  const BOTS = [
    'curl/8.5.0',
    'Wget/1.21',
    'python-requests/2.31.0',
    'Scrapy/2.11 (+https://scrapy.org)',
    'PostmanRuntime/7.36.0',
    'Python-urllib/3.11',
    'Java/17.0.1',
    'HeadlessChrome/131.0.0.0',
    'Go-http-client/2.0',
    'axios/1.6.7',
    'node-fetch/3.3.2',
  ];
  const NAVIGATEURS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/122.0',
  ];

  for (const ua of BOTS) {
    test(`refusé : ${ua.slice(0, 28)}`, () => assert.equal(looksAutomated(req({ 'user-agent': ua })), true));
  }

  for (const ua of NAVIGATEURS) {
    test(`accepté : ${ua.slice(12, 40)}`, () => assert.equal(looksAutomated(req({ 'user-agent': ua })), false));
  }

  test('un User-Agent absent est traité comme un robot', () => {
    assert.equal(looksAutomated(req()), true);
  });
});

describe('Limite de débit (filet de sécurité en mémoire)', () => {
  test('les premières requêtes passent, les suivantes sont bloquées', () => {
    const ip = `test-${Date.now()}`;
    let bloqueeAu = null;
    for (let i = 1; i <= 40 && bloqueeAu === null; i += 1) {
      if (rateLimit(ip) !== null) bloqueeAu = i;
    }
    assert.ok(bloqueeAu !== null, 'la limite doit finir par se déclencher');
    assert.ok(bloqueeAu > 1, 'le premier visiteur ne doit jamais être bloqué');
    assert.ok(bloqueeAu <= 20, `la limite se déclenche trop tard (requête ${bloqueeAu})`);
  });

  test('deux visiteurs ont des compteurs séparés', () => {
    const a = `a-${Date.now()}`;
    const b = `b-${Date.now()}`;
    for (let i = 0; i < 16; i += 1) rateLimit(a);
    assert.equal(rateLimit(b), null, 'un visiteur ne doit pas être pénalisé par un autre');
  });
});
