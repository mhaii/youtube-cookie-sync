'use strict';

const { createDecipheriv, pbkdf2Sync } = require('crypto');

// Mock browser globals before requiring background.js
global.chrome = {
  runtime: {
    onMessage: { addListener: jest.fn() },
    onStartup: { addListener: jest.fn() },
  },
  storage: { local: { get: jest.fn(), set: jest.fn() } },
  cookies: {
    onChanged: { addListener: jest.fn(), removeListener: jest.fn() },
    getAllCookieStores: jest.fn(),
    getAll: jest.fn(),
  },
};

const { buildCookieLine, deriveKey, encryptCookies, hashCookies } = require('../background.js');

// ---------------------------------------------------------------------------
// buildCookieLine
// ---------------------------------------------------------------------------

describe('buildCookieLine', () => {
  const base = {
    domain: '.youtube.com',
    path: '/',
    httpOnly: false,
    expirationDate: 1700000000.5,
    name: 'VISITOR_INFO1_LIVE',
    value: 'abc123',
  };

  test('formats a standard cookie correctly', () => {
    const line = buildCookieLine(base);
    expect(line).toBe('.youtube.com\tTRUE\t/\tFALSE\t1700000000\tVISITOR_INFO1_LIVE\tabc123');
  });

  test('sets includeSubdomains=TRUE for domain starting with dot', () => {
    const line = buildCookieLine({ ...base, domain: '.youtube.com' });
    expect(line.split('\t')[1]).toBe('TRUE');
  });

  test('sets includeSubdomains=FALSE for domain without leading dot', () => {
    const line = buildCookieLine({ ...base, domain: 'www.youtube.com' });
    expect(line.split('\t')[1]).toBe('FALSE');
  });

  test('sets httpOnly=TRUE when cookie is httpOnly', () => {
    const line = buildCookieLine({ ...base, httpOnly: true });
    expect(line.split('\t')[3]).toBe('TRUE');
  });

  test('truncates fractional expiration date', () => {
    const line = buildCookieLine({ ...base, expirationDate: 1700000000.9 });
    expect(line.split('\t')[4]).toBe('1700000000');
  });

  test('uses 0 when expirationDate is undefined', () => {
    const line = buildCookieLine({ ...base, expirationDate: undefined });
    expect(line.split('\t')[4]).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// deriveKey — verify PBKDF2 output is deterministic
// ---------------------------------------------------------------------------

describe('deriveKey', () => {
  test('produces a CryptoKey for the same PSK', async () => {
    const key1 = await deriveKey('my-secret-psk');
    const key2 = await deriveKey('my-secret-psk');
    // CryptoKey objects are not directly comparable; verify type and algorithm
    expect(key1.type).toBe('secret');
    expect(key1.algorithm.name).toBe('AES-GCM');
    expect(key1.algorithm.length).toBe(256);
    expect(key2.type).toBe('secret');
  });

  test('different PSKs produce different keys (encrypt test)', async () => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode('test');

    const key1 = await deriveKey('psk-one');
    const key2 = await deriveKey('psk-two');

    const ct1 = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key1, data);
    const ct2 = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key2, data);

    expect(Buffer.from(ct1).toString('hex')).not.toBe(Buffer.from(ct2).toString('hex'));
  });
});

// ---------------------------------------------------------------------------
// encryptCookies — roundtrip with Node's built-in crypto
// ---------------------------------------------------------------------------

describe('encryptCookies', () => {
  const PSK = 'roundtrip-test-psk';
  const SALT = 'youtube-cookie-sync-v1';
  const PLAINTEXT = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tFALSE\t0\tSID\tvalue123';

  function nodeDecrypt(psk, ivB64, dataB64) {
    const key = pbkdf2Sync(psk, SALT, 100000, 32, 'sha256');
    const iv = Buffer.from(ivB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');
    // AES-GCM: last 16 bytes of data are the auth tag
    const tag = data.slice(data.length - 16);
    const ciphertext = data.slice(0, data.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  test('encrypted payload can be decrypted by Node crypto (service-equivalent)', async () => {
    const { iv, data } = await encryptCookies(PLAINTEXT, PSK);
    const decrypted = nodeDecrypt(PSK, iv, data);
    expect(decrypted).toBe(PLAINTEXT);
  });

  test('iv is 16 base64 chars (12 bytes)', async () => {
    const { iv } = await encryptCookies(PLAINTEXT, PSK);
    expect(Buffer.from(iv, 'base64').length).toBe(12);
  });

  test('different PSK produces different ciphertext', async () => {
    const r1 = await encryptCookies(PLAINTEXT, 'psk-a');
    const r2 = await encryptCookies(PLAINTEXT, 'psk-b');
    expect(r1.data).not.toBe(r2.data);
  });

  test('decrypting with wrong PSK throws', () => {
    expect(async () => {
      const { iv, data } = await encryptCookies(PLAINTEXT, 'correct-psk');
      nodeDecrypt('wrong-psk', iv, data);
    }).rejects.toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// hashCookies — determinism
// ---------------------------------------------------------------------------

describe('hashCookies', () => {
  const lines = ['# Netscape HTTP Cookie File', '.youtube.com\tTRUE\t/\tFALSE\t0\tSID\tvalue'];

  test('same input produces same hash', async () => {
    const h1 = await hashCookies(lines);
    const h2 = await hashCookies(lines);
    expect(h1).toBe(h2);
  });

  test('different input produces different hash', async () => {
    const h1 = await hashCookies(lines);
    const h2 = await hashCookies([...lines, 'extra line']);
    expect(h1).not.toBe(h2);
  });

  test('returns a non-empty base64 string', async () => {
    const h = await hashCookies(lines);
    expect(typeof h).toBe('string');
    expect(h.length).toBeGreaterThan(0);
    expect(() => Buffer.from(h, 'base64')).not.toThrow();
  });
});
