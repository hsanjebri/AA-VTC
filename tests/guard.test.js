// Unit tests — abuse protection on the public /api/fare endpoint.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { clientIp, rateLimit, isAllowedOrigin, looksAutomated } from '../api/_lib/guard.js';

const req = (headers = {}, socket = {}) => ({ headers, socket });

describe('Visitor identification', () => {
  test('the IP comes from the Cloudflare header', () => {
    assert.equal(clientIp(req({ 'cf-connecting-ip': '81.2.3.4' })), '81.2.3.4');
  });

  test('x-forwarded-for: only the first IP is kept', () => {
    assert.equal(clientIp(req({ 'x-forwarded-for': '81.2.3.4, 10.0.0.1' })), '81.2.3.4');
  });

  test('with no header the IP is "unknown", never empty', () => {
    assert.equal(clientIp(req()), 'unknown');
  });
});

describe('Origin check (the API serves this site only)', () => {
  test('a request without an Origin header is rejected', () => {
    assert.equal(isAllowedOrigin(req({ host: 'aa-vtc.fr' })), false);
  });

  test('the site own origin is accepted', () => {
    assert.equal(isAllowedOrigin(req({ origin: 'https://aa-vtc.fr', host: 'aa-vtc.fr' })), true);
  });

  test('a foreign origin is rejected', () => {
    assert.equal(isAllowedOrigin(req({ origin: 'https://evil-example.fr', host: 'aa-vtc.fr' })), false);
  });

  test('the ALLOWED_ORIGINS list is honoured', () => {
    const previous = process.env.ALLOWED_ORIGINS;
    process.env.ALLOWED_ORIGINS = 'https://aa-vtc.fr,https://www.aa-vtc.fr';
    try {
      assert.equal(isAllowedOrigin(req({ origin: 'https://www.aa-vtc.fr', host: 'other.fr' })), true);
      assert.equal(isAllowedOrigin(req({ origin: 'https://aa-vtc.com', host: 'other.fr' })), false);
    } finally {
      process.env.ALLOWED_ORIGINS = previous;
    }
  });
});

describe('Automated client detection', () => {
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
  const BROWSERS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/122.0',
    'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36',
  ];

  for (const ua of BOTS) {
    test(`blocked: ${ua.slice(0, 28)}`, () => assert.equal(looksAutomated(req({ 'user-agent': ua })), true));
  }

  for (const ua of BROWSERS) {
    test(`allowed: ${ua.slice(12, 42)}`, () => assert.equal(looksAutomated(req({ 'user-agent': ua })), false));
  }

  test('a missing User-Agent is treated as a bot', () => {
    assert.equal(looksAutomated(req()), true);
  });
});

describe('Rate limiting (in-memory safety net)', () => {
  test('the first requests pass, later ones are blocked', () => {
    const ip = `test-${Date.now()}`;
    let blockedAt = null;
    for (let i = 1; i <= 40 && blockedAt === null; i += 1) {
      if (rateLimit(ip) !== null) blockedAt = i;
    }
    assert.ok(blockedAt !== null, 'the limit must eventually trigger');
    assert.ok(blockedAt > 1, 'a first-time visitor must never be blocked');
    assert.ok(blockedAt <= 20, `the limit triggers too late (request ${blockedAt})`);
  });

  test('two visitors have independent counters', () => {
    const a = `a-${Date.now()}`;
    const b = `b-${Date.now()}`;
    for (let i = 0; i < 16; i += 1) rateLimit(a);
    assert.equal(rateLimit(b), null, 'one visitor must not be penalised by another');
  });
});
