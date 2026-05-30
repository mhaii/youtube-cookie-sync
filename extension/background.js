/*
extension background script — cookie sync only
*/

'use strict';

console.log('running background.js');

const PBKDF2_SALT = new TextEncoder().encode('youtube-cookie-sync-v1');
const PBKDF2_ITERATIONS = 100000;

let browserType = getBrowser();

function getBrowser() {
  if (typeof chrome !== 'undefined') {
    if (typeof browser !== 'undefined') {
      return browser;
    } else {
      return chrome;
    }
  } else {
    console.log('failed to detect browser');
    throw 'browser detection error';
  }
}

// derive AES-256-GCM key from PSK string using PBKDF2
async function deriveKey(psk) {
  const pskBytes = new TextEncoder().encode(psk);
  const baseKey = await crypto.subtle.importKey('raw', pskBytes, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: PBKDF2_SALT,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
}

// encrypt plaintext string, return { iv, data } as base64 strings
async function encryptCookies(plaintext, psk) {
  const key = await deriveKey(psk);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const toBase64 = buf =>
    btoa(String.fromCharCode(...new Uint8Array(buf)));
  return {
    iv: toBase64(iv),
    data: toBase64(ciphertext),
  };
}

async function getConfig() {
  const storage = await browserType.storage.local.get('config');
  return storage.config || {};
}

function buildCookieLine(cookie) {
  const includeSubdomains = cookie.domain.startsWith('.') ? 'TRUE' : 'FALSE';
  return [
    cookie.domain,
    includeSubdomains,
    cookie.path,
    cookie.httpOnly.toString().toUpperCase(),
    Math.trunc(cookie.expirationDate) || 0,
    cookie.name,
    cookie.value,
  ].join('\t');
}

async function getCookieLines() {
  const acceptableDomains = ['.youtube.com', 'youtube.com', 'www.youtube.com'];
  const cookieStores = await browserType.cookies.getAllCookieStores();
  const cookieLines = [
    '# Netscape HTTP Cookie File',
    '# https://curl.haxx.se/rfc/cookie_spec.html',
    '# This is a generated file! Do not edit.\n',
  ];
  for (const cookieStore of cookieStores) {
    const allCookies = await browserType.cookies.getAll({
      domain: '.youtube.com',
      storeId: cookieStore.id,
    });
    for (const cookie of allCookies) {
      if (acceptableDomains.includes(cookie.domain)) {
        cookieLines.push(buildCookieLine(cookie));
      }
    }
  }
  return cookieLines;
}

// simple hash of cookie content to detect changes
async function hashCookies(cookieLines) {
  const encoded = new TextEncoder().encode(cookieLines.join('\n'));
  const hashBuf = await crypto.subtle.digest('SHA-256', encoded);
  return btoa(String.fromCharCode(...new Uint8Array(hashBuf)));
}

async function sendCookies() {
  console.log('sendCookies called');
  const config = await getConfig();

  if (!config.endpointUrl || !config.psk) {
    const msg = 'Endpoint URL and PSK must be configured';
    console.log(msg);
    await storeSyncResult(false, msg);
    return { success: false, message: msg };
  }

  const cookieLines = await getCookieLines();
  const currentHash = await hashCookies(cookieLines);

  // skip if cookies haven't changed since last successful sync
  const stored = await browserType.storage.local.get('lastSync');
  if (stored.lastSync?.hash === currentHash && stored.lastSync?.status === 'ok') {
    console.log('cookies unchanged, skipping sync');
    return { success: true, skipped: true };
  }

  try {
    const payload = await encryptCookies(cookieLines.join('\n'), config.psk);
    const url = config.endpointUrl.replace(/\/$/, '') + '/cookie';
    console.log('POST ' + url);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      const msg = body.error || `HTTP ${response.status}`;
      await storeSyncResult(false, msg, currentHash);
      return { success: false, message: msg };
    }

    await storeSyncResult(true, null, currentHash);
    return { success: true };
  } catch (e) {
    const msg = e?.message ?? String(e);
    console.error('sendCookies error:', msg);
    await storeSyncResult(false, msg, currentHash);
    return { success: false, message: msg };
  }
}

async function storeSyncResult(ok, errorMessage, hash) {
  await browserType.storage.local.set({
    lastSync: {
      timestamp: Date.now(),
      status: ok ? 'ok' : 'error',
      message: errorMessage || null,
      hash: ok ? hash : null,
    },
  });
}

let listenerEnabled = false;
let isThrottled = false;

async function handleContinuousSync(checked) {
  if (checked === true) {
    browserType.cookies.onChanged.addListener(onCookieChange);
    listenerEnabled = true;
    console.log('Cookie listener enabled');
  } else {
    browserType.cookies.onChanged.removeListener(onCookieChange);
    listenerEnabled = false;
    console.log('Cookie listener disabled');
  }
}

function onCookieChange(changeInfo) {
  if (isThrottled) return;
  isThrottled = true;
  console.log('Cookie change detected:', changeInfo.cookie?.name);
  sendCookies();
  setTimeout(() => {
    isThrottled = false;
  }, 10000);
}

/*
Supported messages:
  { type: 'sendCookie' }
  { type: 'getCookieLines' }
  { type: 'continuousSync', checked: boolean }
  { type: 'getLastSync' }
*/
function handleMessage(request, sender, sendResponse) {
  console.log('background got message:', request.type);

  (async () => {
    switch (request.type) {
      case 'sendCookie':
        return await sendCookies();
      case 'getCookieLines':
        return await getCookieLines();
      case 'continuousSync':
        return await handleContinuousSync(request.checked);
      case 'getLastSync': {
        const s = await browserType.storage.local.get('lastSync');
        return s.lastSync || null;
      }
      default: {
        throw new Error(`unknown message type: ${JSON.stringify(request.type)}`);
      }
    }
  })()
    .then(value => sendResponse({ success: true, value }))
    .catch(e => {
      console.error(e);
      sendResponse({ success: false, value: e?.message ?? String(e) });
    });

  return true;
}

browserType.runtime.onMessage.addListener(handleMessage);

browserType.runtime.onStartup.addListener(() => {
  browserType.storage.local.get('continuousSync', data => {
    handleContinuousSync(data?.continuousSync?.checked || false);
  });
});

// CommonJS exports for unit testing (Node/Jest environment)
if (typeof module !== 'undefined') {
  module.exports = { buildCookieLine, deriveKey, encryptCookies, hashCookies };
}
